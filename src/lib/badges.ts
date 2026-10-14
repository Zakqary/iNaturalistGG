import { browser } from 'wxt/browser';
import { apiGet, type Page } from './api';
import { db, userObservations } from './db';
import { LIFE_TAXON_ID } from './lifers';
import { competitionRank, type LeaderboardRow } from './stats';
import type { Badge, BadgeMetric, BadgeStatus, Obs } from './types';

/** Order. Anything at this rank or above (superorder, class, phylum, kingdom…) can earn a badge. */
export const MIN_BADGE_RANK_LEVEL = 40;
export const BADGE_TOP_N = 3;
/**
 * You need at least this many species (for a species badge) or observations
 * (for an observations badge) in the group, so a one-species group like
 * Ginkgoopsida doesn't award everyone who's seen a Ginkgo.
 */
export const BADGE_MIN_COUNT = 5;
export const BADGE_CHECK_EVERY_MS = 7 * 24 * 3600 * 1000;

const METRIC_FIELD: Record<BadgeMetric, 'species_count' | 'observation_count'> = {
  species: 'species_count',
  observations: 'observation_count',
};

export interface Candidate {
  taxonId: number;
  observations: number;
  species: number;
}

/**
 * Groups at order rank or above the user has observed, with the user's own
 * counts (used to detect a tie with 3rd place), biggest groups first.
 */
export function badgeCandidates(observations: Obs[], rankLevelOf: (id: number) => number | undefined): Candidate[] {
  const obsCount = new Map<number, number>();
  const speciesSets = new Map<number, Set<number>>();

  for (const o of observations) {
    const species = o.ancestorIds.find((id) => rankLevelOf(id) === 10);
    for (const id of o.ancestorIds) {
      if (id === LIFE_TAXON_ID) continue;
      if ((rankLevelOf(id) ?? 0) < MIN_BADGE_RANK_LEVEL) continue;
      obsCount.set(id, (obsCount.get(id) ?? 0) + 1);
      if (species !== undefined) {
        const set = speciesSets.get(id) ?? new Set<number>();
        set.add(species);
        speciesSets.set(id, set);
      }
    }
  }
  return [...obsCount.entries()]
    .map(([taxonId, observations]) => ({ taxonId, observations, species: speciesSets.get(taxonId)?.size ?? 0 }))
    .sort((a, b) => b.observations - a.observations);
}

/**
 * The user's rank if it's in the top 3, given only the top-3 rows. When the
 * user isn't listed but ties 3rd place, they share 3rd.
 */
export function topRank(
  rows: LeaderboardRow[],
  userId: number,
  metric: BadgeMetric,
  ownCount: number,
): number | null {
  const field = METRIC_FIELD[metric];
  const mine = rows.find((r) => r.user_id === userId);
  if ((mine ? mine[field] : ownCount) < BADGE_MIN_COUNT) return null;
  const listed = competitionRank(rows, userId, field);
  if (listed !== null) return listed <= BADGE_TOP_N ? listed : null;
  const third = rows[BADGE_TOP_N - 1];
  if (third && ownCount > 0 && ownCount === third[field]) {
    return competitionRank([...rows, { user_id: userId, species_count: ownCount, observation_count: ownCount }], userId, field);
  }
  return null;
}

export const badgeKey = (userId: number, taxonId: number, metric: BadgeMetric) => `${userId}:${taxonId}:${metric}`;

/** Progress persisted so an interrupted check resumes where it stopped. */
interface BadgeJob {
  userId: number;
  startedAt: string;
  remaining: Candidate[];
  total: number;
}

async function setBadgeStatus(status: BadgeStatus): Promise<void> {
  await browser.storage.local.set({ badgeStatus: status });
}

async function recordResult(
  job: BadgeJob,
  taxonId: number,
  metric: BadgeMetric,
  rank: number | null,
  count: number,
): Promise<void> {
  const d = await db();
  const key = badgeKey(job.userId, taxonId, metric);
  const existing = await d.get('badges', key);
  const now = new Date().toISOString();
  if (rank !== null) {
    await d.put('badges', {
      key,
      userId: job.userId,
      taxonId,
      metric,
      rank,
      count,
      current: true,
      bestRank: Math.min(rank, existing?.bestRank ?? rank),
      firstEarnedAt: existing?.current ? existing.firstEarnedAt : now,
      lastConfirmedAt: now,
      lostAt: null,
    });
  } else if (existing && existing.count < BADGE_MIN_COUNT) {
    // Earned before the minimum existed; it was never a real badge, so don't keep it as history.
    await d.delete('badges', key);
  } else if (existing?.current) {
    await d.put('badges', { ...existing, current: false, lostAt: now });
  }
}

let running: Promise<void> | null = null;

export function checkBadges(userId: number, opts: { force?: boolean } = {}): Promise<void> {
  running ??= runBadgeCheck(userId, !!opts.force).finally(() => (running = null));
  return running;
}

export function badgeCheckRunning(): boolean {
  return running !== null;
}

async function runBadgeCheck(userId: number, force: boolean): Promise<void> {
  const d = await db();
  const user = await d.get('users', userId);
  if (!user) return;

  let { badgeJob: job } = (await browser.storage.local.get('badgeJob')) as { badgeJob?: BadgeJob };
  if (!job || job.userId !== userId || force) {
    const due = !user.lastBadgeCheckAt || Date.now() - Date.parse(user.lastBadgeCheckAt) > BADGE_CHECK_EVERY_MS;
    if (!due && !force) return;
    const taxa = await d.getAll('taxa');
    const rankLevels = new Map(taxa.map((t) => [t.id, t.rankLevel]));
    const remaining = badgeCandidates(await userObservations(userId), (id) => rankLevels.get(id));
    job = { userId, startedAt: new Date().toISOString(), remaining, total: remaining.length };
    await browser.storage.local.set({ badgeJob: job });
  }

  try {
    while (job.remaining.length) {
      const c = job.remaining[0];
      await setBadgeStatus({ running: true, checked: job.total - job.remaining.length, total: job.total });
      for (const metric of ['species', 'observations'] as const) {
        const res = await apiGet<Page<LeaderboardRow>>('/v1/observations/observers', {
          taxon_id: c.taxonId,
          order_by: METRIC_FIELD[metric],
          per_page: BADGE_TOP_N,
        });
        const ownCount = metric === 'species' ? c.species : c.observations;
        const rank = topRank(res.results, userId, metric, ownCount);
        const row = res.results.find((r) => r.user_id === userId);
        await recordResult(job, c.taxonId, metric, rank, row ? row[METRIC_FIELD[metric]] : ownCount);
      }
      job.remaining.shift();
      await browser.storage.local.set({ badgeJob: job });
    }

    // Badges for groups no longer in your observations (e.g. after taxon changes) are lost too.
    const tx = d.transaction('badges', 'readwrite');
    for await (const cursor of tx.store.index('byUser').iterate(userId)) {
      const b = cursor.value;
      if (b.current && b.lastConfirmedAt < job.startedAt) await cursor.update({ ...b, current: false, lostAt: job.startedAt });
    }
    await tx.done;

    await d.put('users', { ...((await d.get('users', userId)) ?? user), lastBadgeCheckAt: job.startedAt });
    await browser.storage.local.remove('badgeJob');
    await setBadgeStatus({ running: false, checked: job.total, total: job.total, completedAt: new Date().toISOString() });
  } catch (err) {
    console.error('[iNaturalistGG] badge check failed', err);
    await setBadgeStatus({ running: false, checked: job.total - job.remaining.length, total: job.total, error: String(err) });
    throw err;
  }
}

/** Called on service-worker startup: finishes a badge check the browser interrupted. */
export async function resumeInterruptedBadgeCheck(): Promise<void> {
  const { badgeJob } = (await browser.storage.local.get('badgeJob')) as { badgeJob?: BadgeJob };
  if (badgeJob) await checkBadges(badgeJob.userId);
}

export async function userBadges(userId: number): Promise<Badge[]> {
  const badges = await (await db()).getAllFromIndex('badges', 'byUser', userId);
  return badges.filter((b) => b.count >= BADGE_MIN_COUNT);
}
