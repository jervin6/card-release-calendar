#!/usr/bin/env node
/**
 * sync-topps.mjs — feed card-release-calendar's data/releases.json with
 * upcoming Topps releases.
 *
 * Source: waxstat.com's Topps release calendars. They are plain server-rendered
 * HTML (no Cloudflare, no login, no JS-gating), each row carrying an exact
 * "MMM DD, YYYY" release date — so this runs as a simple daily cron with no
 * browser and no babysitting. (topps.com itself is behind a Cloudflare Turnstile
 * that blocks automation, and distributor/aggregator sources are walled, dealer-
 * gated, or stale archives — waxstat is the one reliable machine-readable feed.)
 *
 * Scope is governed by config/subscriptions.json (the same keyword match
 * build.mjs uses) so we only ingest releases that will appear in the feed.
 * Packaging variants (Hobby/Blaster/Mega/Box/Pack/Case/FDI/…) of the same set on
 * the same date collapse into one calendar entry.
 *
 * Flags:
 *   --dry-run     parse + merge, print what WOULD change, write nothing, no git
 *   --no-push     write + commit but don't push
 *   --offline     read local wax_<slug>.html files (dev) instead of fetching
 *   --verbose     extra logging
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RELEASES_PATH = path.join(ROOT, "data", "releases.json");
const SUBSCRIPTIONS_PATH = path.join(ROOT, "config", "subscriptions.json");

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

// Topps calendars. waxstat labels products by CARD-YEAR, and a given year's
// products (esp. football/basketball) keep releasing well into the next
// calendar year — e.g. "2025 Topps Chrome Black Football" drops Jul 2026. So we
// scrape several year pages (calendar-year + season-spanning YYYY-YY) and let
// the future-date filter keep only what's still upcoming. Missing slugs 404 and
// are skipped harmlessly.
const SOURCE_SLUGS = [
  "2024-25-topps-cards-release-calendar",
  "2025-topps-cards-release-calendar",
  "2025-26-topps-cards-release-calendar",
  "2026-topps-cards-release-calendar",
  "2026-27-topps-cards-release-calendar",
  "2027-topps-cards-release-calendar",
];
const srcUrl = (slug) => `https://www.waxstat.com/${slug}`;

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const NO_PUSH = args.includes("--no-push");
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
function stripEmoji(s) {
  return s.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}️]/gu, "").replace(/\s+/g, " ").trim();
}

// packaging / retail-format tokens that distinguish SKUs but not calendar
// events. Product/edition distinctions collectors track separately (Sapphire
// Edition, Logofractor Edition, Update Series, All-Star Game, High Number,
// Countdown Calendar, Fanatics Fest…) are deliberately NOT stripped.
const PACK =
  /\b(First Day Issue|FDI|Breaker'?s Delight|Delight|Fat Pack|Hobby|Retail|Blaster|Mega|Jumbo|Value|HTA|Cello|Hanger|Blast|Choice|Super|Compact|Collector'?s Tin|\d+-?Box|Box|Pack|Case)\b/gi;
// "🔥HOT🔥" hype tag waxstat appends — strip the leftover word after emoji removal
const HOT = /\bHOT\b/g;

function baseSetName(raw) {
  let t = stripEmoji(decode(raw));
  t = t.replace(/\(FDI\)/gi, "").replace(/-\s*First Day Issue.*$/i, "");
  t = t.replace(HOT, " ").replace(PACK, " ").replace(/\s+/g, " ").replace(/[-–—]\s*$/g, "").trim();
  return t;
}

function slug(s) {
  return s
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function parseWaxstat(html, sourceUrl) {
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
    rows.push({ rawName: names[i], y: +dm[3], m: month, d: +dm[2], sourceUrl });
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

/* --------------------------- classification ---------------------------- */

const SPORTS = [
  ["Baseball", /\bbaseball\b|\bMLB\b/i],
  ["Basketball", /\bbasketball\b|\bNBA\b|\bWNBA\b/i],
  ["Football", /\bfootball\b|\bNFL\b/i],
  ["Soccer", /\bsoccer\b|\bUEFA\b|\bPremier League\b|\bChampions League\b|\bLa Liga\b|\bBundesliga\b|\bMLS\b|\bFIFA\b|\bMerlin\b|\bMatch Attax\b/i],
  ["Formula 1", /\bformula\s*1\b|\bF1\b/i],
  ["Hockey", /\bhockey\b|\bNHL\b/i],
  ["WWE", /\bWWE\b|\bwrestling\b/i],
  ["UFC", /\bUFC\b/i],
];
const detectSport = (t) => SPORTS.find(([, re]) => re.test(t))?.[0] || null;

function matchesKeywords(title, tags, keywords) {
  const hay = [title, ...tags].join(" ").toLowerCase();
  return keywords.some((k) => hay.includes(k.toLowerCase()));
}

/* ------------------------------ sources -------------------------------- */

async function loadSource(slug) {
  if (OFFLINE) {
    try {
      return await readFile(`wax_${slug}.html`, "utf8");
    } catch {
      return null;
    }
  }
  const res = await fetch(srcUrl(slug), { headers: { "user-agent": UA, accept: "text/html" } });
  if (!res.ok) {
    log(`  ! ${slug}: HTTP ${res.status}`);
    return null;
  }
  return res.text();
}

/* ------------------------------- merge --------------------------------- */

const normTitle = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/* -------------------------------- main --------------------------------- */

async function main() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const existing = JSON.parse(await readFile(RELEASES_PATH, "utf8"));
  const keywords = JSON.parse(await readFile(SUBSCRIPTIONS_PATH, "utf8")).keywords || [];
  log(`Scope keywords: ${keywords.join(", ")}`);
  log(`Existing releases: ${existing.length}`);

  // gather + parse all source pages
  const rawRows = [];
  for (const slug of SOURCE_SLUGS) {
    const html = await loadSource(slug);
    if (!html) continue;
    const rows = parseWaxstat(html, srcUrl(slug));
    vlog(`  ${slug}: ${rows.length} dated rows`);
    rawRows.push(...rows);
  }
  if (rawRows.length === 0) {
    log("No rows parsed from any source (site markup may have changed). Nothing to do.");
    return;
  }

  // collapse variants -> one candidate per (baseName + date), in scope + future
  const candidates = new Map(); // key -> release
  for (const r of rawRows) {
    const title = baseSetName(r.rawName);
    if (!title) continue;
    if (r.m === 12 && r.d === 31) continue; // waxstat parks "date TBD" on Dec 31
    const startsAtDate = new Date(`${r.y}-${pad(r.m)}-${pad(r.d)}T12:00:00`);
    if (startsAtDate < today) continue; // future only
    const sport = detectSport(title);
    const tags = ["Topps", ...(sport ? [sport] : [])];
    if (!matchesKeywords(title, tags, keywords)) continue; // scope = subscriptions
    const off = ptOffset(r.y, r.m, r.d);
    const dateISO = `${r.y}-${pad(r.m)}-${pad(r.d)}`;
    const key = `${normTitle(title)}::${dateISO}`;
    if (candidates.has(key)) continue;
    candidates.set(key, {
      id: `${slug(title)}-${r.y}${pad(r.m)}${pad(r.d)}`,
      title,
      startsAt: `${dateISO}T09:00:00${off}`,
      endsAt: `${dateISO}T10:00:00${off}`,
      notes: "Drop time assumed 9:00 AM PT; verify exact time on the Topps product page.",
      location: "Online",
      status: "TENTATIVE",
      sourceName: "waxstat.com",
      sourceUrl: r.sourceUrl,
      tags,
    });
  }

  // dedup against existing (by id, or normalized title+date)
  const haveId = new Set(existing.map((r) => r.id));
  const haveTd = new Set(existing.map((r) => `${normTitle(r.title)}::${(r.startsAt || "").slice(0, 10)}`));
  const added = [];
  for (const r of candidates.values()) {
    const td = `${normTitle(r.title)}::${r.startsAt.slice(0, 10)}`;
    if (haveId.has(r.id) || haveTd.has(td)) continue;
    added.push(r);
  }
  added.sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  log(`\nIn-scope upcoming candidates: ${candidates.size} — new after dedup: ${added.length}`);
  for (const r of added) log(`  + ${r.startsAt.slice(0, 10)}  ${r.title}  [${r.tags.join(", ")}]`);

  if (added.length === 0) {
    log("\nNothing new. Done.");
    return;
  }
  if (DRY) {
    log("\n--dry-run: no files written, no git.");
    return;
  }

  const merged = [...existing, ...added].sort((a, b) => (a.startsAt || "").localeCompare(b.startsAt || ""));
  await writeFile(RELEASES_PATH, JSON.stringify(merged, null, 2) + "\n", "utf8");
  log(`\nWrote ${merged.length} releases to data/releases.json`);

  try {
    const git = (a) => execFileSync("git", ["-C", ROOT, ...a], { stdio: "pipe" }).toString();
    git(["add", "data/releases.json"]);
    git(["commit", "-m", `data: add ${added.length} upcoming Topps release(s) [auto]`]);
    log(`Committed ${added.length} release(s).`);
    if (!NO_PUSH) {
      git(["push"]);
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
