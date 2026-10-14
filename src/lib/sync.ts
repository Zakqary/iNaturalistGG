import { browser } from 'wxt/browser';
import { apiGet, type Page } from './api';
import { db, pruneObservations, putMany, replaceLifers, userObservations } from './db';
import { computeLifers } from './lifers';
import type { Obs, SyncStatus, Taxon, UserMeta } from './types';

const OBS_FIELDS =
  'id,observed_on,time_observed_at,quality_grade,place_ids,taxon.id,taxon.rank_level,taxon.ancestor_ids';
const PER_PAGE = 200;
const FULL_SYNC_EVERY_MS = 7 * 24 * 3600 * 1000;

interface RawObs {
  id: number;
  observed_on: string | null;
  time_observed_at: string | null;
  quality_grade: string;
  place_ids?: number[];
  taxon: { id: number; rank_level: number; ancestor_ids?: number[] } | null;
}

interface RawTaxonomyNode {
  id: number;
  name: string;
  rank: string;
  rank_level: number;
  parent_id: number | null;
}

interface RawUser {
  id: number;
  login: string;
  name: string | null;
  icon_url: string | null;
  observations_count: number;
  species_count: number;
}

/** Progress of an in-flight sync, persisted so a restarted service worker can resume. */
interface SyncJob {
  userId: number;
  full: boolean;
  cursor: number;
  startedAt: string;
  updatedSince: string | null;
  fetched: number;
  /** True if this job was picked up after a restart, so `keep` below is incomplete. */
  resumed: boolean;
}

export function toObs(raw: RawObs, userId: number): Obs {
  return {
    id: raw.id,
    userId,
    observedOn: raw.observed_on ?? null,
    timeObservedAt: raw.time_observed_at ?? null,
    qualityGrade: raw.quality_grade,
    taxonId: raw.taxon?.id ?? null,
    taxonRankLevel: raw.taxon?.rank_level ?? null,
    ancestorIds: raw.taxon?.ancestor_ids ?? [],
    placeIds: raw.place_ids ?? [],
  };
}

export async function setStatus(status: SyncStatus): Promise<void> {
  await browser.storage.local.set({ syncStatus: status });
}

export async function lookupUser(login: string): Promise<UserMeta> {
  const res = await apiGet<Page<RawUser>>(`/v1/users/${encodeURIComponent(login.trim())}`);
  const u = res.results[0];
  if (!u) throw new Error(`No iNaturalist user "${login}"`);
  const existing = await (await db()).get('users', u.id);
  const meta: UserMeta = {
    lastSyncStartedAt: null,
    lastSyncCompletedAt: null,
    lastFullSyncAt: null,
    ...existing,
    id: u.id,
    login: u.login,
    name: u.name,
    iconUrl: u.icon_url,
    observationsCount: u.observations_count,
    speciesCount: u.species_count,
  };
  await (await db()).put('users', meta);
  return meta;
}

let running: Promise<void> | null = null;

/** Starts a sync unless one is already running. Resolves when it finishes. */
export function sync(userId: number, opts: { full?: boolean } = {}): Promise<void> {
  running ??= doSync(userId, opts).finally(() => (running = null));
  return running;
}

/** Called on service-worker startup: finishes a sync the browser interrupted. */
export async function resumeInterruptedSync(): Promise<void> {
  const { syncJob } = (await browser.storage.local.get('syncJob')) as { syncJob?: SyncJob };
  if (syncJob) await sync(syncJob.userId, { full: syncJob.full });
}

async function doSync(userId: number, opts: { full?: boolean }): Promise<void> {
  try {
    const user = await (await db()).get('users', userId);
    if (!user) throw new Error('Unknown user; set your username first.');

    const job = await startOrResumeJob(user, opts.full);
    await syncObservations(job);
    await syncTaxonomy(userId);
    await recomputeLifers(userId);

    const now = new Date().toISOString();
    await (await db()).put('users', {
      ...user,
      lastSyncStartedAt: job.startedAt,
      lastSyncCompletedAt: now,
      lastFullSyncAt: job.full ? job.startedAt : user.lastFullSyncAt,
    });
    await browser.storage.local.remove('syncJob');
    await setStatus({ phase: 'idle', userId, fetched: job.fetched, total: job.fetched });
  } catch (err) {
    console.error('[iNaturalistGG] sync failed', err);
    await setStatus({ phase: 'error', userId, fetched: 0, total: 0, message: String(err) });
    throw err;
  }
}

async function startOrResumeJob(user: UserMeta, forceFull?: boolean): Promise<SyncJob> {
  const { syncJob } = (await browser.storage.local.get('syncJob')) as { syncJob?: SyncJob };
  if (syncJob && syncJob.userId === user.id && !forceFull) return { ...syncJob, resumed: true };

  const due =
    !user.lastSyncStartedAt ||
    !user.lastFullSyncAt ||
    Date.now() - Date.parse(user.lastFullSyncAt) > FULL_SYNC_EVERY_MS;
  const full = forceFull || due;
  const job: SyncJob = {
    userId: user.id,
    full,
    cursor: 0,
    startedAt: new Date().toISOString(),
    updatedSince: full ? null : user.lastSyncStartedAt,
    fetched: 0,
    resumed: false,
  };
  await browser.storage.local.set({ syncJob: job });
  return job;
}

async function syncObservations(job: SyncJob): Promise<void> {
  const keep = new Set<number>();
  let total = 0;
  for (;;) {
    const page = await apiGet<Page<RawObs>>('/v2/observations', {
      user_id: job.userId,
      order_by: 'id',
      order: 'asc',
      id_above: job.cursor,
      per_page: PER_PAGE,
      updated_since: job.updatedSince,
      fields: OBS_FIELDS,
    });
    // total_results counts what's left above the cursor, so the overall total is fetched + remaining.
    total = job.fetched + page.total_results;
    if (!page.results.length) break;

    const obs = page.results.map((r) => toObs(r, job.userId));
    await putMany('observations', obs);
    obs.forEach((o) => keep.add(o.id));
    job.cursor = obs[obs.length - 1].id;
    job.fetched += obs.length;
    await browser.storage.local.set({ syncJob: job });
    await setStatus({ phase: 'observations', userId: job.userId, fetched: job.fetched, total });
    if (page.results.length < PER_PAGE) break;
  }
  if (job.full && !job.resumed) await pruneObservations(job.userId, keep);
}

async function syncTaxonomy(userId: number): Promise<void> {
  await setStatus({ phase: 'taxonomy', userId, fetched: 0, total: 0 });
  const res = await apiGet<{ results: RawTaxonomyNode[] }>('/v1/observations/taxonomy', {
    user_id: userId,
  });
  const existing = new Map(((await (await db()).getAll('taxa')) as Taxon[]).map((t) => [t.id, t]));
  const taxa: Taxon[] = res.results.map((t) => ({
    commonName: existing.get(t.id)?.commonName,
    id: t.id,
    name: t.name,
    rank: t.rank,
    rankLevel: t.rank_level,
    parentId: t.parent_id,
  }));
  await putMany('taxa', taxa);
}

export async function recomputeLifers(userId: number): Promise<void> {
  await setStatus({ phase: 'lifers', userId, fetched: 0, total: 0 });
  const [observations, taxa] = await Promise.all([
    userObservations(userId),
    (await db()).getAll('taxa'),
  ]);
  const rankLevels = new Map(taxa.map((t) => [t.id, t.rankLevel]));
  const records = computeLifers(observations, (id) => rankLevels.get(id));
  await replaceLifers(userId, records);
}
