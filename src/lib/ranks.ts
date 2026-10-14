/** Loot-style tiers for the highest rank an observation was a lifer for. */
export interface Tier {
  minRankLevel: number;
  label: string;
  className: string;
}

export const TIERS: Tier[] = [
  { minRankLevel: 60, label: 'Phylum+', className: 'igg-tier-legendary' },
  { minRankLevel: 50, label: 'Class', className: 'igg-tier-epic-plus' },
  { minRankLevel: 40, label: 'Order', className: 'igg-tier-epic' },
  { minRankLevel: 30, label: 'Family', className: 'igg-tier-rare' },
  { minRankLevel: 20, label: 'Genus', className: 'igg-tier-uncommon' },
  { minRankLevel: 10, label: 'Species', className: 'igg-tier-common' },
];

export function tierFor(rankLevel: number): Tier {
  return TIERS.find((t) => rankLevel >= t.minRankLevel) ?? TIERS[TIERS.length - 1];
}

/** Ranks shown prominently in tooltips; minor ranks (tribe, section, etc.) are summarized. */
export const MAJOR_RANK_LEVELS = new Set([10, 20, 30, 40, 50, 60, 70]);

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
