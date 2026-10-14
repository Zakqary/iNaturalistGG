import { browser } from 'wxt/browser';
import { apiGet, type Page } from './api';
import { db, userObservations } from './db';
import { compareObs } from './lifers';
import { getPlaces, shortPlaceName } from './stats';
import type { Obs, Pioneer, PioneerLevel, PioneerStatus } from './types';

/** Smallest place first: if you're not first in the district you can't be first in the territory. */
export const PIONEER_LEVELS: { level: PioneerLevel; adminLevel: number }[] = [
  { level: 'district', adminLevel: 20 },
  { level: 'territory', adminLevel: 10 },
  { level: 'country', adminLevel: 0 },
];
/** Keeps a single run (and a day of runs) well inside iNat's request budget. */
export const PIONEER_MAX_CHECKS_PER_RUN = 1000;
/** Someone may upload an older record, so titles are re-confirmed this often. */
export const PIONEER_RECHECK_MS = 30 * 24 * 3600 * 1000;

export interface SpeciesFirst {
  speciesId: number;
  obs: Obs;
}

/**
 * Your earliest dated, non-casual observation of each species. Casual records
 * (captive, no media…) don't count as pioneering, on your side or anyone else's.
 */
export function firstVerifiableBySpecies(
  observations: Obs[],
  rankLevelOf: (id: number) => number | undefined,
): SpeciesFirst[] {
  const firsts = new Map<number, Obs>();
  for (const o of [...observations].sort(compareObs)) {
    if (o.qualityGrade === 'casual' || !o.observedOn) continue;
    const speciesId = o.ancestorIds.find((id) => rankLevelOf(id) === 10);
    if (speciesId !== undefined && !firsts.has(speciesId)) firsts.set(speciesId, o);
  }
  return [...firsts.entries()].map(([speciesId, obs]) => ({ speciesId, obs }));
}

/** The day before an ISO date, since the API's d2 filter is inclusive. */
export function dayBefore(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Whether a pioneer record needs (re)checking: new, a different first observation, or a stale title. */
export function needsCheck(existing: Pioneer | undefined, obsId: number, now = Date.now()): boolean {
  if (!existing || existing.obsId !== obsId) return true;
  return existing.level !== null && now - Date.parse(existing.checkedAt) > PIONEER_RECHECK_MS;
}

const pioneerKey = (userId: number, speciesId: number) => `${userId}:${speciesId}`;

async function earlierRecordExists(speciesId: number, placeId: number, observedOn: string): Promise<boolean> {
  const res = await apiGet<Page<never>>('/v1/observations', {
    taxon_id: speciesId,
    place_id: placeId,
    verifiable: true,
    d2: dayBefore(observedOn),
    per_page: 0,
  });
  return res.total_results > 0;
}

/** The largest place (district → territory → country) where this was the first record. */
async function checkSpecies(first: SpeciesFirst): Promise<{ level: PioneerLevel | null; placeId: number | null; placeName: string | null }> {
  const places = await getPlaces(first.obs.placeIds);
  let best: { level: PioneerLevel; placeId: number; placeName: string } | null = null;
  for (const { level, adminLevel } of PIONEER_LEVELS) {
    const place = [...places.values()].find((p) => p.adminLevel === adminLevel);
    if (!place) continue; // e.g. no districts in this country: try the next level up
    if (await earlierRecordExists(first.speciesId, place.id, first.obs.observedOn!)) break;
    best = { level, placeId: place.id, placeName: shortPlaceName(place) };
  }
  return best ?? { level: null, placeId: null, placeName: null };
}

async function setStatus(status: PioneerStatus): Promise<void> {
  await browser.storage.local.set({ pioneerStatus: status });
}

let running: Promise<void> | null = null;

export function checkPioneers(userId: number): Promise<void> {
  running ??= runPioneerCheck(userId).finally(() => (running = null));
  return running;
}

async function runPioneerCheck(userId: number): Promise<void> {
  const d = await db();
  const [observations, taxa, existing] = await Promise.all([
    userObservations(userId),
    d.getAll('taxa'),
    d.getAllFromIndex('pioneers', 'byUser', userId),
  ]);
  const rankLevels = new Map(taxa.map((t) => [t.id, t.rankLevel]));
  const byKey = new Map(existing.map((p) => [p.key, p]));
  const firsts = firstVerifiableBySpecies(observations, (id) => rankLevels.get(id));

  // Drop records for species you no longer have (e.g. after an ID change).
  const live = new Set(firsts.map((f) => pioneerKey(userId, f.speciesId)));
  for (const p of existing) if (!live.has(p.key)) await d.delete('pioneers', p.key);

  // Newest first, so fresh uploads get checked right away.
  const queue = firsts
    .filter((f) => needsCheck(byKey.get(pioneerKey(userId, f.speciesId)), f.obs.id))
    .sort((a, b) => compareObs(b.obs, a.obs));
  const batch = queue.slice(0, PIONEER_MAX_CHECKS_PER_RUN);
  const status: PioneerStatus = {
    running: true,
    checked: 0,
    total: batch.length,
    remaining: queue.length,
    species: firsts.length,
  };

  try {
    for (const first of batch) {
      await setStatus(status);
      const result = await checkSpecies(first);
      await d.put('pioneers', {
        key: pioneerKey(userId, first.speciesId),
        userId,
        speciesId: first.speciesId,
        obsId: first.obs.id,
        observedOn: first.obs.observedOn!,
        ...result,
        checkedAt: new Date().toISOString(),
      });
      status.checked++;
      status.remaining--;
    }
    await setStatus({ ...status, running: false, completedAt: new Date().toISOString() });
  } catch (err) {
    console.error('[iNaturalistGG] pioneer check failed', err);
    await setStatus({ ...status, running: false, error: String(err) });
    throw err;
  }
}

export async function userPioneers(userId: number): Promise<Pioneer[]> {
  return (await (await db()).getAllFromIndex('pioneers', 'byUser', userId)).filter((p) => p.level !== null);
}
