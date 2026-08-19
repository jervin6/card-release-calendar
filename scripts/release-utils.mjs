const SPORTS = [
  ["Baseball", /\bbaseball\b|\bMLB\b/i],
  ["Basketball", /\bbasketball\b|\bNBA\b|\bWNBA\b/i],
  ["Football", /\bfootball\b|\bNFL\b/i],
  ["Soccer", /\bsoccer\b|\bUEFA\b|\bPremier League\b|\bChampions League\b|\bLa Liga\b|\bBundesliga\b|\bMLS\b|\bFIFA\b|\bMerlin\b|\bMatch Attax\b/i],
  ["Formula 1", /\bformula\s*1\b|\bF1\b/i],
  ["Hockey", /\bhockey\b|\bNHL\b/i],
  ["WWE", /\bWWE\b|\bwrestling\b/i],
  ["UFC", /\bUFC\b/i]
];

const TCG_GAMES = [
  ["Pokemon", /\bpok[eé]mon\b/i],
  ["Magic: The Gathering", /\bmagic(?::|\s+the)?\s+gathering\b|\bMTG\b/i],
  ["Yu-Gi-Oh!", /\byu-?gi-?oh!?\b/i],
  ["One Piece", /\bone piece\b/i],
  ["Disney Lorcana", /\blorcana\b/i],
  ["Riftbound", /\briftbound\b/i],
  ["Flesh and Blood", /\bflesh\s+(?:and|&)\s+blood\b/i],
  ["Star Wars: Unlimited", /\bstar wars:? unlimited\b/i],
  ["Star Wars", /\bstar wars\b/i],
  ["Marvel", /\bmarvel\b/i],
  ["Jennie", /\bjennie\b/i],
  ["Digimon", /\bdigimon\b/i],
  ["Union Arena", /\bunion arena\b/i],
  ["Cardfight!! Vanguard", /\bcardfight\b|\bvanguard\b/i]
];

const FORMAT_SUFFIXES = [
  /\s*\[[^\]]*(?:english|cards?|booster|deck)[^\]]*\]\s*$/i,
  /\s*\(\d+\s+(?:packs?|boxes?|cards?|decks?)\)\s*$/i,
  /\s*\((?:walmart|target|fanatics|retail|hobby)[^)]*\)\s*$/i,
  /\s+(?:\d+[- ]?)?(?:box|pack|case|tin|display|multipack|blister)(?:es)?\s*$/i,
  /\s+(?:hobby|retail|blaster|blast|mega|jumbo|value|compact|collector'?s?|breaker'?s|delight|fat|cello|hanger|choice|super|lot)\s*$/i,
  /\s+(?:hobby|retail|blaster|blast|mega|jumbo|value|compact|collector'?s?|breaker'?s|delight|fat|cello|hanger|choice|super)\s+(?:box|pack|case|tin|display)\s*$/i,
  /\s+(?:booster|collector booster|play booster|draft booster|set booster)(?:\s+\d+[- ]?box)?(?:\s+(?:box|pack|case|display))?\s*$/i,
  /\s+(?:bundle|gift bundle|elite trainer box|etb|starter deck|structure deck|commander deck|spotlight deck|theme deck|draft night|pre-?release(?: kit)?|collection)\s*$/i,
  /\s+(?:first day issue|FDI|youth|kids|eco(?:\s+\d+)?|starter(?:\s+\d+)?|fanatics|london games|\d+)\s*$/i
];

export function stripEmoji(value) {
  return String(value)
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}️]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function canonicalReleaseTitle(value) {
  let title = stripEmoji(value)
    .replace(/\bHOT\b/gi, " ")
    .replace(/\s*[-–—]\s*First Day Issue.*$/i, "")
    .replace(/\s*\(FDI\)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();

  let previous;
  do {
    previous = title;
    for (const suffix of FORMAT_SUFFIXES) {
      title = title.replace(suffix, "").replace(/\s+/g, " ").trim();
    }
  } while (title !== previous);

  if (/^Pok[eé]mon\s+30th Celebration\b/i.test(title)) {
    return "Pokemon 30th Celebration";
  }

  if (/^Pok[eé]mon\b/i.test(title)) {
    const productMarker = title.match(/^(.*?)(?:\s+(?:\d+[- ]?(?:tin|box|pack)|elite trainer|booster|bundle|blister|poster|binder|tech sticker|knock out|mini|ultra premium|premium figure|figure collection|pok[eé]mon ex)\b)/i);
    if (productMarker?.[1]) title = productMarker[1];
  }

  return title.replace(/[-–—,]\s*$/g, "").trim();
}

export function normalizedTitle(value) {
  return canonicalReleaseTitle(value)
    .toLowerCase()
    .replace(/\btrading card game\b|\btcg\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function detectSport(value) {
  return SPORTS.find(([, pattern]) => pattern.test(value))?.[0] ?? null;
}

export function detectTcgGame(value) {
  return TCG_GAMES.find(([, pattern]) => pattern.test(value))?.[0] ?? null;
}

export function inferRelease(release) {
  const text = [release.title, ...(release.tags ?? []), release.game, release.sport]
    .filter(Boolean)
    .join(" ");
  const game = release.game ?? detectTcgGame(text);
  const sport = release.sport ?? (!game ? detectSport(text) : null);
  const category = game ? "tcg" : (release.category ?? "sports");
  return { ...release, category, ...(game ? { game } : {}), ...(sport ? { sport } : {}) };
}

export function releaseKey(release) {
  const inferred = inferRelease(release);
  const title = release.managedBy || release.sourceName === "waxstat.com"
    ? normalizedTitle(release.title)
    : String(release.title).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return `${inferred.category}:${title}:${String(release.startsAt).slice(0, 10)}`;
}

export function sourceAuthority(release) {
  const explicit = Number(release.sourcePriority);
  if (Number.isFinite(explicit)) return explicit;

  const source = `${release.sourceName ?? ""} ${release.sourceUrl ?? ""}`.toLowerCase();
  if (/topps\.com|magic\.wizards\.com|disneylorcana\.com|pokemon\.com|yugioh-card\.com|onepiece-cardgame\.com|digimoncard\.com|starwarsunlimited\.com|fabtcg\.com/.test(source)) return 100;
  if (/hobby\s*monitor|hobbymonitor\.com/.test(source)) return 70;
  if (/waxstat/.test(source)) return 70;
  if (/beckett/.test(source)) return 50;
  return 80;
}

export function releaseIdentity(release) {
  const inferred = inferRelease(release);
  const ignored = new Set(["card", "cards", "edition", "game", "tcg", "trading"]);
  let rawTokens = normalizedTitle(release.title).split(" ").filter(Boolean);
  if (inferred.category === "tcg") {
    if (/^20\d{2}$/.test(rawTokens[0])) rawTokens = rawTokens.slice(1);
  }
  if (rawTokens.includes("mls")) ignored.add("soccer");
  const tokens = rawTokens.filter((token) => !ignored.has(token));
  if (release.releaseKind === "prerelease") tokens.push("prerelease");
  tokens.sort();
  return `${inferred.category}:${tokens.join(" ")}`;
}

export function releaseFamilyIdentity(release) {
  const inferred = inferRelease(release);
  const ignored = new Set(["card", "cards", "edition", "flagship", "game", "tcg", "trading"]);
  let tokens = normalizedTitle(release.title).split(" ").filter(Boolean);
  const toppsProduct = tokens.includes("topps") || tokens.includes("bowman");
  if (inferred.category === "tcg" || toppsProduct) {
    if (/^20\d{2}$/.test(tokens[0])) tokens = tokens.slice(1);
    if (toppsProduct && /^\d{2}$/.test(tokens[0])) tokens = tokens.slice(1);
  }
  if (tokens.includes("mls")) ignored.add("soccer");
  const familyTokens = tokens.filter((token) => !ignored.has(token));
  if (release.releaseKind === "prerelease") familyTokens.push("prerelease");
  return `${inferred.category}:${familyTokens.sort().join(" ")}`;
}

function mergeSources(left, right) {
  const sources = [...(left.sources ?? []), ...(right.sources ?? [])];
  for (const release of [left, right]) {
    if (release.sourceName || release.sourceUrl) {
      sources.push({ name: release.sourceName, url: release.sourceUrl });
    }
  }
  const unique = new Map();
  for (const source of sources) {
    const key = source.id ?? source.name ?? source.url ?? "source";
    if (!unique.has(key)) unique.set(key, source);
  }
  return [...unique.values()];
}

export function collapseReleaseVariants(releases) {
  const byKey = new Map();

  for (const original of releases) {
    const release = inferRelease(original);
    const key = releaseKey(release);
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, release.sourceName === "waxstat.com"
        ? { ...release, title: canonicalReleaseTitle(release.title) }
        : release);
      continue;
    }

    const existingAuthority = sourceAuthority(existing);
    const releaseAuthority = sourceAuthority(release);
    const preferred = existingAuthority > releaseAuthority
      ? existing
      : releaseAuthority > existingAuthority
        ? release
        : existing.status === "CONFIRMED" ? existing : release;
    byKey.set(key, {
      ...existing,
      ...preferred,
      title: existing.sourceName === "waxstat.com"
        ? canonicalReleaseTitle(existing.title)
        : existing.title,
      tags: [...new Set([...(existing.tags ?? []), ...(release.tags ?? [])])],
      sources: mergeSources(existing, release)
    });
  }

  return [...byKey.values()].sort((left, right) => left.startsAt.localeCompare(right.startsAt));
}

function includesAny(haystack, values) {
  const normalized = haystack.toLowerCase();
  return values.some((value) => normalized.includes(String(value).toLowerCase()));
}

export function matchesSubscriptions(release, subscriptions) {
  const inferred = inferRelease(release);
  const categories = subscriptions.categories ?? ["sports"];
  if (!categories.includes(inferred.category)) {
    return false;
  }

  const haystack = [
    inferred.title,
    ...(inferred.tags ?? []),
    inferred.notes,
    inferred.game,
    inferred.sport
  ].filter(Boolean).join(" ");

  if (inferred.category === "tcg") {
    const games = subscriptions.tcg ?? [];
    return games.length === 0 || includesAny(haystack, games);
  }

  const sports = subscriptions.sports ?? subscriptions.keywords ?? [];
  return sports.length === 0 || includesAny(haystack, sports);
}

export const supportedTcgGames = TCG_GAMES.map(([name]) => name);
