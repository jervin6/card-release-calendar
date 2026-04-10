# Card Release Calendar

Generate a small iCal feed that only includes trading card releases or pre-orders you subscribe to.

## What it does

- Reads release entries from `data/releases.json`
- Filters them using `config/subscriptions.json`
- Generates `docs/cards.ics` for calendar subscriptions
- Generates `docs/index.html` as a simple landing page for GitHub Pages

## Quick start

```bash
npm run build
```

The feed will be written to `docs/cards.ics`.

## Subscribe in Apple Calendar

1. Host the `docs/` directory with GitHub Pages.
2. Copy the published `cards.ics` URL.
3. In Calendar, choose File > New Calendar Subscription.
4. Paste the URL and save.

## Customize subscriptions

Edit `config/subscriptions.json`.

```json
{
  "keywords": ["Bowman"]
}
```

Only releases whose titles contain one of those keywords will be included.

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

## Next steps

The current version uses a manually curated release list so the feed is stable and easy to validate. A later iteration can scrape or ingest releases automatically from approved sources.
