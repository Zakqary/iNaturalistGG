import { apiGet, type Page } from './api';
import { db, userObservations } from './db';
import { ensureCommonNames } from './taxa';
import type { Taxon } from './types';

/** Ranks shown in the life-list tree: kingdom, phylum, class, order, family. */
export const TREE_RANK_LEVELS = new Set([70, 60, 50, 40, 30]);
export const COMPLETION_MAX_AGE_MS = 30 * 24 * 3600 * 1000;
export const NEEDS_PER_PAGE = 50;

// ---------- Needs ----------

export interface NeedsItem {
  taxonId: number;
  name: string;
  commonName?: string;
  rank: string;
  /** Verifiable observations of this species in the place. */
  count: number;
  photoUrl?: string;
}

interface RawSpeciesCount {
  count: number;
  taxon: {
    id: number;
    name: string;
    rank: string;
    preferred_common_name?: string;
    default_photo?: { square_url?: string } | null;
  };
}

/** Months around now (e.g. Sep–Nov in October), for "in season" filtering. */
export function seasonMonths(now = new Date()): number[] {
  const m = now.getMonth(); // 0-based
  return [m - 1, m, m + 1].map((x) => ((x + 12) % 12) + 1);
}

/** Species recorded in a place that the user has never observed, most-recorded first. */
export async function fetchNeeds(opts: {
  userId: number;
  placeId: number;
  taxonId?: number;
  months?: number[];
  page: number;
}): Promise<{ total: number; items: NeedsItem[] }> {
  const res = await apiGet<Page<RawSpeciesCount>>('/v1/observations/species_counts', {
    place_id: opts.placeId,
    unobserved_by_user_id: opts.userId,
    taxon_id: opts.taxonId,
    month: opts.months?.length ? opts.months.join(',') : undefined,
    verifiable: true,
    captive: false,
    hrank: 'species',
    per_page: NEEDS_PER_PAGE,
    page: opts.page,
  });
  return {
    total: res.total_results,
    items: res.results.map((r) => ({
      taxonId: r.taxon.id,
      name: r.taxon.name,
      commonName: r.taxon.preferred_common_name,
      rank: r.taxon.rank,
      count: r.count,
      photoUrl: r.taxon.default_photo?.square_url,
    })),
  };
}

// ---------- Life list / completion ----------

export interface TreeNode {
  id: number;
  name: string;
  commonName?: string;
  rank: string;
  rankLevel: number;
  parentId: number | null;
  /** Species you've observed (verifiable observations) inside this group in the selected place. */
  userSpecies: number;
}

/**
 * Builds the kingdom→family tree of everything you've observed, counting the
 * species you've seen of each group inside `placeId`.
 */
export function buildTree(
  observations: { placeIds: number[]; qualityGrade: string; ancestorIds: number[] }[],
  taxa: Map<number, Taxon>,
  placeId: number,
): TreeNode[] {
  const nodes = new Map<number, TreeNode>();
  const speciesSets = new Map<number, Set<number>>();

  for (const o of observations) {
    const lineage = o.ancestorIds.map((id) => taxa.get(id)).filter((t): t is Taxon => !!t);
    const major = lineage.filter((t) => TREE_RANK_LEVELS.has(t.rankLevel));
    let parentId: number | null = null;
    for (const t of major) {
      if (!nodes.has(t.id)) {
        nodes.set(t.id, {
          id: t.id,
          name: t.name,
          commonName: t.commonName || undefined,
          rank: t.rank,
          rankLevel: t.rankLevel,
          parentId,
          userSpecies: 0,
        });
      }
      parentId = t.id;
    }

    const species = lineage.find((t) => t.rankLevel === 10);
    if (!species || o.qualityGrade === 'casual' || !o.placeIds.includes(placeId)) continue;
    for (const t of major) {
      const set = speciesSets.get(t.id) ?? new Set<number>();
      set.add(species.id);
      speciesSets.set(t.id, set);
    }
  }
  for (const [id, set] of speciesSets) nodes.get(id)!.userSpecies = set.size;
  return [...nodes.values()];
}

export async function lifeTree(userId: number, placeId: number): Promise<TreeNode[]> {
  const d = await db();
  const [observations, taxa] = await Promise.all([userObservations(userId), d.getAll('taxa')]);
  return buildTree(observations, new Map(taxa.map((t) => [t.id, t])), placeId);
}

export interface CompletionInfo {
  /** Species with verifiable records in the place. */
  total: number;
  commonName?: string;
}

/** Total species recorded per group in a place (cached), plus common names for display. */
export async function completion(placeId: number, taxonIds: number[]): Promise<Record<number, CompletionInfo>> {
  const d = await db();
  const out: Record<number, CompletionInfo> = {};

  const taxa = (await Promise.all(taxonIds.map((id) => d.get('taxa', id)))).filter((t): t is Taxon => !!t);
  await ensureCommonNames(taxa).catch(() => undefined);
  const names = new Map(taxa.map((t) => [t.id, t.commonName || undefined]));

  for (const taxonId of taxonIds) {
    const key = `${placeId}:${taxonId}`;
    let cached = await d.get('completion', key);
    if (!cached || Date.now() - Date.parse(cached.fetchedAt) > COMPLETION_MAX_AGE_MS) {
      const res = await apiGet<Page<never>>('/v1/observations/species_counts', {
        place_id: placeId,
        taxon_id: taxonId,
        verifiable: true,
        hrank: 'species',
        per_page: 0,
      });
      cached = { key, total: res.total_results, fetchedAt: new Date().toISOString() };
      await d.put('completion', cached);
    }
    out[taxonId] = { total: cached.total, commonName: names.get(taxonId) };
  }
  return out;
}
