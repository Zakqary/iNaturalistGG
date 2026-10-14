import { describe, expect, it } from 'vitest';
import { LIFE_TAXON_ID } from '../src/lib/lifers';
import { dayBefore, firstVerifiableBySpecies, needsCheck, PIONEER_RECHECK_MS } from '../src/lib/pioneers';
import type { Obs, Pioneer } from '../src/lib/types';

const RANKS: Record<number, number> = { [LIFE_TAXON_ID]: 100, 1: 70, 20: 20, 21: 10, 22: 10, 23: 5 };
let nextId = 1;
const obs = (observedOn: string | null, lineage: number[], qualityGrade = 'research'): Obs => ({
  id: nextId++,
  userId: 1,
  observedOn,
  timeObservedAt: null,
  qualityGrade,
  taxonId: lineage.at(-1)!,
  taxonRankLevel: RANKS[lineage.at(-1)!],
  ancestorIds: lineage,
  placeIds: [],
});

describe('firstVerifiableBySpecies', () => {
  it('takes the earliest dated, non-casual observation per species (subspecies count)', () => {
    const casualEarly = obs('2020-01-01', [LIFE_TAXON_ID, 1, 20, 21], 'casual');
    const undated = obs(null, [LIFE_TAXON_ID, 1, 20, 21]);
    const sspLater = obs('2021-06-01', [LIFE_TAXON_ID, 1, 20, 21, 23], 'needs_id');
    const later = obs('2022-01-01', [LIFE_TAXON_ID, 1, 20, 21]);
    const genusOnly = obs('2019-01-01', [LIFE_TAXON_ID, 1, 20]);
    const other = obs('2023-01-01', [LIFE_TAXON_ID, 1, 20, 22]);

    const firsts = firstVerifiableBySpecies([later, other, casualEarly, undated, sspLater, genusOnly], (id) => RANKS[id]);
    expect(new Map(firsts.map((f) => [f.speciesId, f.obs.id]))).toEqual(
      new Map([
        [21, sspLater.id],
        [22, other.id],
      ]),
    );
  });
});

describe('dayBefore', () => {
  it('handles month and year boundaries', () => {
    expect(dayBefore('2024-03-01')).toBe('2024-02-29');
    expect(dayBefore('2025-01-01')).toBe('2024-12-31');
  });
});

describe('needsCheck', () => {
  const base: Pioneer = {
    key: '1:21', userId: 1, speciesId: 21, obsId: 5, observedOn: '2020-01-01',
    level: 'district', placeId: 845, placeName: 'Alameda County', checkedAt: new Date(0).toISOString(),
  };
  const now = PIONEER_RECHECK_MS + 1000;

  it('checks new species and changed first observations', () => {
    expect(needsCheck(undefined, 5, now)).toBe(true);
    expect(needsCheck(base, 6, now)).toBe(true);
  });
  it('re-confirms stale pioneer titles but never re-checks non-pioneers', () => {
    expect(needsCheck(base, 5, now)).toBe(true);
    expect(needsCheck({ ...base, checkedAt: new Date(now - 1000).toISOString() }, 5, now)).toBe(false);
    expect(needsCheck({ ...base, level: null, placeId: null, placeName: null }, 5, now)).toBe(false);
  });
});
