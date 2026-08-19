# Card Release Calendar

Public release board and subscribable iCal feeds for sports cards and TCG drops.

## What it does

- Reads release entries from `data/releases.json`
- Reconciles official publisher calendars with Hobby Monitor and Waxstat
- Treats official Topps calendar dates and links as authoritative for Topps products
- Consolidates box, pack, tin, case, and retail variants into one set-level drop
- Filters sports and games using `config/subscriptions.json`, with Topps Star Wars, Marvel, and Jennie collector releases grouped into TCG
- Generates combined, sports-only, and TCG-only iCal feeds
- Generates the public release board in `docs/index.html`

## Quick start

```bash
npm run build
```

The public files are written to `docs/`.

To refresh imported releases first:

```bash
npm run sync -- --no-git
npm run build
```

## Share and subscribe

Share the public board:

<https://jervin6.github.io/card-release-calendar/>

The page has Apple Calendar, Google Calendar, and copyable feed links for:

- `cards.ics` - all drops
- `sports.ics` - sports cards only
- `tcg.ics` - TCG only

## Customize subscriptions

Edit `config/subscriptions.json` to change the visible sports or games.

```json
{
  "categories": ["sports", "tcg"],
  "sports": ["Baseball", "Basketball"],
  "tcg": ["Pokemon", "Magic: The Gathering"]
}
```

## Add releases

Edit `data/releases.json` and add entries like:

```json
{
  "id": "2026-bowman-baseball-preorder",
  "title": "2026 Bowman Baseball pre-order",
  "startsAt": "2026-04-13T11:00:00-05:00",
  "sourceUrl": "https://x.com/CardPurchaser/status/example",
  "notes": "Pre-order opens at 11:00 AM Central."
}
```

## Deploy with GitHub Pages

This repo includes a scheduled GitHub Actions workflow that rebuilds the feed and publishes `docs/`.

Imported future records are replaced from the latest source snapshot on every sync. Past release history is preserved; future manual records remain unless a higher-authority official source matches the same product.

## Source authority

Release conflicts are resolved by source authority instead of fetch order:

1. Official publisher calendars (`100`) - Topps, Magic, and Disney Lorcana
2. Hobby Monitor and Waxstat (`70`)
3. Beckett (`50`)

The sync also uses expanded Waxstat calendars for Pokemon, Magic, Yu-Gi-Oh!, Disney Lorcana, and other configured TCGs. Publishers without a stable structured release calendar remain covered by Hobby Monitor and Waxstat.

Every generated iCal event places the preferred direct product or drop page in the standard `URL` field and repeats it as `Drop link` in the description. Secondary references are retained in the event description when multiple sources corroborate a release.
