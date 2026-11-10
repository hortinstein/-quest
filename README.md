# ♾️quest

Tracks WoW Forever characters and compares them on a static site. Every 6 hours a GitHub Action reads each character in `watched.txt` from the official armory, records any change in `site/data/characters.json`, and redeploys the site.

## Setup

In the repo's Settings > Pages, set Source to **GitHub Actions**. No API keys are needed.

## Adding characters

Add a line to `watched.txt`:

```
Person Name, Firstname Lastname
```

The optional third column sets the region (`us`, `eu`, `kr`, `tw`), and the default is `us`.

## Local use

```
npm test
npm run collect
npm run preview
```

## Limits

Blizzard has no documented Forever API, so the collector reads the JSON embedded in the armory page. If Blizzard changes that page, the Action fails and the site lists the affected characters under "Needs attention". Tracked history is kept.
