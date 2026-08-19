#!/usr/bin/env node
/**
 * sync-topps.mjs — feed card-release-calendar's data/releases.json with
 * upcoming sports-card and TCG releases.
 *
 * Source: waxstat.com's release calendars. They are plain server-rendered
 * HTML (no Cloudflare, no login, no JS-gating), each row carrying an exact
 * "MMM DD, YYYY" release date — so this runs as a simple daily cron with no
 * browser and no babysitting. (topps.com itself is behind a Cloudflare Turnstile
 * that blocks automation, and distributor/aggregator sources are walled, dealer-
 * gated, or stale archives — waxstat is the one reliable machine-readable feed.)
 *
 * Scope is governed by config/subscriptions.json. Packaging variants of the
 * same set and date collapse into one calendar entry. Future managed records
 * are reconciled on each run so date changes and removed listings do not leave
 * stale events behind.
 *
 * Flags:
 *   --dry-run     parse + merge, print what WOULD change, write nothing, no git
 *   --no-push     write + commit but don't push
 *   --no-git      write only; don't commit or push
 *   --offline     read local wax_<slug>.html files (dev) instead of fetching
 *   --verbose     extra logging
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import {
  canonicalReleaseTitle,
  detectSport,
  detectTcgGame,
  matchesSubscriptions,
  normalizedTitle
} from "./release-utils.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RELEASES_PATH = path.join(ROOT, "data", "releases.json");
const SUBSCRIPTIONS_PATH = path.join(ROOT, "config", "subscriptions.json");

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

// Waxstat labels products by card year, so last year's page can still contain
// releases in the current calendar year. Missing slugs are skipped harmlessly.
const SOURCES = [
  ...["2025-topps", "2025-26-topps", "2026-topps", "2026-27-topps", "2027-topps"]
    .map((name) => ({ slug: `${name}-cards-release-calendar`, category: "sports" })),
  ...["2025-pokemon", "2026-pokemon", "2027-pokemon"]
    .map((name) => ({ slug: `${name}-cards-release-calendar`, category: "tcg", game: "Pokemon" })),
  ...["2025-magic-the-gathering", "2026-magic-the-gathering", "2027-magic-the-gathering"]
    .map((name) => ({ slug: `${name}-cards-release-calendar`, category: "tcg", game: "Magic: The Gathering" })),
  ...["2025-yu-gi-oh", "2026-yu-gi-oh", "2027-yu-gi-oh"]
    .map((name) => ({ slug: `${name}-cards-release-calendar`, category: "tcg", game: "Yu-Gi-Oh!" })),
  ...["2025-other", "2026-other", "2027-other"]
    .map((name) => ({ slug: `${name}-cards-release-calendar`, category: "tcg" }))
];
const srcUrl = (slug) => `https://www.waxstat.com/${slug}`;

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const NO_PUSH = args.includes("--no-push");
const NO_GIT = args.includes("--no-git");
const OFFLINE = args.includes("--offline");
const VERBOSE = args.includes("--verbose") || DRY;
const log = (...a) => console.log(...a);
const vlog = (...a) => VERBOSE && console.log(...a);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/* ------------------------------ parsing -------------------------------- */

function cellTexts(html, cls) {
  // each waxstat cell is: <div class="… wax-x …"><div…>TEXT</div>…
  const re = new RegExp(`class="[^"]*${cls}[^"]*"[^>]*>\\s*<div[^>]*>([\\s\\S]*?)</div>`, "g");
  const out = [];
  let m;
  while ((m = re.exec(html))) out.push(decode(m[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim());
  return out;
}
function decode(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#8217;|&rsquo;/g, "'")
    .replace(/&#8211;|&ndash;/g, "–")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'");
}
function slug(s) {
  return s
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function parseWaxstat(html, source) {
  const names = cellTexts(html, "wax-name");
  const dates = cellTexts(html, "wax-release-date");
  const n = Math.min(names.length, dates.length);
  const rows = [];
  for (let i = 0; i < n; i++) {
    if (dates[i].toLowerCase() === "release date") continue; // header
    const dm = dates[i].match(/^([A-Z][a-z]{2})\s+(\d{1,2}),\s+(\d{4})$/);
    if (!dm) continue;
    const month = MONTHS.indexOf(dm[1]) + 1;
    if (!month) continue;
    rows.push({
      rawName: names[i],
      y: +dm[3],
      m: month,
      d: +dm[2],
      sourceUrl: srcUrl(source.slug),
      category: source.category,
      game: source.game
    });
  }
  return rows;
}

/* ---------------------------- date / offset ---------------------------- */

function ptOffset(y, m, d) {
  const utc = new Date(Date.UTC(y, m - 1, d, 12));
  const tz =
    new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", timeZoneName: "shortOffset" })
      .formatToParts(utc)
      .find((p) => p.type === "timeZoneName")?.value || "GMT-8";
  const h = parseInt((tz.match(/GMT([+-]\d{1,2})/) || [, "-8"])[1], 10);
  return `${h < 0 ? "-" : "+"}${String(Math.abs(h)).padStart(2, "0")}:00`;
}
const pad = (x) => String(x).padStart(2, "0");

/* ------------------------------ sources -------------------------------- */

async function loadSource(source) {
  if (OFFLINE) {
    try {
      return await readFile(`wax_${source.slug}.html`, "utf8");
    } catch {
      return null;
    }
  }
  const res = await fetch(srcUrl(source.slug), { headers: { "user-agent": UA, accept: "text/html" } });
  if (!res.ok) {
    vlog(`  ! ${source.slug}: HTTP ${res.status}`);
    return null;
  }
  return res.text();
}

/* ------------------------------- merge --------------------------------- */

/* -------------------------------- main --------------------------------- */

async function main() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const existing = JSON.parse(await readFile(RELEASES_PATH, "utf8"));
  const subscriptions = JSON.parse(await readFile(SUBSCRIPTIONS_PATH, "utf8"));
  log(`Scope: ${(subscriptions.categories ?? ["sports"]).join(" + ")}`);
  log(`Existing releases: ${existing.length}`);

  // gather + parse all source pages
  const rawRows = [];
  const reconciledSourceUrls = new Set();
  for (const source of SOURCES) {
    const html = await loadSource(source);
    if (!html) continue;
    const rows = parseWaxstat(html, source);
    vlog(`  ${source.slug}: ${rows.length} dated rows`);
    if (rows.length > 0) reconciledSourceUrls.add(srcUrl(source.slug));
    rawRows.push(...rows);
  }
  if (rawRows.length === 0) {
    log("No rows parsed from any source (site markup may have changed). Nothing to do.");
    return;
  }

  // collapse variants -> one candidate per (baseName + date), in scope + future
  const candidates = new Map(); // key -> release
  for (const r of rawRows) {
    const title = canonicalReleaseTitle(decode(r.rawName));
    if (!title) continue;
    if (r.m === 12 && r.d === 31) continue; // waxstat parks "date TBD" on Dec 31
    const startsAtDate = new Date(`${r.y}-${pad(r.m)}-${pad(r.d)}T12:00:00`);
    if (startsAtDate < today) continue; // future only
    const game = r.game ?? detectTcgGame(title);
    if (r.category === "tcg" && !game) continue;
    const sport = r.category === "sports" ? detectSport(title) : null;
    const tags = r.category === "tcg"
      ? ["TCG", game]
      : ["Sports cards", ...(sport ? [sport] : [])];
    const off = ptOffset(r.y, r.m, r.d);
    const dateISO = `${r.y}-${pad(r.m)}-${pad(r.d)}`;
    const key = `${r.category}:${normalizedTitle(title)}:${dateISO}`;
    if (candidates.has(key)) continue;
    const release = {
      id: `${slug(title)}-${r.y}${pad(r.m)}${pad(r.d)}`,
      title,
      startsAt: `${dateISO}T09:00:00${off}`,
      endsAt: `${dateISO}T10:00:00${off}`,
      notes: "Release date imported from Waxstat. Time is a 9:00 AM PT placeholder; verify with the publisher before the drop.",
      location: "Online",
      status: "TENTATIVE",
      sourceName: "waxstat.com",
      sourceUrl: r.sourceUrl,
      tags,
      category: r.category,
      ...(game ? { game } : {}),
      ...(sport ? { sport } : {}),
      managedBy: "waxstat-sync"
    };
    if (!matchesSubscriptions(release, subscriptions)) continue;
    candidates.set(key, release);
  }

  // Manual records win. Past imported records remain as history; all future
  // imported records are replaced by the current source snapshot.
  const todayIso = today.toISOString().slice(0, 10);
  const preserved = existing.filter((release) => {
    const managed = release.managedBy === "waxstat-sync" || release.sourceName === "waxstat.com";
    const sourceWasRead = reconciledSourceUrls.has(release.sourceUrl);
    return !managed || !sourceWasRead || String(release.startsAt).slice(0, 10) < todayIso;
  });
  const manualKeys = new Set(preserved.map((release) =>
    `${release.category ?? "sports"}:${normalizedTitle(release.title)}:${String(release.startsAt).slice(0, 10)}`));
  const managed = [...candidates.entries()]
    .filter(([key]) => !manualKeys.has(key))
    .map(([, release]) => release);
  const merged = [...preserved, ...managed]
    .sort((a, b) => (a.startsAt || "").localeCompare(b.startsAt || ""));

  const beforeIds = new Set(existing.map((release) => release.id));
  const afterIds = new Set(merged.map((release) => release.id));
  const added = merged.filter((release) => !beforeIds.has(release.id));
  const removed = existing.filter((release) => !afterIds.has(release.id));
  const changed = JSON.stringify(existing) !== JSON.stringify(merged);

  log(`\nIn-scope upcoming releases: ${managed.length}`);
  log(`Changes: +${added.length} / -${removed.length}`);
  for (const release of added) vlog(`  + ${release.startsAt.slice(0, 10)}  ${release.title}`);
  for (const release of removed) vlog(`  - ${release.startsAt.slice(0, 10)}  ${release.title}`);

  if (!changed) {
    log("Nothing changed. Done.");
    return;
  }
  if (DRY) {
    log("\n--dry-run: no files written, no git.");
    return;
  }

  await writeFile(RELEASES_PATH, JSON.stringify(merged, null, 2) + "\n", "utf8");
  log(`\nWrote ${merged.length} releases to data/releases.json`);

  if (NO_GIT) {
    log("--no-git: file updated without a commit.");
    return;
  }

  try {
    const git = (a) => execFileSync("git", ["-C", ROOT, ...a], { stdio: "pipe" }).toString();
    git(["add", "data/releases.json"]);
    git(["commit", "-m", `data: reconcile sports and TCG releases [auto]`]);
    log("Committed reconciled releases.");
    if (!NO_PUSH) {
      // CI pushes its own "Rebuild calendar feed" commits to main, so this
      // branch is routinely behind by the time we get here. Rebase onto the
      // remote first — a bare push would be rejected non-fast-forward and the
      // release would sit here unpublished. We only touch data/releases.json
      // and CI only touches docs/, so this rebase shouldn't conflict; if it
      // ever does, abort and leave the commit for a human rather than guess.
      const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]).trim();
      git(["fetch", "origin", branch]);
      try {
        git(["rebase", `origin/${branch}`]);
      } catch (e) {
        git(["rebase", "--abort"]);
        throw new Error(`rebase onto origin/${branch} conflicted; commit left local: ${e.message}`);
      }
      git(["push", "origin", branch]);
      log("Pushed — GitHub Actions will rebuild docs/cards.ics.");
    } else log("--no-push: commit only.");
  } catch (e) {
    log("git step failed:", e.stderr ? e.stderr.toString() : e.message);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e.stack || String(e));
  process.exitCode = 1;
});
