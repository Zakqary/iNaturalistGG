import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  imports: false,
  manifest: {
    name: 'iNaturalistGG',
    description: 'Gamify iNaturalist: lifers, leaderboard ranks, badges and more.',
    permissions: ['storage', 'alarms', 'unlimitedStorage'],
    host_permissions: ['https://api.inaturalist.org/*'],
  },
});
