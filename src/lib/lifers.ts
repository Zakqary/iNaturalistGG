import type { LiferRecord, Obs } from './types';

/** iNat's root "Life" taxon. Everything is a descendant, so it is never a lifer. */
export const LIFE_TAXON_ID = 48460;
/** Species. Anything below (subspecies, variety, form) never counts as its own lifer. */
export const MIN_LIFER_RANK_LEVEL = 10;

/**
 * Chronological order for deciding which observation came first:
 * observed date, then exact time when both have one, then observation id.
 * Undated observations sort after all dated ones.
 */
export function compareObs(a: Obs, b: Obs): number {
  if (a.observedOn !== b.observedOn) {
    if (a.observedOn === null) return 1;
    if (b.observedOn === null) return -1;
    return a.observedOn < b.observedOn ? -1 : 1;
  }
  if (a.timeObservedAt && b.timeObservedAt) {
    const diff = Date.parse(a.timeObservedAt) - Date.parse(b.timeObservedAt);
    if (diff !== 0) return diff;
  }
  return a.id - b.id;
}

/**
 * Finds every observation that was the user's first of some group at species
 * rank or above. `rankLevelOf` comes from the user's observed taxonomy; a taxon
 * it doesn't know is assumed to be species-or-higher unless it is the
 * observation's own (infraspecific) taxon.
 */
export function computeLifers(
  observations: Obs[],
  rankLevelOf: (taxonId: number) => number | undefined,
): LiferRecord[] {
  const sorted = [...observations].sort(compareObs);
  const seen = new Set<number>();
  const records: LiferRecord[] = [];

  for (const obs of sorted) {
    if (obs.taxonId === null) continue;
    const lineage = obs.ancestorIds.length ? obs.ancestorIds : [obs.taxonId];
    const newTaxa: number[] = [];
    let topRankLevel = 0;

    for (const taxonId of lineage) {
      if (taxonId === LIFE_TAXON_ID || seen.has(taxonId)) continue;
      const rankLevel =
        rankLevelOf(taxonId) ?? (taxonId === obs.taxonId ? obs.taxonRankLevel ?? undefined : undefined);
      if (rankLevel !== undefined && rankLevel < MIN_LIFER_RANK_LEVEL) continue;
      seen.add(taxonId);
      newTaxa.push(taxonId);
      topRankLevel = Math.max(topRankLevel, rankLevel ?? MIN_LIFER_RANK_LEVEL);
    }

    if (newTaxa.length) {
      records.push({ obsId: obs.id, userId: obs.userId, taxonIds: newTaxa, topRankLevel });
    }
  }
  return records;
}
