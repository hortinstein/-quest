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
npm ci
npx playwright install --with-deps chromium
npm test
npm run collect
npm run preview
```

## Gear progression screenshots

The collector uses Playwright/Chromium to capture each watched character on its first successful run, including characters already tracked before screenshots were added. After that, it captures whenever the current level differs from the last successful screenshot. Gear or profession changes at the same level do not trigger another image.

Images live in `site/screenshots/CHARNAME_REGION/YYYYMMDD_CHARNAME_LEVEL#.png` (UTC date, armory name slug with accents preserved). The region keeps identically named characters separate. A timestamp suffix preserves both images if a character revisits the same level on the same day. The crop includes the character name, portrait and all equipment, ending below the bottom items; site navigation, stats and professions are excluded.

Open **Gear history** beside a character in the comparison table to browse captures by level and date, or open an original image. Captures and their index in `characters.json` are committed and deployed together by the scheduled Action. Failed screenshots appear under **Needs attention**, preserve character data and previous images, and retry at the current level next run. Levels passed between six-hour checks cannot be reconstructed.

## Limits

Blizzard has no documented Forever API, so the collector reads the JSON embedded in the armory page. If Blizzard changes that page, the Action fails and the site lists the affected characters under "Needs attention". Tracked history is kept.
