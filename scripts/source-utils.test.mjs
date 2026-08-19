import assert from "node:assert/strict";
import test from "node:test";
import {
  parseHobbyMonitorHtml,
  parseLorcanaMarkdown,
  parseMagicMarkdown,
  parseToppsMarkdown,
  parseWaxstatHtml
} from "./source-utils.mjs";

test("parses official Topps dates, times, and direct product links", () => {
  const rows = parseToppsMarkdown("[Wednesday, Aug 19 at 4:00 PM UTC 2026 Topps Chrome® Baseball](https://www.topps.com/pages/topps-chrome-baseball)");
  assert.deepEqual(rows[0], {
    y: 2026, m: 8, d: 19, rawName: "2026 Topps Chrome® Baseball",
    sourceName: "Topps", sourceUrl: "https://www.topps.com/pages/topps-chrome-baseball",
    sourceId: "topps-official", sourcePriority: 100, category: "sports",
    status: "CONFIRMED", utcHour: 16, utcMinute: 0
  });
  const season = parseToppsMarkdown("2026\n\n[Thursday, Aug 20 at 4:00 PM UTC 2025-26 Topps Motif Basketball](https://www.topps.com/pages/topps-motif-basketball)");
  assert.equal(season[0].y, 2026);
  assert.equal(season[0].rawName, "2025-26 Topps Motif Basketball");
});

test("parses official Magic products", () => {
  const rows = parseMagicMarkdown("November 13, 2026\n\n### Magic: The Gathering | Star Trek\n\n[Learn More](https://magic.wizards.com/en/products/star-trek)");
  assert.equal(rows[0].rawName, "Magic: The Gathering | Star Trek");
  assert.equal(rows[0].sourcePriority, 100);
});

test("parses Lorcana prerelease and everywhere dates", () => {
  const rows = parseLorcanaMarkdown("Title: Hyperia City | Disney Lorcana\n\n## Prerelease: October 16, 2026\n\n## Everywhere: October 23, 2026", "https://www.disneylorcana.com/en-US/product/hyperia-city");
  assert.deepEqual(rows.map((row) => [row.rawName, row.y, row.m, row.d]), [
    ["Disney Lorcana: Hyperia City Prerelease", 2026, 10, 16],
    ["Disney Lorcana: Hyperia City", 2026, 10, 23]
  ]);
  assert.equal(rows[0].releaseKind, "prerelease");
});

test("parses Waxstat product-specific links", () => {
  const html = '<div class="d-flex wax-body w-100"><div class="wax-name"><div><a href="/boxes/lorcana-hyperia-city-booster-box">Lorcana Hyperia City Booster Box</a></div></div><div class="wax-release-date text-right"><div>Oct 23, 2026</div></div></div>';
  const rows = parseWaxstatHtml(html, { id: "waxstat:disney", url: "https://www.waxstat.com/2026-disney-cards-release-calendar", category: "tcg" });
  assert.equal(rows[0].sourceUrl, "https://www.waxstat.com/boxes/lorcana-hyperia-city-booster-box");
});

test("parses Hobby Monitor release records", () => {
  const state = { queries: [{ state: { data: { data: [{ id: 1, title: "Disney Lorcana Hyperia City", sport: "Lorcana", releaseDate: "2026-10-23T00:00:00.000Z", slug: "lorcana-hyperia-city" }] } } }] };
  const html = `<script>window.__RQ_STATE__=${JSON.stringify(state)};</script>`;
  const rows = parseHobbyMonitorHtml(html);
  assert.equal(rows[0].game, "Disney Lorcana");
  assert.equal(rows[0].sourceUrl, "https://www.hobbymonitor.com/release/lorcana-hyperia-city");
});
