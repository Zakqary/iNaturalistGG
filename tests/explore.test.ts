import { describe, expect, it } from 'vitest';
import { buildTree, seasonMonths } from '../src/lib/explore';
import { LIFE_TAXON_ID } from '../src/lib/lifers';
import type { Taxon } from '../src/lib/types';

const t = (id: number, rankLevel: number, rank: string): Taxon => ({ id, name: `T${id}`, rank, rankLevel, parentId: null });
const TAXA = new Map(
  [
    t(LIFE_TAXON_ID, 100, 'stateofmatter'),
    t(1, 70, 'kingdom'),
    t(2, 60, 'phylum'),
    t(3, 50, 'class'),
    t(4, 40, 'order'),
    t(45, 35, 'suborder'),
    t(5, 30, 'family'),
    t(6, 20, 'genus'),
    t(7, 10, 'species'),
    t(8, 10, 'species'),
    t(9, 5, 'subspecies'),
  ].map((x) => [x.id, x]),
);
const LINEAGE = [LIFE_TAXON_ID, 1, 2, 3, 4, 45, 5, 6];
const CA = 14;

describe('buildTree', () => {
  it('links major ranks only and counts distinct verifiable species in the place', () => {
    const nodes = buildTree(
      [
        { placeIds: [1, CA], qualityGrade: 'research', ancestorIds: [...LINEAGE, 7] },
        { placeIds: [1, CA], qualityGrade: 'needs_id', ancestorIds: [...LINEAGE, 7, 9] }, // same species via subspecies
        { placeIds: [1, CA], qualityGrade: 'casual', ancestorIds: [...LINEAGE, 8] }, // casual: not counted
        { placeIds: [1, 99], qualityGrade: 'research', ancestorIds: [...LINEAGE, 8] }, // elsewhere: not counted
      ],
      TAXA,
      CA,
    );
    const byId = new Map(nodes.map((n) => [n.id, n]));
    expect([...byId.keys()].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    expect(byId.get(5)!.parentId).toBe(4); // suborder skipped
    expect(byId.get(1)!.parentId).toBeNull();
    expect(byId.get(4)!.userSpecies).toBe(1);
  });
});

describe('seasonMonths', () => {
  it('wraps around the year', () => {
    expect(seasonMonths(new Date(2026, 0, 15))).toEqual([12, 1, 2]);
    expect(seasonMonths(new Date(2026, 9, 14))).toEqual([9, 10, 11]);
  });
});
