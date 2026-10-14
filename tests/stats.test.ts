import { describe, expect, it } from 'vitest';
import { approximateSpeciesBoard, competitionRank, placeIdsByFrequency, type LeaderboardRow } from '../src/lib/stats';
import type { Obs } from '../src/lib/types';

const row = (user_id: number, species_count: number, observation_count = 0): LeaderboardRow => ({
  user_id,
  species_count,
  observation_count,
});

describe('competitionRank', () => {
  const board = [row(1, 900), row(2, 800), row(3, 800), row(4, 700)];

  it('ranks by strictly-higher counts so ties share a rank', () => {
    expect(competitionRank(board, 1, 'species_count')).toBe(1);
    expect(competitionRank(board, 2, 'species_count')).toBe(2);
    expect(competitionRank(board, 3, 'species_count')).toBe(2);
    expect(competitionRank(board, 4, 'species_count')).toBe(4);
  });

  it('returns null for someone not on the board', () => {
    expect(competitionRank(board, 99, 'species_count')).toBeNull();
  });
});

describe('placeIdsByFrequency', () => {
  it('orders places by how many observations fall in them', () => {
    const obs = (placeIds: number[]) => ({ placeIds }) as Obs;
    expect(placeIdsByFrequency([obs([1, 14, 845]), obs([1, 14]), obs([1, 97394])])).toEqual([1, 14, 845, 97394]);
  });
});

describe('approximateSpeciesBoard', () => {
  it('re-ranks observers by their profile species totals', () => {
    const board = approximateSpeciesBoard([
      { ...row(1, 50, 9000), user: { species_count: 1200 } },
      { ...row(2, 40, 8000), user: { species_count: 3000 } },
    ]);
    expect(competitionRank(board, 2, 'species_count')).toBe(1);
    expect(competitionRank(board, 1, 'species_count')).toBe(2);
  });
});
