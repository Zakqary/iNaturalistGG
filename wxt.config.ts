import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  imports: false,
  manifest: ({ browser }) => ({
    name: 'iNaturalistGG',
    description: 'Gamify iNaturalist: lifers, leaderboard ranks, badges and more.',
    homepage_url: 'https://www.inaturalist.org',
    permissions: ['storage', 'alarms', 'unlimitedStorage'],
    // The API for data; the image hosts so the share card can embed your avatar in its PNG.
    host_permissions: [
      'https://api.inaturalist.org/*',
      'https://static.inaturalist.org/*',
      'https://inaturalist-open-data.s3.amazonaws.com/*',
    ],
    ...(browser === 'firefox' && {
      browser_specific_settings: {
        gecko: {
          // Permanent once published on addons.mozilla.org; never change it after the first upload.
          id: 'inaturalistgg@inaturalistgg.addon',
          // 140 (the current ESR) is the first version that understands data_collection_permissions.
          strict_min_version: '140.0',
          // Data only goes to iNaturalist's own API, to fetch the user's public data; nothing is collected by us.
          data_collection_permissions: { required: ['none'] },
        },
        gecko_android: { strict_min_version: '142.0' },
      },
    }),
  }),
});
