# iNaturalistGG

A Chrome and Firefox extension that gamifies [iNaturalist](https://www.inaturalist.org).

**Current (MVP):** "LIFER" chips on your observations, marking the first time you observed any group at species rank or above. Chips are colour-coded by the highest new rank:

Species · Genus · Family · Order · Class · Phylum+

Hover a chip to see every group it unlocked. Observation pages also get a banner.

**Stats page:** open it from the popup. It shows:
- Your rank by species and by observations in your most-observed district (county, municipality…), territory (state, province…), country and continent, and worldwide
- Lifers broken down by tier
- A 1200×630 share card you can download or copy as a PNG

Two limits come from iNaturalist:
- Leaderboards stop at 500, so ranks beyond that show as "Unranked".
- The worldwide species leaderboard times out on iNat's side, so the worldwide species rank is estimated (≈) from the top 500 observers' profile species totals.

**Badges:** you earn one for being in the worldwide, all-time top 3, by species or by observations, for any group ranked order or higher.
- Checked automatically once a week after a sync, or on demand. Each check fetches just the top 3 for every such group you've observed.
- Badges you lose stay in your history as former badges.
- They appear on the stats page, the share card and in the popup.

**Needs tab:** species recorded in one of your home places that you've never observed.
- Most-recorded species come first.
- Filters for group and for "in season now".

**Life list tab:** your observed taxonomy from kingdom down to family.
- Each group has a completion bar: species you've seen there out of species recorded in the place.
- Totals load as you expand a group and are cached for 30 days.

**Pioneers:** observations that were the first iNaturalist record of a species in their district, territory or country.
- **Which observation:** your earliest non-casual observation of each species.
- **How:** checked district first, then territory, then country, stopping at the first place where an earlier record exists.
- **Batches:** about 1,000 species after each sync, newest first. Titles are re-confirmed monthly.
- **Where they show:** pioneer observations get a teal PIONEER chip on iNat pages, plus a list and counts on the stats page.

## Development

```sh
npm install
npm run dev            # Chrome with the extension loaded and hot reload
npm run dev:firefox    # same, in Firefox
npm run build          # production build in .output/chrome-mv3
npm run build:firefox  # production build in .output/firefox-mv2
npm run zip            # store packages (zip:firefox also makes the sources zip AMO asks for)
npm test               # unit tests
npm run compile        # type-check
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

See [PUBLISHING.md](PUBLISHING.md) for releasing to the Chrome Web Store and Firefox Add-ons, and [PRIVACY.md](PRIVACY.md) for the privacy policy.
