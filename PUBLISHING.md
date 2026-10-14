# Publishing iNaturalistGG

## 1. Before every release

1. Bump `"version"` in `package.json`. Both stores reject an upload with a version they've already seen.
2. Run the checks:
   ```sh
   npm test
   npm run compile
   ```
3. Build the packages:
   ```sh
   npm run zip            # .output/inaturalistgg-<version>-chrome.zip
   npm run zip:firefox    # .output/inaturalistgg-<version>-firefox.zip
                          # + .output/inaturalistgg-<version>-sources.zip
   ```
4. Load each build unpacked (see "Testing locally" below) and click through the extension once.

You also need a public URL for `PRIVACY.md`. The simplest option is to push this repository to GitHub and link to the file there.

## 2. Chrome Web Store

1. Register at the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole). Google charges a one-time $5 registration fee.
2. Click **New item** and upload `inaturalistgg-<version>-chrome.zip`.
3. **Store listing** tab:
   - **Description:** what it does (lifers, ranks, badges, needs, life list, pioneers).
   - **Category:** Fun, or Education.
   - **Icon:** `public/icon/128.png`.
   - **Screenshots:** at least one, 1280×800 or 640×400. The stats page, a page with LIFER/PIONEER chips, and the share card all make good ones.
4. **Privacy** tab:
   - **Single purpose:** "Adds lifers, leaderboard ranks, badges and related stats to iNaturalist using the user's public iNaturalist data."
   - **Permission justifications:**
     - `storage` / `unlimitedStorage`: "Caches the user's observations and computed stats locally; large iNaturalist accounts exceed the default quota."
     - `alarms`: "Schedules the periodic background sync and badge/pioneer checks."
     - Host permissions: "`api.inaturalist.org` provides the user's public data; the two image hosts let the share card embed the user's avatar in its PNG export."
     - Content script on inaturalist.org: "Shows LIFER and PIONEER chips on the user's observations."
   - **Remote code:** No.
   - **Data usage:** tick **Personally identifiable information** (the iNaturalist username is sent to iNaturalist's API). Then certify that data isn't sold, isn't used for unrelated purposes, and isn't used for credit decisions.
   - **Privacy policy URL:** the public link to `PRIVACY.md`.
5. Submit for review. Reviews usually take a few days.

## 3. Firefox Add-ons (addons.mozilla.org)

1. Create a free account at [addons.mozilla.org](https://addons.mozilla.org/developers/).
2. **Submit a New Add-on**, then choose where it will be distributed:
   - **On this site:** a public listing on AMO.
   - **On your own:** Mozilla signs the add-on and you distribute the file yourself. This is handy for testing with friends first.
3. Upload `inaturalistgg-<version>-firefox.zip`.
4. AMO asks whether the code is minified or bundled. Answer **yes**, upload `inaturalistgg-<version>-sources.zip`, and paste these reviewer notes:
   > Built with WXT (Vite). To reproduce: Node 20+, `npm ci`, `npm run zip:firefox`; output is in `.output/`.
   > The one `innerHTML` lint warning comes from the bundled `html-to-image` library (it copies `<textarea>` values while cloning a node for the PNG export); the extension's own code never sets innerHTML.
5. Add a listing description, screenshots and the privacy policy link, then submit. Automated signing is quick; a human review can follow.

**The add-on ID can never change.** It's `inaturalistgg@inaturalistgg.addon`, set in `wxt.config.ts`. AMO ties every future update to that ID, so don't edit it after the first upload.

## 4. Testing locally

- **Chrome:** go to `chrome://extensions`, turn on Developer mode, click **Load unpacked** and select `.output/chrome-mv3` (from `npm run build`).
- **Firefox:** go to `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on…** and select `.output/firefox-mv2/manifest.json` (from `npm run build:firefox`). It stays loaded until Firefox restarts.
- **Auto-reload while developing:** `npm run dev` opens Chrome, and `npm run dev:firefox` opens Firefox, with the extension loaded and reloading as you edit.

## 5. Updates

Bump the version, rebuild the zips, and upload them as a new version in each dashboard. Installed copies update automatically once the store approves the new version.
