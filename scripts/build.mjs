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

// Lucide icon geometry, bundled under the ISC license in LICENSES/LUCIDE.txt.
const symbolGeometry = {
  "badge-check": '<path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"/><path d="m9 12 2 2 4-4"/>',
  "calendar-days": '<path d="M8 2v3"/><path d="M16 2v3"/><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M8 13h.01"/><path d="M12 13h.01"/><path d="M16 13h.01"/><path d="M8 17h.01"/><path d="M12 17h.01"/><path d="M16 17h.01"/>',
  "calendar-plus": '<path d="M16 18h6"/><path d="M16 2v3"/><path d="M19 15v6"/><path d="M21 11.5V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8.3"/><path d="M3 9h18"/><path d="M8 2v3"/>',
  "calendar-range": '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M16 2v3"/><path d="M3 9h18"/><path d="M8 2v3"/><path d="M17 13h-6"/><path d="M13 17H7"/><path d="M7 13h.01"/><path d="M17 17h.01"/>',
  "chevron-down": '<path d="m6 9 6 6 6-6"/>',
  "circle-dot": '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="1"/>',
  "circle-dot-dashed": '<path d="M10.1 2.18a9.93 9.93 0 0 1 3.8 0"/><path d="M17.6 3.71a9.95 9.95 0 0 1 2.69 2.7"/><path d="M21.82 10.1a9.93 9.93 0 0 1 0 3.8"/><path d="M20.29 17.6a9.95 9.95 0 0 1-2.7 2.69"/><path d="M13.9 21.82a9.94 9.94 0 0 1-3.8 0"/><path d="M6.4 20.29a9.95 9.95 0 0 1-2.69-2.7"/><path d="M2.18 13.9a9.93 9.93 0 0 1 0-3.8"/><path d="M3.71 6.4a9.95 9.95 0 0 1 2.7-2.69"/><circle cx="12" cy="12" r="1"/>',
  "clock-3": '<circle cx="12" cy="12" r="10"/><path d="M12 6v6h4"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  "external-link": '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  gauge: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
  "globe-2": '<path d="M21.54 15H17a2 2 0 0 0-2 2v4.54"/><path d="M7 3.34V5a3 3 0 0 0 3 3 2 2 0 0 1 2 2c0 1.1.9 2 2 2s2-.9 2-2 .9-2 2-2h3.17"/><path d="M11 21.95V18a2 2 0 0 0-2-2 2 2 0 0 1-2-2v-1a2 2 0 0 0-2-2H2.05"/><circle cx="12" cy="12" r="10"/>',
  goal: '<path d="M12 13V2l8 4-8 4"/><path d="M20.561 10.222a9 9 0 1 1-12.55-5.29"/><path d="M8.002 9.997a5 5 0 1 0 8.9 2.02"/>',
  "layers-3": '<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/><path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"/><path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"/>',
  "layout-grid": '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
  share: '<path d="M12 2v13"/><path d="m16 6-4-4-4 4"/><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>',
  "triangle-alert": '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  trophy: '<path d="M10 14.66V17a1 1 0 0 1-1 1 2 2 0 0 0-2 2v2"/><path d="M14 14.66V17a1 1 0 0 0 1 1 2 2 0 0 1 2 2v2"/><path d="M17.916 10H19.5A2.5 2.5 0 0 0 22 7.5V5a1 1 0 0 0-1-1h-3"/><path d="M4 22h16"/><path d="M6 9a6 6 0 0 0 12 0V3a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1z"/><path d="M6.084 10H4.5A2.5 2.5 0 0 1 2 7.5V5a1 1 0 0 1 1-1h3"/>'
};

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

function symbol(name, className = "") {
  const geometry = symbolGeometry[name];
  if (!geometry) throw new Error(`Unknown symbol: ${name}`);
  return `<svg class="symbol ${className}" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${geometry}</svg>`;
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

function formatDayParts(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "short",
    month: "short",
    day: "numeric"
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
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
  const categoryIcon = category === "tcg"
    ? "layers-3"
    : {
        Baseball: "circle-dot",
        Basketball: "circle-dot-dashed",
        Soccer: "goal",
        "Formula 1": "gauge"
      }[release.sport] ?? "trophy";
  const source = release.sourceUrl
    ? `<a class="source" href="${escapeHtml(release.sourceUrl)}" target="_blank" rel="noopener"><span>${escapeHtml(release.sourceName ?? "Source")}</span>${symbol("external-link")}</a>`
    : `<span>${escapeHtml(release.sourceName ?? "Curated")}</span>`;
  const tentative = release.status === "TENTATIVE"
    ? `<span class="status">${symbol("triangle-alert")}<span>Tentative</span></span>`
    : `<span class="status confirmed">${symbol("badge-check")}<span>Confirmed</span></span>`;
  return `<article class="drop" data-category="${category}">
    <div class="drop-symbol" aria-hidden="true">${symbol(categoryIcon)}</div>
    <div class="drop-copy">
      <div class="drop-meta"><span>${escapeHtml(type)}</span>${tentative}</div>
      <h3>${escapeHtml(release.title)}</h3>
      <div class="drop-info"><span>${symbol("clock-3")}<span>${escapeHtml(formatTime(toDate(release.startsAt)))}</span></span>${source}</div>
    </div>
  </article>`;
}

function subscribeMenu() {
  const feeds = [
    ["All drops", "cards.ics", "calendar-range"],
    ["Sports cards", "sports.ics", "trophy"],
    ["TCG", "tcg.ics", "layers-3"]
  ];
  return feeds.map(([label, file, feedIcon]) => {
    const httpsUrl = `${publicUrl}${file}`;
    const webcalUrl = httpsUrl.replace(/^https:/, "webcal:");
    const googleUrl = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcalUrl)}`;
    return `<div class="feed-choice">
      <div class="feed-title">${symbol(feedIcon)}<strong>${label}</strong></div>
      <div class="feed-actions"><a href="${webcalUrl}">${symbol("calendar-plus")}<span>Apple</span></a><a href="${googleUrl}" target="_blank" rel="noopener">${symbol("external-link")}<span>Google</span></a><button type="button" data-copy="${httpsUrl}">${symbol("copy")}<span>Copy</span></button></div>
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
    const day = formatDayParts(firstDate);
    return `<section class="day-group" data-day="${dateKey}">
      <header class="day-label">
        <time class="date-ticket" datetime="${dateKey}" aria-label="${escapeHtml(formatDay(firstDate))}"><span>${escapeHtml(day.weekday)}</span><strong>${escapeHtml(day.day)}</strong><span>${escapeHtml(day.month)}</span></time>
        <span class="day-count" data-day-count>${dayReleases.length} drop${dayReleases.length === 1 ? "" : "s"}</span>
      </header>
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
        --card-stock: #efede6;
        --sleeve: #fbfaf6;
        --sleeve-raised: #ffffff;
        --ink: #191918;
        --ink-secondary: #54534f;
        --ink-tertiary: #74716a;
        --ink-muted: #9a968d;
        --holo-line: rgba(25, 25, 24, .14);
        --holo-line-soft: rgba(25, 25, 24, .08);
        --holo-line-strong: rgba(25, 25, 24, .28);
        --collector-red: #b43b30;
        --collector-red-wash: #f6e9e6;
        --felt-green: #25664f;
        --felt-green-wash: #e7f0eb;
        --sticker-yellow: #e3bb45;
        --sticker-yellow-wash: #faf2d8;
        --control-well: #e4e1d9;
        --control-hover: #dcd8cf;
        --focus-ring: #191918;
      }
      * { box-sizing: border-box; }
      html { background: var(--card-stock); }
      body { margin: 0; background: var(--card-stock); color: var(--ink); font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif; }
      button, a { -webkit-tap-highlight-color: transparent; }
      button { font: inherit; }
      a { color: inherit; }
      .symbol { width: 18px; height: 18px; flex: none; stroke-width: 1.9; }
      .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
      .topbar { position: sticky; z-index: 8; top: 0; min-height: 60px; display: flex; align-items: center; justify-content: space-between; padding: 0 24px; background: rgba(239, 237, 230, .9); border-bottom: 1px solid var(--holo-line); backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px); }
      .wordmark { display: flex; align-items: center; gap: 10px; font-weight: 760; font-size: 14px; }
      .wordmark-mark { width: 36px; height: 36px; display: inline-flex; align-items: center; justify-content: center; border-radius: 8px; background: var(--ink); color: var(--sleeve); }
      .wordmark-mark .symbol { width: 20px; height: 20px; stroke-width: 2; }
      .freshness { display: inline-flex; align-items: center; gap: 7px; color: var(--ink-tertiary); font-size: 12px; font-weight: 650; }
      .freshness .symbol { width: 15px; height: 15px; }
      main { width: min(1080px, calc(100% - 40px)); margin: 0 auto; padding: 52px 0 80px; }
      .calendar-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 32px; padding-bottom: 30px; border-bottom: 1px solid var(--holo-line-strong); }
      .kicker { display: flex; align-items: center; gap: 7px; margin: 0 0 10px; color: var(--collector-red); font-size: 11px; font-weight: 800; text-transform: uppercase; }
      .kicker .symbol { width: 15px; height: 15px; stroke-width: 2.2; }
      h1 { max-width: 680px; margin: 0; font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif; font-size: 46px; line-height: 1.03; font-weight: 820; letter-spacing: 0; }
      .subhead { margin: 12px 0 0; color: var(--ink-secondary); font-size: 16px; line-height: 1.45; }
      .actions { display: flex; align-items: center; gap: 8px; flex: none; }
      .icon-command, .subscribe > summary { min-height: 42px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--holo-line-strong); border-radius: 8px; background: var(--sleeve-raised); color: var(--ink); cursor: pointer; }
      .icon-command { width: 42px; padding: 0; }
      .subscribe > summary { gap: 8px; padding: 0 12px; font-weight: 720; font-size: 13px; }
      .icon-command:hover, .subscribe > summary:hover { background: var(--control-well); }
      .icon-command:active, .subscribe > summary:active { background: var(--control-hover); }
      .icon-command:focus-visible, .subscribe > summary:focus-visible, .filter button:focus-visible, .feed-actions button:focus-visible, a:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
      .subscribe { position: relative; }
      .subscribe > summary { list-style: none; }
      .subscribe > summary::-webkit-details-marker { display: none; }
      .subscribe > summary .chevron { width: 14px; height: 14px; color: var(--ink-tertiary); transition: transform .16s ease; }
      .subscribe[open] > summary { background: var(--ink); color: var(--sleeve); }
      .subscribe[open] > summary .chevron { color: var(--sleeve); transform: rotate(180deg); }
      .feed-menu { position: absolute; z-index: 4; top: 50px; right: 0; width: 340px; padding: 8px 14px; background: var(--sleeve-raised); border: 1px solid var(--holo-line-strong); border-radius: 8px; }
      .feed-choice { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--holo-line-soft); }
      .feed-choice:last-child { border-bottom: 0; }
      .feed-title { display: flex; align-items: center; gap: 8px; min-width: 0; }
      .feed-title .symbol { width: 17px; height: 17px; color: var(--ink-secondary); }
      .feed-title strong { font-size: 13px; }
      .feed-actions { display: flex; align-items: center; gap: 4px; }
      .feed-actions a, .feed-actions button { min-width: 32px; min-height: 32px; display: inline-flex; align-items: center; justify-content: center; gap: 5px; border: 0; border-radius: 6px; padding: 0 7px; background: transparent; color: var(--felt-green); font-size: 11px; font-weight: 750; cursor: pointer; text-decoration: none; }
      .feed-actions a:hover, .feed-actions button:hover { background: var(--felt-green-wash); }
      .feed-actions .symbol { width: 14px; height: 14px; }
      .viewbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 20px 0; border-bottom: 1px solid var(--holo-line); }
      .filter { display: inline-grid; grid-template-columns: repeat(3, minmax(96px, auto)); padding: 4px; border: 1px solid var(--holo-line); border-radius: 8px; background: var(--control-well); }
      .filter button { min-height: 36px; display: inline-flex; align-items: center; justify-content: center; gap: 7px; border: 0; border-radius: 6px; padding: 0 12px; background: transparent; color: var(--ink-secondary); font-size: 13px; font-weight: 700; cursor: pointer; }
      .filter button:hover { color: var(--ink); }
      .filter button[aria-pressed="true"] { background: var(--sleeve-raised); color: var(--ink); border: 1px solid var(--holo-line); }
      .filter button .symbol { width: 16px; height: 16px; }
      .filter-count { min-width: 20px; color: var(--ink-tertiary); font-family: "SF Mono", ui-monospace, monospace; font-size: 10px; font-variant-numeric: tabular-nums; }
      .result-count { display: inline-flex; align-items: center; gap: 7px; color: var(--ink-tertiary); font-size: 12px; }
      .result-count .symbol { width: 15px; height: 15px; }
      .drop-board { min-height: 240px; }
      .day-group { display: grid; grid-template-columns: 112px minmax(0, 1fr); gap: 24px; padding: 26px 0; border-bottom: 1px solid var(--holo-line); }
      .day-label { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; }
      .date-ticket { width: 84px; height: 86px; display: grid; grid-template-rows: 20px 1fr 20px; align-items: center; justify-items: center; overflow: hidden; border: 1px solid var(--holo-line-strong); border-radius: 8px; background: var(--sleeve-raised); color: var(--ink); text-decoration: none; }
      .date-ticket span { color: var(--ink-tertiary); font-size: 10px; font-weight: 820; text-transform: uppercase; }
      .date-ticket strong { font-family: "SF Mono", ui-monospace, monospace; font-size: 30px; font-weight: 650; line-height: 1; font-variant-numeric: tabular-nums; }
      .day-count { color: var(--ink-tertiary); font-size: 10px; font-weight: 750; text-transform: uppercase; }
      .day-drops { display: grid; gap: 8px; }
      .drop { min-height: 92px; display: grid; grid-template-columns: 56px minmax(0, 1fr); background: var(--sleeve); border: 1px solid var(--holo-line); border-radius: 8px; overflow: hidden; transition: border-color .16s ease, background-color .16s ease, transform .16s ease; }
      .drop:hover { background: var(--sleeve-raised); border-color: var(--holo-line-strong); transform: translateY(-1px); }
      .drop-symbol { display: flex; align-items: center; justify-content: center; background: var(--collector-red-wash); color: var(--collector-red); border-right: 1px solid var(--holo-line-soft); }
      .drop-symbol .symbol { width: 22px; height: 22px; stroke-width: 1.8; }
      .drop[data-category="tcg"] .drop-symbol { background: var(--felt-green-wash); color: var(--felt-green); }
      .drop-copy { min-width: 0; padding: 14px 16px; }
      .drop-meta { display: flex; align-items: center; gap: 9px; min-height: 17px; color: var(--ink-tertiary); font-size: 10px; font-weight: 800; text-transform: uppercase; }
      .status { display: inline-flex; align-items: center; gap: 4px; padding-left: 9px; border-left: 1px solid var(--holo-line); color: #81630b; }
      .status.confirmed { color: var(--felt-green); }
      .status .symbol { width: 12px; height: 12px; stroke-width: 2.2; }
      .drop h3 { margin: 5px 0 8px; font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif; font-size: 16px; line-height: 1.28; font-weight: 740; letter-spacing: 0; overflow-wrap: anywhere; }
      .drop-info { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; color: var(--ink-tertiary); font-size: 11px; }
      .drop-info > span, .source { display: inline-flex; align-items: center; gap: 5px; }
      .drop-info .symbol { width: 13px; height: 13px; }
      .source { color: var(--felt-green); font-weight: 680; text-decoration: none; }
      .source:hover span { text-decoration: underline; text-underline-offset: 3px; }
      .source .symbol { width: 12px; height: 12px; }
      .empty { display: none; align-items: center; justify-content: center; gap: 8px; padding: 64px 0; color: var(--ink-secondary); font-size: 18px; font-weight: 700; text-align: center; }
      .empty[data-visible="true"] { display: flex; }
      footer { display: flex; justify-content: space-between; gap: 24px; padding-top: 28px; color: var(--ink-tertiary); font-size: 11px; }
      footer span { display: inline-flex; align-items: center; gap: 6px; }
      footer .symbol { width: 14px; height: 14px; }
      .toast { position: fixed; z-index: 12; left: 50%; bottom: 24px; transform: translateX(-50%); min-width: 190px; padding: 11px 14px; background: var(--ink); color: var(--sleeve); border-radius: 8px; font-size: 12px; font-weight: 650; text-align: center; opacity: 0; pointer-events: none; transition: opacity .16s ease; }
      .toast[data-visible="true"] { opacity: 1; }
      [hidden] { display: none !important; }
      @media (max-width: 720px) {
        .topbar { padding: 0 16px; }
        main { width: min(100% - 28px, 1080px); padding-top: 34px; }
        .calendar-head { display: block; }
        h1 { font-size: 36px; }
        .actions { margin-top: 20px; }
        .subscribe { flex: 1; }
        .subscribe > summary { width: 100%; }
        .feed-menu { left: auto; right: 0; width: min(340px, calc(100vw - 28px)); }
        .viewbar { align-items: flex-start; flex-direction: column; }
        .filter { width: 100%; grid-template-columns: repeat(3, 1fr); }
        .filter button { min-width: 0; padding: 0 8px; }
        .day-group { grid-template-columns: 1fr; gap: 12px; padding: 22px 0; }
        .day-label { flex-direction: row; align-items: center; justify-content: space-between; }
        .date-ticket { width: 136px; height: 42px; grid-template-columns: 1fr 44px 1fr; grid-template-rows: 1fr; }
        .date-ticket strong { font-size: 20px; }
        footer { flex-direction: column; }
      }
      @media (max-width: 430px) {
        .wordmark { font-size: 12px; }
        .freshness span { display: none; }
        .feed-choice { grid-template-columns: 1fr; }
        .feed-actions { justify-content: flex-start; }
        .drop { grid-template-columns: 46px minmax(0, 1fr); }
        .drop-symbol .symbol { width: 19px; height: 19px; }
        .drop-copy { padding: 13px 12px; }
      }
      @media (prefers-reduced-motion: reduce) { .toast { transition: none; } }
    </style>
  </head>
  <body>
    <nav class="topbar" aria-label="Primary">
      <div class="wordmark"><span class="wordmark-mark" aria-hidden="true">${symbol("calendar-days")}</span><span>Card Release Calendar</span></div>
      <span class="freshness">${symbol("globe-2")}<span>Public calendar</span></span>
    </nav>
    <main>
      <header class="calendar-head">
        <div>
          <p class="kicker">${symbol("calendar-range")}<span>Upcoming release board</span></p>
          <h1>Sports cards + TCG drops</h1>
          <p class="subhead">One calendar for the next set, box, or chase.</p>
        </div>
        <div class="actions">
          <button class="icon-command" type="button" data-share aria-label="Share calendar" title="Share calendar">${symbol("share")}</button>
          <details class="subscribe">
            <summary>${symbol("calendar-plus")}<span>Subscribe</span>${symbol("chevron-down", "chevron")}</summary>
            <div class="feed-menu">${subscribeMenu()}</div>
          </details>
        </div>
      </header>
      <div class="viewbar">
        <div class="filter" role="group" aria-label="Release category">
          <button type="button" data-filter="all" aria-pressed="true">${symbol("layout-grid")}<span>All</span><span class="filter-count">${counts.sports + counts.tcg}</span></button>
          <button type="button" data-filter="sports" aria-pressed="false">${symbol("trophy")}<span>Sports</span><span class="filter-count">${counts.sports}</span></button>
          <button type="button" data-filter="tcg" aria-pressed="false">${symbol("layers-3")}<span>TCG</span><span class="filter-count">${counts.tcg}</span></button>
        </div>
        <span class="result-count" aria-live="polite">${symbol("calendar-range")}<span data-result-count></span></span>
      </div>
      <div class="drop-board">${groups}</div>
      <p class="empty" data-empty>${symbol("calendar-range")}<span>No upcoming drops in this view.</span></p>
      <footer><span>${symbol("clock-3")}<span>Times shown in Pacific Time.</span></span><span>${symbol("triangle-alert")}<span>Tentative dates can move.</span></span></footer>
    </main>
    <div class="toast" role="status" aria-live="polite"></div>
    <script>
      const filterButtons = [...document.querySelectorAll('[data-filter]')];
      const drops = [...document.querySelectorAll('.drop')];
      const groups = [...document.querySelectorAll('.day-group')];
      const resultCount = document.querySelector('[data-result-count]');
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
