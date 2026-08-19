import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalReleaseTitle,
  collapseReleaseVariants,
  inferRelease,
  matchesSubscriptions
} from "./release-utils.mjs";

test("collapses sports-card packaging variants to the set name", () => {
  const variants = [
    "2026-27 Topps English Premier League Soccer 30-Multipack",
    "2026-27 Topps English Premier League Soccer Tin",
    "2026-27 Topps English Premier League Soccer Eco 40",
    "2026-27 Topps English Premier League Soccer 24-Tin"
  ];
  assert.deepEqual(
    variants.map(canonicalReleaseTitle),
    variants.map(() => "2026-27 Topps English Premier League Soccer")
  );
});

test("keeps collector-relevant editions distinct", () => {
  assert.equal(
    canonicalReleaseTitle("2026 Topps Chrome Baseball Sapphire Edition"),
    "2026 Topps Chrome Baseball Sapphire Edition"
  );
});

test("collapses same-day Pokemon product formats to one drop", () => {
  const releases = [
    "Pokemon 30th Celebration Elite Trainer Box",
    "Pokemon 30th Celebration Poster Collection",
    "Pokemon 30th Celebration Booster Bundle"
  ].map((title, index) => ({
    id: `pokemon-${index}`,
    title,
    startsAt: "2026-09-16T09:00:00-07:00",
    sourceName: "waxstat.com",
    status: "TENTATIVE"
  }));
  const collapsed = collapseReleaseVariants(releases);
  assert.equal(collapsed.length, 1);
  assert.equal(collapsed[0].title, "Pokemon 30th Celebration");
  assert.equal(collapsed[0].category, "tcg");
});

test("applies independent sports and TCG subscriptions", () => {
  const subscriptions = {
    categories: ["sports", "tcg"],
    sports: ["Baseball"],
    tcg: ["Pokemon"]
  };
  assert.equal(matchesSubscriptions(inferRelease({ title: "2026 Topps Baseball" }), subscriptions), true);
  assert.equal(matchesSubscriptions(inferRelease({ title: "2026 Topps Hockey" }), subscriptions), false);
  assert.equal(matchesSubscriptions(inferRelease({ title: "Pokemon Mega Evolution" }), subscriptions), true);
  assert.equal(matchesSubscriptions(inferRelease({ title: "Magic: The Gathering Star Trek" }), subscriptions), false);
});
