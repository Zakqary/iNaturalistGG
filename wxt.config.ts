import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  imports: false,
  manifest: {
    name: 'iNaturalistGG',
    description: 'Gamify iNaturalist: lifers, leaderboard ranks, badges and more.',
    permissions: ['storage', 'alarms', 'unlimitedStorage'],
    // Avatars are fetched so the share card can be exported as a PNG.
    host_permissions: [
      'https://api.inaturalist.org/*',
      'https://static.inaturalist.org/*',
      'https://inaturalist-open-data.s3.amazonaws.com/*',
    ],
  },
});
