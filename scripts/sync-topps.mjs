#!/usr/bin/env node
/**
 * sync-topps.mjs — reconcile upcoming sports-card and TCG releases from
 * official publisher calendars and trusted secondary sources.
 *
 * Authority: official publisher sources win, then Hobby Monitor, then Waxstat.
 * Topps' official calendar is always authoritative for Topps products. Each
 * provider is isolated so a temporary outage does not erase its last snapshot.
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
  releaseFamilyIdentity,
  releaseIdentity,
  sourceAuthority
} from "./release-utils.mjs";
import {
  parseHobbyMonitorHtml,
  parseLorcanaMarkdown,
  parseMagicMarkdown,
  parseToppsMarkdown,
  parseWaxstatHtml
} from "./source-utils.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RELEASES_PATH = path.join(ROOT, "data", "releases.json");
const SUBSCRIPTIONS_PATH = path.join(ROOT, "config", "subscriptions.json");

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const TOPPS_CALENDAR = "https://www.topps.com/release-calendar";
const HOBBY_MONITOR = "https://www.hobbymonitor.com/releases";
const MAGIC_PRODUCTS = "https://magic.wizards.com/en/products";
const LORCANA_PRODUCTS = [
  "https://www.disneylorcana.com/en-US/product/hyperia-city",
  "https://www.disneylorcana.com/en-US/product/great-hunny-rescue"
];
const readerUrl = (url) => `https://r.jina.ai/${url}`;

// Waxstat labels products by card year, so last year's page can still contain
// releases in the current calendar year. Missing slugs are skipped harmlessly.
const WAXSTAT_SOURCES = [
  ...["2025-topps", "2025-26-topps", "2026-topps", "2026-27-topps", "2027-topps"]
    .map((name) => ({ slug: `${name}-cards-release-calendar`, category: "sports" })),
  ...["2025-pokemon", "2026-pokemon", "2027-pokemon"]
    .map((name) => ({ slug: `${name}-cards-release-calendar`, category: "tcg", game: "Pokemon" })),
  ...["2025-magic-the-gathering", "2026-magic-the-gathering", "2027-magic-the-gathering"]
    .map((name) => ({ slug: `${name}-cards-release-calendar`, category: "tcg", game: "Magic: The Gathering" })),
  ...["2025-yu-gi-oh", "2026-yu-gi-oh", "2027-yu-gi-oh"]
    .map((name) => ({ slug: `${name}-cards-release-calendar`, category: "tcg", game: "Yu-Gi-Oh!" })),
  ...["2025-other", "2026-other", "2027-other"]
    .map((name) => ({ slug: `${name}-cards-release-calendar`, category: "tcg" })),
  ...["2025-disney", "2026-disney", "2027-disney"]
    .map((name) => ({ slug: `${name}-cards-release-calendar`, category: "tcg", game: "Disney Lorcana" }))
].map((source) => ({
  ...source,
  id: `waxstat:${source.slug}`,
  url: `https://www.waxstat.com/${source.slug}`
}));
const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const NO_PUSH = args.includes("--no-push");
const NO_GIT = args.includes("--no-git");
const OFFLINE = args.includes("--offline");
const VERBOSE = args.includes("--verbose") || DRY;
const log = (...a) => console.log(...a);
const vlog = (...a) => VERBOSE && console.log(...a);

/* ------------------------------ parsing -------------------------------- */

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

function pacificDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

/* ------------------------------ sources -------------------------------- */

async function fetchText(url) {
  const reader = url.startsWith("https://r.jina.ai/");
  const response = await fetch(url, {
    headers: reader
      ? { accept: "text/plain" }
      : { "user-agent": UA, accept: "text/html, text/markdown" },
    signal: AbortSignal.timeout(25_000)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

async function loadWaxstatSource(source) {
  if (OFFLINE) {
    try {
      return await readFile(`wax_${source.slug}.html`, "utf8");
    } catch {
      return null;
    }
  }
  try {
    return await fetchText(source.url);
  } catch (error) {
    vlog(`  ! ${source.slug}: ${error.message}`);
    return null;
  }
}

async function loadLorcanaRows() {
  const seedUrl = LORCANA_PRODUCTS[0];
  const seedMarkdown = await fetchText(readerUrl(seedUrl));
  const discovered = [...seedMarkdown.matchAll(/\]\((https:\/\/www\.disneylorcana\.com\/en-US\/product\/[^)]+)\)/g)]
    .map((match) => match[1]);
  const urls = [...new Set([...LORCANA_PRODUCTS, ...discovered])].slice(0, 12);
  const results = await Promise.allSettled(urls.map(async (url) => {
    const markdown = url === seedUrl ? seedMarkdown : await fetchText(readerUrl(url));
    return { id: `lorcana-official:${new URL(url).pathname.split("/").filter(Boolean).at(-1)}`, rows: parseLorcanaMarkdown(markdown, url) };
  }));
  const rows = [];
  const succeeded = new Set();
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    succeeded.add(result.value.id);
    rows.push(...result.value.rows);
  }
  return { rows, succeeded };
}

/* ------------------------------- merge --------------------------------- */

/* -------------------------------- main --------------------------------- */

async function main() {
  const existing = JSON.parse(await readFile(RELEASES_PATH, "utf8"));
  const subscriptions = JSON.parse(await readFile(SUBSCRIPTIONS_PATH, "utf8"));
  log(`Scope: ${(subscriptions.categories ?? ["sports"]).join(" + ")}`);
  log(`Existing releases: ${existing.length}`);

  // Gather official publishers first, then trusted secondary sources. The
  // resolver below uses explicit authority, so completion order cannot change
  // which date or link wins.
  const rawRows = [];
  const successfulSourceIds = new Set();
  const successfulWaxstatCalendars = new Set();

  if (!OFFLINE) {
    const providers = await Promise.allSettled([
      fetchText(readerUrl(TOPPS_CALENDAR)).then((body) => ({ id: "topps-official", label: "Topps official", rows: parseToppsMarkdown(body) })),
      fetchText(HOBBY_MONITOR).then((body) => ({ id: "hobby-monitor", label: "Hobby Monitor", rows: parseHobbyMonitorHtml(body) })),
      fetchText(readerUrl(MAGIC_PRODUCTS)).then((body) => ({ id: "magic-official", label: "Magic official", rows: parseMagicMarkdown(body) })),
      loadLorcanaRows().then((result) => ({ id: null, label: "Disney Lorcana official", ...result }))
    ]);
    for (const result of providers) {
      if (result.status !== "fulfilled") {
        vlog(`  ! provider: ${result.reason?.message ?? result.reason}`);
        continue;
      }
      const { id, label, rows, succeeded } = result.value;
      vlog(`  ${label}: ${rows.length} dated rows`);
      if (id && rows.length > 0) successfulSourceIds.add(id);
      for (const sourceId of succeeded ?? []) successfulSourceIds.add(sourceId);
      rawRows.push(...rows);
    }
  }

  for (const source of WAXSTAT_SOURCES) {
    const html = await loadWaxstatSource(source);
    if (!html) continue;
    const rows = parseWaxstatHtml(html, source);
    vlog(`  ${source.slug}: ${rows.length} dated rows`);
    if (rows.length > 0) {
      successfulSourceIds.add(source.id);
      successfulWaxstatCalendars.add(source.url);
    }
    rawRows.push(...rows);
  }
  if (rawRows.length === 0) {
    log("No rows parsed from any source (site markup may have changed). Nothing to do.");
    return;
  }

  const todayIso = pacificDateKey();
  const candidates = new Map();

  function reference(release) {
    return {
      id: release.sourceName === "waxstat.com" ? "waxstat" : release.sourceId ?? release.sourceName,
      name: release.sourceName,
      url: release.sourceUrl,
      priority: sourceAuthority(release),
      quality: linkQuality(release)
    };
  }

  function linkQuality(release) {
    const url = release.sourceUrl ?? "";
    let score = /\/boxes\/|\/pages\/|\/products?\/|\/release\//.test(url) ? 2 : 0;
    if (/\bcase\b/i.test(release.originalTitle ?? "")) score -= 2;
    else if (/\bbox\b/i.test(release.originalTitle ?? "")) score += 1;
    return score;
  }

  function addCandidate(release) {
    let key = releaseIdentity(release);
    const familyKey = releaseFamilyIdentity(release);
    if (!candidates.has(key)) {
      for (const [candidateKey, candidate] of candidates) {
        const officialPair = sourceAuthority(release) >= 100 || sourceAuthority(candidate) >= 100;
        if (officialPair && releaseFamilyIdentity(candidate) === familyKey) {
          key = candidateKey;
          break;
        }
      }
    }
    const existingRelease = candidates.get(key);
    if (!existingRelease) {
      const { quality, ...initialReference } = reference(release);
      candidates.set(key, {
        ...release,
        sources: [initialReference]
      });
      return;
    }

    const existingAuthority = sourceAuthority(existingRelease);
    const incomingAuthority = sourceAuthority(release);
    const existingDate = String(existingRelease.startsAt).slice(0, 10);
    const incomingDate = String(release.startsAt).slice(0, 10);
    const existingFuture = existingDate >= todayIso;
    const incomingFuture = incomingDate >= todayIso;
    const incomingDateWins = incomingFuture !== existingFuture
      ? incomingFuture
      : incomingFuture ? incomingDate < existingDate : incomingDate > existingDate;
    const secondaryDateOverride = incomingFuture !== existingFuture
      && Math.max(incomingAuthority, existingAuthority) < 100;
    const incomingWins = secondaryDateOverride
      ? incomingFuture
      : incomingAuthority > existingAuthority
        || (incomingAuthority === existingAuthority
          && release.status === "CONFIRMED" && existingRelease.status !== "CONFIRMED")
        || (incomingAuthority === existingAuthority
          && release.status === existingRelease.status
          && linkQuality(release) > linkQuality(existingRelease))
        || (incomingAuthority === existingAuthority
          && release.status === existingRelease.status
          && linkQuality(release) === linkQuality(existingRelease)
          && incomingDateWins);
    const preferred = incomingWins ? release : existingRelease;
    const allSources = [...(existingRelease.sources ?? []), reference(existingRelease), reference(release)]
      .filter((source) => source.name || source.url);
    const uniqueSources = new Map();
    for (const source of allSources) {
      const sourceKey = source.id ?? source.name ?? source.url ?? "source";
      const current = uniqueSources.get(sourceKey);
      if (!current || (source.quality ?? 0) > (current.quality ?? 0)) uniqueSources.set(sourceKey, source);
    }
    candidates.set(key, {
      ...preferred,
      tags: [...new Set([...(existingRelease.tags ?? []), ...(release.tags ?? [])])],
      sources: [...uniqueSources.values()]
        .sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0))
        .map(({ quality, ...source }) => source)
    });
  }

  for (const r of rawRows) {
    const canonicalTitle = canonicalReleaseTitle(decode(r.rawName));
    const title = r.releaseKind === "prerelease" ? `${canonicalTitle} Prerelease` : canonicalTitle;
    if (!title) continue;
    if (r.m === 12 && r.d === 31) continue; // waxstat parks "date TBD" on Dec 31
    const dateISO = `${r.y}-${pad(r.m)}-${pad(r.d)}`;
    const game = r.game ?? detectTcgGame(title);
    const category = game ? "tcg" : r.category;
    if (category === "tcg" && !game) continue;
    const sport = category === "sports" ? detectSport(title) : null;
    const tags = category === "tcg"
      ? ["TCG", game]
      : ["Sports cards", ...(sport ? [sport] : [])];
    let startsAt;
    let endsAt;
    if (Number.isInteger(r.utcHour)) {
      const start = new Date(Date.UTC(r.y, r.m - 1, r.d, r.utcHour, r.utcMinute ?? 0));
      startsAt = start.toISOString();
      endsAt = new Date(start.getTime() + 60 * 60 * 1000).toISOString();
    } else {
      const off = ptOffset(r.y, r.m, r.d);
      startsAt = `${dateISO}T09:00:00${off}`;
      endsAt = `${dateISO}T10:00:00${off}`;
    }
    const official = Number(r.sourcePriority) >= 100;
    const release = {
      id: `${slug(title)}-${category}`,
      title,
      startsAt,
      endsAt,
      notes: Number.isInteger(r.utcHour)
        ? `Official drop time from ${r.sourceName}.`
        : `Release date from ${r.sourceName}. Time is a 9:00 AM PT placeholder; verify the exact drop time before release.`,
      location: "Online",
      status: r.status ?? (official ? "CONFIRMED" : "TENTATIVE"),
      sourceName: r.sourceName,
      sourceUrl: r.sourceUrl,
      sourceCalendarUrl: r.sourceCalendarUrl,
      sourceId: r.sourceId,
      sourcePriority: r.sourcePriority,
      ...(r.releaseKind ? { releaseKind: r.releaseKind } : {}),
      tags,
      category,
      ...(game ? { game } : {}),
      ...(sport ? { sport } : {}),
      managedBy: "release-sync",
      originalTitle: r.rawName
    };
    if (!matchesSubscriptions(release, subscriptions)) continue;
    addCandidate(release);
  }

  // Past releases remain history. Future manual entries participate at their
  // default authority (80), while snapshots from a provider are replaced only
  // when that provider was successfully read in this run.
  const preserved = existing.filter((release) => String(release.startsAt).slice(0, 10) < todayIso);
  for (const release of existing.filter((item) => String(item.startsAt).slice(0, 10) >= todayIso)) {
    const legacyWaxstat = release.managedBy === "waxstat-sync" || release.sourceName === "waxstat.com";
    const managed = legacyWaxstat || release.managedBy === "release-sync";
    const refreshed = legacyWaxstat
      ? successfulWaxstatCalendars.has(release.sourceCalendarUrl ?? release.sourceUrl)
      : successfulSourceIds.has(release.sourceId);
    if (!managed || !refreshed) addCandidate(release);
  }

  const upcoming = [...candidates.values()]
    .filter((release) => String(release.startsAt).slice(0, 10) >= todayIso)
    .map((release) => {
      const { originalTitle, ...clean } = release;
      return clean;
    });
  const merged = [...preserved, ...upcoming]
    .sort((a, b) => (a.startsAt || "").localeCompare(b.startsAt || ""));

  const beforeIds = new Set(existing.map((release) => release.id));
  const afterIds = new Set(merged.map((release) => release.id));
  const added = merged.filter((release) => !beforeIds.has(release.id));
  const removed = existing.filter((release) => !afterIds.has(release.id));
  const changed = JSON.stringify(existing) !== JSON.stringify(merged);

  log(`\nIn-scope upcoming releases: ${upcoming.length}`);
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
