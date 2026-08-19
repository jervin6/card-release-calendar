import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import {
  collapseReleaseVariants,
  matchesSubscriptions
} from "./release-utils.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const docsDir = path.join(rootDir, "docs");
const releasesPath = path.join(rootDir, "data", "releases.json");
const subscriptionsPath = path.join(rootDir, "config", "subscriptions.json");
const publicUrl = "https://jervin6.github.io/card-release-calendar/";
const checkOnly = process.argv.includes("--check");

function foldLine(line) {
  const limit = 75;
  if (line.length <= limit) return line;
  const chunks = [];
  for (let index = 0; index < line.length; index += limit) {
    chunks.push(`${index === 0 ? "" : " "}${line.slice(index, index + limit)}`);
  }
  return chunks.join("\r\n");
}

function escapeICalText(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatUtcStamp(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function toDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid ISO date: ${value}`);
  return date;
}

function lastDataRevisionUtc() {
  try {
    const iso = execFileSync(
      "git",
      ["-C", rootDir, "log", "-1", "--format=%cI", "--", releasesPath, subscriptionsPath],
      { stdio: ["ignore", "pipe", "ignore"] }
    ).toString().trim();
    const date = new Date(iso);
    if (!Number.isNaN(date.getTime())) return date;
  } catch {
    // A tarball or shallow checkout may not have usable history.
  }
  return new Date();
}

function eventLines(release, revisionStamp) {
  const startsAt = toDate(release.startsAt);
  const endsAt = release.endsAt
    ? toDate(release.endsAt)
    : new Date(startsAt.getTime() + 60 * 60 * 1000);
  const details = [release.notes];
  if (release.sourceName || release.sourceUrl) {
    details.push(`Source: ${[release.sourceName, release.sourceUrl].filter(Boolean).join(" - ")}`);
  }
  const category = release.category === "tcg" ? "TCG" : "SPORTS CARDS";
  const lines = [
    "BEGIN:VEVENT",
    foldLine(`UID:${escapeICalText(release.id)}@card-release-calendar`),
    `DTSTAMP:${revisionStamp}`,
    `DTSTART:${formatUtcStamp(startsAt)}`,
    `DTEND:${formatUtcStamp(endsAt)}`,
    foldLine(`SUMMARY:${escapeICalText(release.title)}`),
    foldLine(`DESCRIPTION:${escapeICalText(details.filter(Boolean).join("\n"))}`),
    foldLine(`STATUS:${escapeICalText(release.status ?? "TENTATIVE")}`),
    foldLine(`LOCATION:${escapeICalText(release.location ?? "Online")}`),
    `CATEGORIES:${category}`,
    "TRANSP:TRANSPARENT"
  ];
  if (release.sourceUrl) lines.push(foldLine(`URL:${release.sourceUrl}`));
  lines.push("END:VEVENT");
  return lines;
}

function buildCalendar(releases, name) {
  const revisionStamp = formatUtcStamp(lastDataRevisionUtc());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Jordan Ervin//Card Release Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    foldLine(`X-WR-CALNAME:${name}`),
    "X-WR-TIMEZONE:UTC",
    "X-PUBLISHED-TTL:PT1H",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H"
  ];
  for (const release of releases) lines.push(...eventLines(release, revisionStamp));
  lines.push("END:VCALENDAR");
  return `${lines.join("\r\n")}\r\n`;
}

function pacificDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function formatDay(date) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "long",
    month: "short",
    day: "numeric"
  }).format(date);
}

function formatTime(date) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short"
  }).format(date);
}

function groupUpcoming(releases) {
  const today = pacificDateKey();
  const groups = new Map();
  for (const release of releases.filter((item) => item.startsAt.slice(0, 10) >= today)) {
    const dateKey = release.startsAt.slice(0, 10);
    if (!groups.has(dateKey)) groups.set(dateKey, []);
    groups.get(dateKey).push(release);
  }
  return groups;
}

function releaseRow(release) {
  const category = release.category === "tcg" ? "tcg" : "sports";
  const type = category === "tcg" ? release.game ?? "TCG" : release.sport ?? "Sports cards";
  const source = release.sourceUrl
    ? `<a class="source" href="${escapeHtml(release.sourceUrl)}" target="_blank" rel="noopener">${escapeHtml(release.sourceName ?? "Source")}</a>`
    : escapeHtml(release.sourceName ?? "Curated");
  const tentative = release.status === "TENTATIVE" ? `<span class="status">Tentative</span>` : "";
  return `<article class="drop" data-category="${category}">
    <span class="edge" aria-hidden="true"></span>
    <div class="drop-copy">
      <div class="drop-meta"><span>${escapeHtml(type)}</span>${tentative}</div>
      <h3>${escapeHtml(release.title)}</h3>
      <p>${escapeHtml(formatTime(toDate(release.startsAt)))} <span aria-hidden="true">/</span> ${source}</p>
    </div>
  </article>`;
}

function subscribeMenu() {
  const feeds = [
    ["All drops", "cards.ics"],
    ["Sports cards", "sports.ics"],
    ["TCG", "tcg.ics"]
  ];
  return feeds.map(([label, file]) => {
    const httpsUrl = `${publicUrl}${file}`;
    const webcalUrl = httpsUrl.replace(/^https:/, "webcal:");
    const googleUrl = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcalUrl)}`;
    return `<div class="feed-choice">
      <strong>${label}</strong>
      <span><a href="${webcalUrl}">Apple</a><a href="${googleUrl}" target="_blank" rel="noopener">Google</a><button type="button" data-copy="${httpsUrl}">Copy URL</button></span>
    </div>`;
  }).join("");
}

function buildHtml(releases) {
  const upcoming = groupUpcoming(releases);
  const today = pacificDateKey();
  const counts = releases.reduce((result, release) => {
    if (release.startsAt.slice(0, 10) >= today) result[release.category] += 1;
    return result;
  }, { sports: 0, tcg: 0 });
  const groups = [...upcoming.entries()].map(([dateKey, dayReleases]) => {
    const firstDate = toDate(dayReleases[0].startsAt);
    return `<section class="day-group" data-day="${dateKey}">
      <header class="day-label"><time datetime="${dateKey}">${escapeHtml(formatDay(firstDate))}</time><span data-day-count>${dayReleases.length} drop${dayReleases.length === 1 ? "" : "s"}</span></header>
      <div class="day-drops">${dayReleases.map(releaseRow).join("")}</div>
    </section>`;
  }).join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Card Release Calendar | Sports cards + TCG drops</title>
    <meta name="description" content="A shareable calendar of upcoming sports-card and TCG releases.">
    <link rel="canonical" href="${publicUrl}">
    <meta property="og:type" content="website">
    <meta property="og:title" content="Card Release Calendar">
    <meta property="og:description" content="Sports cards + TCG drops, in one calendar.">
    <meta property="og:url" content="${publicUrl}">
    <meta property="og:image" content="${publicUrl}og.png">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="Card Release Calendar">
    <meta name="twitter:description" content="Sports cards + TCG drops, in one calendar.">
    <meta name="twitter:image" content="${publicUrl}og.png">
    <style>
      :root {
        color-scheme: light;
        --card-stock: #f1eee5;
        --sheet: #fffdf7;
        --ink: #1e1d1a;
        --ink-secondary: #5b5952;
        --ink-tertiary: #77736a;
        --ink-muted: #9d988e;
        --line: rgba(30, 29, 26, .16);
        --line-soft: rgba(30, 29, 26, .09);
        --line-strong: rgba(30, 29, 26, .32);
        --collector-red: #b83427;
        --felt-green: #24684f;
        --sticker-yellow: #e0b83e;
        --control: #ebe7dd;
        --control-hover: #e2ddd1;
        --focus: #1e1d1a;
      }
      * { box-sizing: border-box; }
      body { margin: 0; background: var(--card-stock); color: var(--ink); font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      button, a { -webkit-tap-highlight-color: transparent; }
      button { font: inherit; }
      a { color: inherit; }
      .topbar { min-height: 52px; display: flex; align-items: center; justify-content: space-between; padding: 0 24px; border-bottom: 1px solid var(--line); }
      .wordmark { display: flex; align-items: center; gap: 10px; font-weight: 760; font-size: 14px; }
      .wordmark-mark { width: 24px; height: 32px; border: 2px solid var(--ink); background: var(--sheet); position: relative; }
      .wordmark-mark::after { content: ""; position: absolute; inset: 4px; border: 1px solid var(--collector-red); }
      .freshness { color: var(--ink-tertiary); font-size: 12px; }
      main { width: min(1040px, calc(100% - 40px)); margin: 0 auto; padding: 48px 0 72px; }
      .calendar-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 28px; padding-bottom: 28px; border-bottom: 1px solid var(--line-strong); }
      .kicker { margin: 0 0 8px; color: var(--collector-red); font-size: 12px; font-weight: 800; text-transform: uppercase; }
      h1 { max-width: 650px; margin: 0; font-family: Georgia, "Times New Roman", serif; font-size: 42px; line-height: 1.04; font-weight: 700; letter-spacing: 0; }
      .subhead { margin: 10px 0 0; color: var(--ink-secondary); font-size: 16px; }
      .actions { display: flex; align-items: center; gap: 8px; flex: none; }
      .command, .subscribe > summary { min-height: 40px; display: inline-flex; align-items: center; justify-content: center; padding: 0 14px; border: 1px solid var(--line-strong); border-radius: 6px; background: var(--sheet); color: var(--ink); font-weight: 720; font-size: 13px; cursor: pointer; }
      .command:hover, .subscribe > summary:hover { background: var(--control); }
      .command:focus-visible, .subscribe > summary:focus-visible, .filter button:focus-visible, .feed-choice button:focus-visible, a:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
      .subscribe { position: relative; }
      .subscribe > summary { list-style: none; }
      .subscribe > summary::-webkit-details-marker { display: none; }
      .subscribe[open] > summary { background: var(--ink); color: var(--sheet); }
      .feed-menu { position: absolute; z-index: 4; top: 48px; right: 0; width: 296px; padding: 8px 12px; background: var(--sheet); border: 1px solid var(--line-strong); border-radius: 6px; }
      .feed-choice { padding: 10px 0; border-bottom: 1px solid var(--line-soft); }
      .feed-choice:last-child { border-bottom: 0; }
      .feed-choice strong { display: block; margin-bottom: 7px; font-size: 13px; }
      .feed-choice span { display: flex; gap: 14px; align-items: center; }
      .feed-choice a, .feed-choice button { border: 0; padding: 0; background: none; color: var(--felt-green); font-size: 12px; font-weight: 750; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }
      .viewbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 20px 0; border-bottom: 1px solid var(--line); }
      .filter { display: inline-grid; grid-template-columns: repeat(3, minmax(88px, auto)); padding: 3px; border: 1px solid var(--line); border-radius: 6px; background: var(--control); }
      .filter button { min-height: 34px; border: 0; border-radius: 4px; padding: 0 12px; background: transparent; color: var(--ink-secondary); font-size: 13px; font-weight: 720; cursor: pointer; }
      .filter button[aria-pressed="true"] { background: var(--sheet); color: var(--ink); border: 1px solid var(--line); }
      .result-count { color: var(--ink-tertiary); font-size: 12px; }
      .drop-board { min-height: 240px; }
      .day-group { display: grid; grid-template-columns: 156px minmax(0, 1fr); gap: 24px; padding: 24px 0; border-bottom: 1px solid var(--line); }
      .day-label time { display: block; font-family: Georgia, "Times New Roman", serif; font-size: 17px; font-weight: 700; }
      .day-label span { display: block; margin-top: 5px; color: var(--ink-tertiary); font-size: 11px; text-transform: uppercase; }
      .day-drops { display: grid; gap: 8px; }
      .drop { min-height: 86px; display: grid; grid-template-columns: 5px 1fr; background: var(--sheet); border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
      .edge { background: var(--collector-red); }
      .drop[data-category="tcg"] .edge { background: var(--felt-green); }
      .drop-copy { min-width: 0; padding: 14px 16px; }
      .drop-meta { display: flex; align-items: center; gap: 8px; min-height: 16px; color: var(--ink-tertiary); font-size: 10px; font-weight: 820; text-transform: uppercase; }
      .status { padding-left: 8px; border-left: 1px solid var(--line); color: #82650d; }
      .drop h3 { margin: 4px 0 6px; font-family: Georgia, "Times New Roman", serif; font-size: 17px; line-height: 1.25; letter-spacing: 0; overflow-wrap: anywhere; }
      .drop p { margin: 0; color: var(--ink-tertiary); font-size: 12px; }
      .drop p span { padding: 0 4px; color: var(--ink-muted); }
      .source { color: var(--felt-green); text-underline-offset: 3px; }
      .empty { display: none; padding: 64px 0; color: var(--ink-secondary); font-family: Georgia, "Times New Roman", serif; font-size: 20px; text-align: center; }
      .empty[data-visible="true"] { display: block; }
      footer { display: flex; justify-content: space-between; gap: 24px; padding-top: 28px; color: var(--ink-tertiary); font-size: 11px; }
      .toast { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); min-width: 180px; padding: 10px 14px; background: var(--ink); color: var(--sheet); border-radius: 4px; font-size: 12px; text-align: center; opacity: 0; pointer-events: none; transition: opacity .16s ease; }
      .toast[data-visible="true"] { opacity: 1; }
      [hidden] { display: none !important; }
      @media (max-width: 720px) {
        .topbar { padding: 0 16px; }
        main { width: min(100% - 28px, 1040px); padding-top: 32px; }
        .calendar-head { display: block; }
        h1 { font-size: 34px; }
        .actions { margin-top: 20px; }
        .actions > * { flex: 1; }
        .command, .subscribe > summary { width: 100%; }
        .feed-menu { left: auto; right: 0; width: min(296px, calc(100vw - 28px)); }
        .viewbar { align-items: flex-start; flex-direction: column; }
        .filter { width: 100%; grid-template-columns: repeat(3, 1fr); }
        .day-group { grid-template-columns: 1fr; gap: 12px; }
        .day-label { display: flex; align-items: baseline; justify-content: space-between; }
        footer { flex-direction: column; }
      }
      @media (prefers-reduced-motion: reduce) { .toast { transition: none; } }
    </style>
  </head>
  <body>
    <nav class="topbar" aria-label="Primary">
      <div class="wordmark"><span class="wordmark-mark" aria-hidden="true"></span><span>Card Release Calendar</span></div>
      <span class="freshness">Public calendar</span>
    </nav>
    <main>
      <header class="calendar-head">
        <div>
          <p class="kicker">Upcoming release board</p>
          <h1>Sports cards + TCG drops</h1>
          <p class="subhead">One calendar for the next set, box, or chase.</p>
        </div>
        <div class="actions">
          <button class="command" type="button" data-share>Share</button>
          <details class="subscribe">
            <summary>Subscribe</summary>
            <div class="feed-menu">${subscribeMenu()}</div>
          </details>
        </div>
      </header>
      <div class="viewbar">
        <div class="filter" role="group" aria-label="Release category">
          <button type="button" data-filter="all" aria-pressed="true">All</button>
          <button type="button" data-filter="sports" aria-pressed="false">Sports ${counts.sports}</button>
          <button type="button" data-filter="tcg" aria-pressed="false">TCG ${counts.tcg}</button>
        </div>
        <span class="result-count" aria-live="polite"></span>
      </div>
      <div class="drop-board">${groups}</div>
      <p class="empty" data-empty>No upcoming drops in this view.</p>
      <footer><span>Times shown in Pacific Time.</span><span>Tentative dates come from release calendars and can move.</span></footer>
    </main>
    <div class="toast" role="status" aria-live="polite"></div>
    <script>
      const filterButtons = [...document.querySelectorAll('[data-filter]')];
      const drops = [...document.querySelectorAll('.drop')];
      const groups = [...document.querySelectorAll('.day-group')];
      const resultCount = document.querySelector('.result-count');
      const empty = document.querySelector('[data-empty]');
      const toast = document.querySelector('.toast');
      let toastTimer;

      function showToast(message) {
        toast.textContent = message;
        toast.dataset.visible = 'true';
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { toast.dataset.visible = 'false'; }, 1800);
      }

      function applyFilter(view, updateUrl = true) {
        if (!['all', 'sports', 'tcg'].includes(view)) view = 'all';
        filterButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.filter === view)));
        drops.forEach((drop) => { drop.hidden = view !== 'all' && drop.dataset.category !== view; });
        groups.forEach((group) => {
          const dayCount = group.querySelectorAll('.drop:not([hidden])').length;
          group.hidden = dayCount === 0;
          group.querySelector('[data-day-count]').textContent = dayCount + (dayCount === 1 ? ' drop' : ' drops');
        });
        const visible = drops.filter((drop) => !drop.hidden).length;
        resultCount.textContent = visible + (visible === 1 ? ' upcoming drop' : ' upcoming drops');
        empty.dataset.visible = String(visible === 0);
        if (updateUrl) {
          const url = new URL(location.href);
          if (view === 'all') url.searchParams.delete('view'); else url.searchParams.set('view', view);
          history.replaceState(null, '', url);
        }
      }

      async function copyText(value, message) {
        try { await navigator.clipboard.writeText(value); showToast(message); }
        catch { showToast('Copy was blocked'); }
      }

      filterButtons.forEach((button) => button.addEventListener('click', () => applyFilter(button.dataset.filter)));
      document.querySelectorAll('[data-copy]').forEach((button) => button.addEventListener('click', () => copyText(button.dataset.copy, 'Calendar URL copied')));
      document.querySelector('[data-share]').addEventListener('click', async () => {
        const shareData = { title: 'Card Release Calendar', text: 'Sports cards + TCG drops', url: location.href };
        if (navigator.share) {
          try { await navigator.share(shareData); }
          catch (error) { if (error.name !== 'AbortError') showToast('Share was blocked'); }
        } else {
          await copyText(location.href, 'Share link copied');
        }
      });

      applyFilter(new URLSearchParams(location.search).get('view') || 'all', false);
    </script>
  </body>
</html>`;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function main() {
  const [rawReleases, subscriptions] = await Promise.all([
    readJson(releasesPath),
    readJson(subscriptionsPath)
  ]);
  const releases = collapseReleaseVariants(rawReleases)
    .filter((release) => matchesSubscriptions(release, subscriptions));
  const sports = releases.filter((release) => release.category === "sports");
  const tcg = releases.filter((release) => release.category === "tcg");

  if (checkOnly) {
    if (releases.length === 0) throw new Error("No releases matched the current subscriptions");
    if ((subscriptions.categories ?? []).includes("tcg") && tcg.length === 0) {
      throw new Error("TCG is enabled but no TCG releases matched");
    }
    process.stdout.write(`Validated ${releases.length} releases (${sports.length} sports, ${tcg.length} TCG)\n`);
    return;
  }

  await mkdir(docsDir, { recursive: true });
  await Promise.all([
    writeFile(path.join(docsDir, "cards.ics"), buildCalendar(releases, "Card Drops"), "utf8"),
    writeFile(path.join(docsDir, "sports.ics"), buildCalendar(sports, "Sports Card Drops"), "utf8"),
    writeFile(path.join(docsDir, "tcg.ics"), buildCalendar(tcg, "TCG Drops"), "utf8"),
    writeFile(path.join(docsDir, "index.html"), buildHtml(releases), "utf8")
  ]);
  process.stdout.write(`Generated ${releases.length} releases (${sports.length} sports, ${tcg.length} TCG)\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exitCode = 1;
});
