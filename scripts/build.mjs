import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const docsDir = path.join(rootDir, "docs");
const releasesPath = path.join(rootDir, "data", "releases.json");
const subscriptionsPath = path.join(rootDir, "config", "subscriptions.json");

const checkOnly = process.argv.includes("--check");

function foldLine(line) {
  const limit = 75;
  if (line.length <= limit) {
    return line;
  }

  const chunks = [];
  for (let index = 0; index < line.length; index += limit) {
    const chunk = line.slice(index, index + limit);
    chunks.push(index === 0 ? chunk : ` ${chunk}`);
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

function formatUtcStamp(date) {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function toUtcOrThrow(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ISO date: ${value}`);
  }
  return date;
}

function matchesKeywords(release, keywords) {
  const haystack = [
    release.title,
    ...(release.tags ?? []),
    release.notes ?? ""
  ]
    .join(" ")
    .toLowerCase();

  return keywords.some((keyword) => haystack.includes(keyword.toLowerCase()));
}

function buildEventLines(release, generatedAtUtc) {
  const startsAt = toUtcOrThrow(release.startsAt);
  const endsAt = release.endsAt ? toUtcOrThrow(release.endsAt) : new Date(startsAt.getTime() + 60 * 60 * 1000);
  const descriptionParts = [];

  if (release.notes) {
    descriptionParts.push(release.notes);
  }

  if (release.sourceName || release.sourceUrl) {
    const sourceLine = [release.sourceName, release.sourceUrl].filter(Boolean).join(" - ");
    if (sourceLine) {
      descriptionParts.push(`Source: ${sourceLine}`);
    }
  }

  const lines = [
    "BEGIN:VEVENT",
    foldLine(`UID:${escapeICalText(release.id)}@card-release-calendar`),
    `DTSTAMP:${generatedAtUtc}`,
    `DTSTART:${formatUtcStamp(startsAt)}`,
    `DTEND:${formatUtcStamp(endsAt)}`,
    foldLine(`SUMMARY:${escapeICalText(release.title)}`),
    foldLine(`DESCRIPTION:${escapeICalText(descriptionParts.join("\n"))}`),
    foldLine(`STATUS:${escapeICalText(release.status ?? "CONFIRMED")}`),
    foldLine(`LOCATION:${escapeICalText(release.location ?? "Online")}`)
  ];

  if (release.sourceUrl) {
    lines.push(foldLine(`URL:${release.sourceUrl}`));
  }

  lines.push("END:VEVENT");
  return lines;
}

function buildCalendar(releases) {
  const generatedAtUtc = formatUtcStamp(new Date());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Jordan Ervin//Card Release Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Card Releases",
    "X-WR-TIMEZONE:UTC"
  ];

  for (const release of releases) {
    lines.push(...buildEventLines(release, generatedAtUtc));
  }

  lines.push("END:VCALENDAR");
  return `${lines.join("\r\n")}\r\n`;
}

function buildHtml(releases, keywords) {
  const items = releases.length
    ? releases
        .map((release) => {
          const startsAt = toUtcOrThrow(release.startsAt);
          const formattedStart = new Intl.DateTimeFormat("en-US", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
            timeZoneName: "short"
          }).format(startsAt);
          return `<li><strong>${escapeHtml(release.title)}</strong><br>${escapeHtml(
            formattedStart
          )}</li>`;
        })
        .join("\n")
    : "<li>No matching releases right now.</li>";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Card Release Calendar</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f6f5ef;
        --card: #fffef8;
        --ink: #171717;
        --accent: #0a7a57;
        --border: #d8d1c2;
      }
      body {
        margin: 0;
        font-family: Georgia, "Times New Roman", serif;
        background:
          radial-gradient(circle at top left, rgba(10, 122, 87, 0.14), transparent 35%),
          linear-gradient(180deg, #fbfaf5 0%, var(--bg) 100%);
        color: var(--ink);
      }
      main {
        max-width: 760px;
        margin: 0 auto;
        padding: 48px 20px 72px;
      }
      .card {
        background: var(--card);
        border: 1px solid var(--border);
        border-radius: 20px;
        padding: 28px;
        box-shadow: 0 18px 40px rgba(0, 0, 0, 0.08);
      }
      a {
        color: var(--accent);
      }
      .pill {
        display: inline-block;
        margin-right: 8px;
        margin-bottom: 8px;
        padding: 6px 10px;
        border-radius: 999px;
        background: rgba(10, 122, 87, 0.12);
        color: var(--accent);
      }
      ul {
        padding-left: 20px;
      }
    </style>
  </head>
  <body>
    <main>
      <div class="card">
        <p>Filtered iCal feed for subscribed card releases.</p>
        <h1>Card Release Calendar</h1>
        <p><a href="./cards.ics">Subscribe to cards.ics</a></p>
        <p>Current filters:</p>
        <div>${keywords.map((keyword) => `<span class="pill">${escapeHtml(keyword)}</span>`).join("")}</div>
        <p>Upcoming matches:</p>
        <ul>
          ${items}
        </ul>
      </div>
    </main>
  </body>
</html>`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function readJson(filePath) {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function main() {
  const [releases, subscriptions] = await Promise.all([
    readJson(releasesPath),
    readJson(subscriptionsPath)
  ]);

  const keywords = subscriptions.keywords ?? [];
  const filteredReleases = releases.filter((release) => matchesKeywords(release, keywords));
  const ics = buildCalendar(filteredReleases);
  const html = buildHtml(filteredReleases, keywords);

  if (checkOnly) {
    process.stdout.write(`Matched ${filteredReleases.length} release(s)\n`);
    return;
  }

  await mkdir(docsDir, { recursive: true });
  await Promise.all([
    writeFile(path.join(docsDir, "cards.ics"), ics, "utf8"),
    writeFile(path.join(docsDir, "index.html"), html, "utf8")
  ]);

  process.stdout.write(`Generated ${filteredReleases.length} release(s) into docs/cards.ics\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exitCode = 1;
});
