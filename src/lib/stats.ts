import { apiGet, type Page } from './api';
import { db, putMany, userObservations } from './db';
import type { Obs, Place, ScopeKey, ScopeStats, StatsSnapshot, UserMeta } from './types';

/**
 * Admin levels of the places we rank you in, smallest first. "Territory" is
 * iNat's admin level 10: states in the US, provinces, regions etc. elsewhere.
 */
export const PLACE_SCOPES: { scope: ScopeKey; adminLevel: number; label: string }[] = [
  { scope: 'county', adminLevel: 20, label: 'County' },
  { scope: 'territory', adminLevel: 10, label: 'Territory' },
  { scope: 'country', adminLevel: 0, label: 'Country' },
  { scope: 'continent', adminLevel: -10, label: 'Continent' },
];
export const SCOPE_LABELS: Record<ScopeKey, string> = {
  ...(Object.fromEntries(PLACE_SCOPES.map((s) => [s.scope, s.label])) as Record<ScopeKey, string>),
  world: 'Worldwide',
};

/** iNat's observers leaderboard never returns more than this many people. */
export const LEADERBOARD_LIMIT = 500;
export const STATS_MAX_AGE_MS = 24 * 3600 * 1000;
/** Bump when StatsSnapshot's shape changes so cached snapshots get recomputed. */
export const STATS_VERSION = 2;
const PLACES_BATCH = 30;
const MAX_PLACE_BATCHES = 10;

interface RawPlace {
  id: number;
  name: string;
  display_name: string;
  admin_level: number | null;
  ancestor_place_ids: number[] | null;
}

export interface LeaderboardRow {
  user_id: number;
  observation_count: number;
  species_count: number;
  /** Profile totals iNat embeds in each row. */
  user?: { species_count?: number };
}

/**
 * The worldwide, all-taxa species leaderboard times out on iNat's side (504),
 * so we approximate it by re-ranking the worldwide top observers by the
 * species totals on their profiles.
 */
export function approximateSpeciesBoard(byObservations: LeaderboardRow[]): LeaderboardRow[] {
  return byObservations
    .map((r) => ({ ...r, species_count: r.user?.species_count ?? r.species_count }))
    .sort((a, b) => b.species_count - a.species_count);
}

/** Place ids ordered by how many of the user's observations fall inside them. */
export function placeIdsByFrequency(observations: Obs[]): number[] {
  const counts = new Map<number, number>();
  for (const o of observations) for (const id of o.placeIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

/**
 * Standard competition ranking ("1, 2, 2, 4"): one more than the number of
 * people with a strictly higher count. Null if the user isn't on the board.
 */
export function competitionRank(
  rows: LeaderboardRow[],
  userId: number,
  field: 'observation_count' | 'species_count',
): number | null {
  const mine = rows.find((r) => r.user_id === userId);
  if (!mine) return null;
  return 1 + rows.filter((r) => r[field] > mine[field]).length;
}

/** Places by id, from the local cache where possible (fetched in batches otherwise). */
async function getPlaces(ids: number[]): Promise<Map<number, Place>> {
  const d = await db();
  const out = new Map<number, Place>();
  const missing: number[] = [];
  for (const id of ids) {
    const cached = await d.get('places', id);
    // Places cached before ancestors were stored need refetching.
    if (cached?.ancestorPlaceIds) out.set(id, cached);
    else missing.push(id);
  }
  for (let i = 0; i < missing.length; i += PLACES_BATCH) {
    const res = await apiGet<Page<RawPlace>>(`/v1/places/${missing.slice(i, i + PLACES_BATCH).join(',')}`);
    const places = res.results.map(
      (p): Place => ({
        id: p.id,
        name: p.name,
        displayName: p.display_name,
        adminLevel: p.admin_level,
        ancestorPlaceIds: p.ancestor_place_ids ?? [],
      }),
    );
    await putMany('places', places);
    places.forEach((p) => out.set(p.id, p));
  }
  return out;
}

/**
 * The most-observed place at each admin level. Places are checked in order of
 * frequency, so the first one found at a level is the most-observed one.
 */
export async function findHomePlaces(userId: number): Promise<Partial<Record<ScopeKey, Place>>> {
  const ids = placeIdsByFrequency(await userObservations(userId));
  const wanted = new Map(PLACE_SCOPES.map((s) => [s.adminLevel, s.scope]));
  const homes: Partial<Record<ScopeKey, Place>> = {};

  for (let i = 0; i < ids.length && wanted.size && i < PLACES_BATCH * MAX_PLACE_BATCHES; i += PLACES_BATCH) {
    const chunk = ids.slice(i, i + PLACES_BATCH);
    const places = await getPlaces(chunk);
    for (const id of chunk) {
      const place = places.get(id);
      const scope = place?.adminLevel != null ? wanted.get(place.adminLevel) : undefined;
      if (place && scope) {
        homes[scope] = place;
        wanted.delete(place.adminLevel!);
      }
    }
  }
  return homes;
}

/** "Alameda County, US, CA" → "Alameda County": iNat's display name reads better than the bare name. */
export function shortPlaceName(place: Place): string {
  return place.displayName?.split(',')[0]?.trim() || place.name;
}

/** The territory (state/province) a place sits in, which may not be your top territory. */
async function territoryOf(place: Place): Promise<Place | undefined> {
  const ancestors = await getPlaces(place.ancestorPlaceIds?.filter((id) => id !== place.id) ?? []);
  return [...ancestors.values()].find((p) => p.adminLevel === 10);
}

async function leaderboard(placeId: number | null, orderBy: 'observation_count' | 'species_count') {
  const res = await apiGet<Page<LeaderboardRow>>('/v1/observations/observers', {
    place_id: placeId ?? undefined,
    order_by: orderBy,
    per_page: LEADERBOARD_LIMIT,
  });
  return res.results;
}

async function scopeStats(
  user: UserMeta,
  scope: ScopeKey,
  place: Place | null,
  parent?: Place,
): Promise<ScopeStats> {
  const placeId = place?.id ?? null;
  const byObs = await leaderboard(placeId, 'observation_count');
  const speciesRankApprox = placeId === null;
  const bySpecies = speciesRankApprox ? approximateSpeciesBoard(byObs) : await leaderboard(placeId, 'species_count');
  const row = [...byObs, ...bySpecies].find((r) => r.user_id === user.id);

  let observationCount = row?.observation_count;
  let speciesCount = speciesRankApprox ? user.speciesCount : row?.species_count;
  if (row === undefined && placeId === null) {
    observationCount = user.observationsCount;
    speciesCount = user.speciesCount;
  } else if (row === undefined) {
    const params = { user_id: user.id, place_id: placeId, per_page: 0 };
    observationCount = (await apiGet<Page<never>>('/v1/observations', params)).total_results;
    speciesCount = (await apiGet<Page<never>>('/v1/observations/species_counts', params)).total_results;
  }

  return {
    scope,
    placeId,
    placeName: place ? shortPlaceName(place) : 'Earth',
    parentName: parent?.name,
    observationCount: observationCount ?? 0,
    speciesCount: speciesCount ?? 0,
    observationRank: competitionRank(byObs, user.id, 'observation_count'),
    speciesRank: competitionRank(bySpecies, user.id, 'species_count'),
    speciesRankApprox,
  };
}

export async function computeStats(user: UserMeta): Promise<StatsSnapshot> {
  const homes = await findHomePlaces(user.id);
  const scopes: ScopeStats[] = [];
  for (const { scope } of PLACE_SCOPES) {
    const place = homes[scope];
    if (!place) continue;
    const parent = scope === 'county' ? await territoryOf(place) : undefined;
    scopes.push(await scopeStats(user, scope, place, parent));
  }
  scopes.push(await scopeStats(user, 'world', null));

  const snapshot: StatsSnapshot = { version: STATS_VERSION, userId: user.id, computedAt: new Date().toISOString(), scopes };
  await (await db()).put('stats', snapshot);
  return snapshot;
}
