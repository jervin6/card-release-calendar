import { detectTcgGame } from "./release-utils.mjs";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

function text(value) {
  return decodeHtml(String(value).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

export function decodeHtml(value) {
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#8217;|&rsquo;/g, "'")
    .replace(/&#8211;|&ndash;/g, "–")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'");
}

function dateParts(value) {
  const match = String(value).trim().match(/^([A-Z][a-z]+)\s+(\d{1,2}),\s+(\d{4})$/);
  if (!match) return null;
  const shortIndex = MONTHS.indexOf(match[1]);
  const longIndex = LONG_MONTHS.indexOf(match[1]);
  const month = shortIndex >= 0 ? shortIndex + 1 : longIndex >= 0 ? longIndex + 1 : 0;
  return month ? { y: Number(match[3]), m: month, d: Number(match[2]) } : null;
}

function sourceRow(parts, values) {
  return parts ? { ...parts, ...values } : null;
}

export function parseToppsMarkdown(markdown) {
  const rows = [];
  const pageYear = Number(markdown.match(/^\s*(20\d{2})\s*$/m)?.[1]);
  const linePattern = /^\[(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s+([A-Z][a-z]{2})\s+(\d{1,2})(?:\s+at\s+(\d{1,2}):(\d{2})\s+(AM|PM)\s+UTC)?\s+(.+?)\]\((https:\/\/www\.topps\.com\/[^)]+)\)$/gm;
  let match;
  while ((match = linePattern.exec(markdown))) {
    let utcHour = null;
    if (match[3]) {
      utcHour = Number(match[3]) % 12 + (match[5] === "PM" ? 12 : 0);
    }
    const productYear = Number(match[6].match(/\b(20\d{2})\b/)?.[1]);
    rows.push({
      y: pageYear || productYear,
      m: MONTHS.indexOf(match[1]) + 1,
      d: Number(match[2]),
      rawName: text(match[6]),
      sourceName: "Topps",
      sourceUrl: match[7],
      sourceId: "topps-official",
      sourcePriority: 100,
      category: "sports",
      status: "CONFIRMED",
      ...(utcHour === null ? {} : { utcHour, utcMinute: Number(match[4]) })
    });
  }
  return rows.filter((row) => row.y && row.m > 0);
}

export function parseMagicMarkdown(markdown) {
  const rows = [];
  const pattern = /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})\s*\n+\s*###\s+(.+?)\s*\n+\s*\[Learn More\]\((https:\/\/magic\.wizards\.com\/[^)]+)\)/gm;
  let match;
  while ((match = pattern.exec(markdown))) {
    rows.push({
      y: Number(match[3]),
      m: LONG_MONTHS.indexOf(match[1]) + 1,
      d: Number(match[2]),
      rawName: text(match[4]),
      sourceName: "Magic: The Gathering",
      sourceUrl: match[5],
      sourceId: "magic-official",
      sourcePriority: 100,
      category: "tcg",
      game: "Magic: The Gathering",
      status: "CONFIRMED"
    });
  }
  return rows;
}

export function parseLorcanaMarkdown(markdown, sourceUrl) {
  const title = markdown.match(/^Title:\s*([^|\n]+)/m)?.[1]?.trim();
  if (!title || /page not found/i.test(title)) return [];
  const baseName = `Disney Lorcana: ${title.replace(/\s+by Ravensburger.*$/i, "").trim()}`;
  const rows = [];
  const prerelease = markdown.match(/^#{1,6}\s+Prerelease:\s*([A-Z][a-z]+\s+\d{1,2},\s+\d{4})/im);
  const everywhere = markdown.match(/^#{1,6}\s+Everywhere:\s*([A-Z][a-z]+\s+\d{1,2},\s+\d{4})/im);
  const available = markdown.match(/^#{1,6}\s+(?:Available|Coming)(?::|\s)+\s*([A-Z][a-z]+\s+\d{1,2},\s+\d{4})/im);
  const common = {
    sourceName: "Disney Lorcana",
    sourceUrl,
    sourceId: `lorcana-official:${new URL(sourceUrl).pathname.split("/").filter(Boolean).at(-1)}`,
    sourcePriority: 100,
    category: "tcg",
    game: "Disney Lorcana",
    status: "CONFIRMED"
  };
  if (prerelease) {
    const row = sourceRow(dateParts(prerelease[1]), { ...common, rawName: `${baseName} Prerelease`, releaseKind: "prerelease" });
    if (row) rows.push(row);
  }
  const publicDate = everywhere?.[1] ?? available?.[1];
  if (publicDate) {
    const row = sourceRow(dateParts(publicDate), { ...common, rawName: baseName });
    if (row) rows.push(row);
  }
  return rows;
}

export function parseWaxstatHtml(html, source) {
  const rows = [];
  const chunks = String(html).split(/<div class="d-flex wax-body[^"]*">/).slice(1);
  for (const chunk of chunks) {
    const name = chunk.match(/class="[^"]*wax-name[^"]*"[^>]*>[\s\S]*?<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    const date = chunk.match(/class="[^"]*wax-release-date[^"]*"[^>]*>\s*<div[^>]*>([\s\S]*?)<\/div>/);
    if (!name || !date) continue;
    const parts = dateParts(text(date[1]));
    if (!parts) continue;
    rows.push({
      ...parts,
      rawName: text(name[2]),
      sourceName: "waxstat.com",
      sourceUrl: new URL(name[1], "https://www.waxstat.com").href,
      sourceCalendarUrl: source.url,
      sourceId: source.id,
      sourcePriority: 70,
      category: source.category,
      game: source.game,
      status: "TENTATIVE"
    });
  }
  return rows;
}

function findReleaseRecords(value, records = new Map()) {
  if (!value || typeof value !== "object") return records;
  if (Array.isArray(value)) {
    for (const item of value) findReleaseRecords(item, records);
    return records;
  }
  if (value.title && value.releaseDate && value.slug) records.set(value.id ?? value.slug, value);
  for (const child of Object.values(value)) findReleaseRecords(child, records);
  return records;
}

export function parseHobbyMonitorHtml(html) {
  const marker = "window.__RQ_STATE__=";
  const start = String(html).indexOf(marker);
  if (start < 0) return [];
  const jsonStart = start + marker.length;
  const jsonEnd = String(html).indexOf("</script>", jsonStart);
  if (jsonEnd < 0) return [];
  const state = JSON.parse(String(html).slice(jsonStart, jsonEnd).replace(/;\s*$/, ""));
  const records = findReleaseRecords(state);
  const rows = [];
  for (const record of records.values()) {
    const date = String(record.releaseDate).slice(0, 10).split("-").map(Number);
    if (date.length !== 3 || date.some((part) => !part)) continue;
    const game = detectTcgGame(`${record.title} ${record.sport ?? ""}`);
    rows.push({
      y: date[0],
      m: date[1],
      d: date[2],
      rawName: text(record.title),
      sourceName: "Hobby Monitor",
      sourceUrl: `https://www.hobbymonitor.com/release/${record.slug}`,
      sourceId: "hobby-monitor",
      sourcePriority: 70,
      category: game ? "tcg" : "sports",
      ...(game ? { game } : {}),
      status: "TENTATIVE"
    });
  }
  return rows;
}
