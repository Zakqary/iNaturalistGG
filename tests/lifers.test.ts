import { describe, expect, it } from 'vitest';
import { compareObs, computeLifers, LIFE_TAXON_ID } from '../src/lib/lifers';
import type { Obs } from '../src/lib/types';

// A tiny taxonomy: Life > Animalia(70) > Aves(50) > Passeriformes(40) > Turdidae(30)
//   > Turdus(20) > T. migratorius(10) > T. m. migratorius(5)
//                > T. merula(10)
const RANKS: Record<number, number> = {
  [LIFE_TAXON_ID]: 100,
  1: 70,
  3: 50,
  7251: 40,
  12704: 30,
  12705: 20,
  12727: 10,
  999001: 5,
  12716: 10,
};
const rankLevelOf = (id: number) => RANKS[id];

const ROBIN = [LIFE_TAXON_ID, 1, 3, 7251, 12704, 12705, 12727];
const ROBIN_SSP = [...ROBIN, 999001];
const BLACKBIRD = [LIFE_TAXON_ID, 1, 3, 7251, 12704, 12705, 12716];
const TURDUS = [LIFE_TAXON_ID, 1, 3, 7251, 12704, 12705];

let nextId = 1;
function obs(observedOn: string | null, lineage: number[] | null, extra: Partial<Obs> = {}): Obs {
  const taxonId = lineage ? lineage[lineage.length - 1] : null;
  return {
    id: nextId++,
    userId: 42,
    observedOn,
    timeObservedAt: null,
    qualityGrade: 'casual',
    taxonId,
    taxonRankLevel: taxonId === null ? null : RANKS[taxonId],
    ancestorIds: lineage ?? [],
    placeIds: [],
    ...extra,
  };
}

describe('computeLifers', () => {
  it('credits every new group to the first observation, by date not upload order', () => {
    const later = obs('2024-05-01', BLACKBIRD);
    const earlier = obs('2023-01-01', ROBIN);
    const [first, second] = computeLifers([later, earlier], rankLevelOf);

    expect(first.obsId).toBe(earlier.id);
    expect(first.taxonIds).toEqual([1, 3, 7251, 12704, 12705, 12727]);
    expect(first.topRankLevel).toBe(70);
    expect(second.obsId).toBe(later.id);
    expect(second.taxonIds).toEqual([12716]);
    expect(second.topRankLevel).toBe(10);
  });

  it('never counts Life or subspecies, but a subspecies observation still counts for its species', () => {
    const [rec] = computeLifers([obs('2023-01-01', ROBIN_SSP)], rankLevelOf);
    expect(rec.taxonIds).not.toContain(LIFE_TAXON_ID);
    expect(rec.taxonIds).not.toContain(999001);
    expect(rec.taxonIds).toContain(12727);
  });

  it('lets a genus-level observation be a genus lifer, leaving the species open', () => {
    const genusOnly = obs('2023-01-01', TURDUS);
    const species = obs('2023-02-01', ROBIN);
    const [a, b] = computeLifers([genusOnly, species], rankLevelOf);
    expect(a.taxonIds.at(-1)).toBe(12705);
    expect(b.obsId).toBe(species.id);
    expect(b.taxonIds).toEqual([12727]);
  });

  it('skips observations with no taxon and repeat sightings', () => {
    const records = computeLifers(
      [obs('2023-01-01', null), obs('2023-01-02', ROBIN), obs('2023-01-03', ROBIN)],
      rankLevelOf,
    );
    expect(records).toHaveLength(1);
  });

  it('falls back to the observation taxon rank when the taxonomy lacks it', () => {
    const unknownSsp = obs('2023-01-01', [...ROBIN, 555], { taxonRankLevel: 5 });
    const [rec] = computeLifers([unknownSsp], (id) => (id === 555 ? undefined : RANKS[id]));
    expect(rec.taxonIds).not.toContain(555);
  });
});

describe('compareObs', () => {
  it('orders by date, then time, then id, with undated last', () => {
    const undated = obs(null, ROBIN);
    const evening = obs('2023-01-01', ROBIN, { timeObservedAt: '2023-01-01T18:00:00-05:00' });
    const morning = obs('2023-01-01', ROBIN, { timeObservedAt: '2023-01-01T07:00:00-05:00' });
    const prevDay = obs('2022-12-31', ROBIN);
    const sorted = [undated, evening, morning, prevDay].sort(compareObs);
    expect(sorted.map((o) => o.id)).toEqual([prevDay.id, morning.id, evening.id, undated.id]);
  });
});
