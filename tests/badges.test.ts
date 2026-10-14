import { describe, expect, it } from 'vitest';
import { badgeCandidates, topRank } from '../src/lib/badges';
import { LIFE_TAXON_ID } from '../src/lib/lifers';
import type { LeaderboardRow } from '../src/lib/stats';
import type { Obs } from '../src/lib/types';

// Life > Animalia(70) > Insecta(50) > Odonata(40) > Libellulidae(30) > Sympetrum(20) > S. striolatum(10) / S. sanguineum(10)
const RANKS: Record<number, number> = { [LIFE_TAXON_ID]: 100, 1: 70, 47158: 50, 47792: 40, 49: 30, 50: 20, 51: 10, 52: 10 };
const ODONATA = [LIFE_TAXON_ID, 1, 47158, 47792, 49, 50];

const obs = (ancestorIds: number[]) => ({ ancestorIds }) as Obs;
const row = (user_id: number, species_count: number, observation_count: number): LeaderboardRow => ({
  user_id,
  species_count,
  observation_count,
});

describe('badgeCandidates', () => {
  it('lists order-and-above groups with the user’s own counts, skipping Life and smaller ranks', () => {
    const candidates = badgeCandidates(
      [obs([...ODONATA, 51]), obs([...ODONATA, 51]), obs([...ODONATA, 52]), obs(ODONATA)],
      (id) => RANKS[id],
    );
    expect(candidates.map((c) => c.taxonId).sort()).toEqual([1, 47158, 47792]);
    expect(candidates.find((c) => c.taxonId === 47792)).toEqual({ taxonId: 47792, observations: 4, species: 2 });
  });
});

describe('topRank', () => {
  const top3 = [row(10, 900, 5000), row(11, 800, 4000), row(12, 700, 3000)];

  it('reads the rank when the user is listed', () => {
    expect(topRank(top3, 11, 'species', 800)).toBe(2);
  });

  it('awards a shared 3rd when the user ties 3rd place but isn’t listed', () => {
    expect(topRank(top3, 99, 'species', 700)).toBe(3);
    expect(topRank(top3, 99, 'observations', 3000)).toBe(3);
  });

  it('awards nothing below 3rd', () => {
    expect(topRank(top3, 99, 'species', 699)).toBeNull();
  });

  it('handles groups with fewer than 3 observers', () => {
    expect(topRank([row(10, 9, 9), row(99, 6, 6)], 99, 'species', 6)).toBe(2);
  });

  it('needs at least 5 species / observations, so tiny groups don’t award everyone', () => {
    // Ginkgoopsida: one species, so everyone who has seen a Ginkgo ties for #1 by species.
    const ginkgo = [row(10, 1, 40), row(11, 1, 30), row(99, 1, 2)];
    expect(topRank(ginkgo, 99, 'species', 1)).toBeNull();
    expect(topRank(ginkgo, 10, 'observations', 40)).toBe(1);
    expect(topRank([row(99, 4, 4)], 99, 'observations', 4)).toBeNull();
    expect(topRank([row(99, 5, 5)], 99, 'observations', 5)).toBe(1);
  });
});
