# iNaturalistGG

A Chrome extension that gamifies [iNaturalist](https://www.inaturalist.org).

**Current (MVP):** "LIFER" chips on your observations, marking the first time you observed any group at species rank or above. Chips are colour-coded by the highest new rank:

Species · Genus · Family · Order · Class · Phylum+

Hover a chip to see every group it unlocked. Observation pages also get a banner.

**Stats page:** open it from the popup. It shows:
- Your rank by species and by observations in your most-observed county, state, country and continent, and worldwide
- Lifers broken down by tier
- A 1200×630 share card you can download or copy as a PNG

Two limits come from iNaturalist:
- Leaderboards stop at 500, so ranks beyond that show as "500+".
- The worldwide species leaderboard times out on iNat's side, so the worldwide species rank is estimated (≈) from the top 500 observers' profile species totals.

**Planned:**
- Worldwide top-3 badges for orders and above
- Needs list
- Completion bars
- First-for-place ("Pioneer") detection

## Development

```sh
npm install
npm run dev      # opens Chrome with the extension loaded and hot reload
npm run build    # production build in .output/chrome-mv3
npm test         # unit tests (lifer logic)
npm run compile  # type-check
```

To load a production build manually:
1. Go to `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select `.output/chrome-mv3`.

## How it works

- **`src/lib/sync.ts`** downloads your observations from `/v2/observations`. It requests only the fields it needs and pages with `id_above`. It then downloads your observed taxonomy from `/v1/observations/taxonomy` and recomputes lifers. Progress is saved after every page, so an interrupted sync resumes. Later syncs fetch only changes (`updated_since`), with a full resync weekly to catch deleted observations.
- **`src/lib/lifers.ts`** holds the lifer rules:
  - Observations are ordered by observed date, then time, then ID.
  - The root "Life" taxon and anything below species never count as a group of their own.
  - A subspecies observation still counts toward its species.
- **`src/lib/api.ts`** sends every API request through one queue, at most about 1 per second, with backoff on 429 responses.
- **`src/entrypoints/content/`** decorates iNaturalist pages. All site-specific selectors are in `selectors.ts`.
- Data is stored in IndexedDB, in the extension's own storage.
