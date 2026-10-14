import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { checkBadges, resumeInterruptedBadgeCheck, userBadges } from '../lib/badges';
import { db } from '../lib/db';
import type { BadgeView, LiferInfo, Message, MessageMap, MessageType, PioneerView } from '../lib/messages';
import { tierFor } from '../lib/ranks';
import { computeStats, STATS_MAX_AGE_MS, STATS_VERSION } from '../lib/stats';
import { lookupUser, resumeInterruptedSync, sync } from '../lib/sync';
import { completion, fetchNeeds, lifeTree } from '../lib/explore';
import { checkPioneers, userPioneers } from '../lib/pioneers';
import { ensureCommonNames } from '../lib/taxa';
import type { BadgeStatus, PioneerStatus, StatsSnapshot, UserMeta } from '../lib/types';

const SYNC_ALARM = 'igg-sync';
const SYNC_PERIOD_MINUTES = 6 * 60;
const COMMON_NAME_WAIT_MS = 3000;

async function currentUser(): Promise<UserMeta | null> {
  const { userId } = (await browser.storage.local.get('userId')) as { userId?: number };
  return userId ? ((await (await db()).get('users', userId)) ?? null) : null;
}

async function requireUser(): Promise<UserMeta> {
  const user = await currentUser();
  if (!user) throw new Error('Set your iNaturalist username first.');
  return user;
}

/**
 * Sync, then the background checks that depend on it: the weekly badge check
 * (if due) and the next batch of pioneer checks. They share the API queue.
 */
async function syncAndCheckBadges(userId: number, opts: { full?: boolean } = {}): Promise<void> {
  await sync(userId, opts);
  await Promise.all([checkBadges(userId), checkPioneers(userId)]);
}

const handlers: { [T in MessageType]: (req: MessageMap[T]['req']) => Promise<MessageMap[T]['res']> } = {
  async getLifers({ obsIds }) {
    const d = await db();
    const records = (await Promise.all(obsIds.map((id) => d.get('lifers', id)))).filter((r) => !!r);
    // Your first verifiable sighting can be a pioneer without being a lifer (if an earlier one was casual).
    const pioneers = new Map(
      (await Promise.all(obsIds.map((id) => d.getFromIndex('pioneers', 'byObs', id))))
        .filter((p) => !!p && p.level !== null)
        .map((p) => [p!.obsId, { level: p!.level!, placeName: p!.placeName ?? '' }]),
    );
    const taxonIds = [...new Set(records.flatMap((r) => r.taxonIds))];
    const taxa = (await Promise.all(taxonIds.map((id) => d.get('taxa', id)))).filter((t) => !!t);
    // Don't hold chips hostage to a busy request queue; names show up on the next lookup.
    await Promise.race([ensureCommonNames(taxa).catch(() => undefined), new Promise((r) => setTimeout(r, COMMON_NAME_WAIT_MS))]);
    const byId = new Map(taxa.map((t) => [t.id, t]));

    const out: Record<number, LiferInfo> = {};
    for (const r of records) {
      out[r.obsId] = {
        obsId: r.obsId,
        topRankLevel: r.topRankLevel,
        taxa: r.taxonIds
          .map((id) => byId.get(id))
          .filter((t) => !!t)
          .map((t) => ({ id: t.id, name: t.name, commonName: t.commonName || undefined, rank: t.rank, rankLevel: t.rankLevel }))
          .sort((a, b) => b.rankLevel - a.rankLevel),
        pioneer: pioneers.get(r.obsId),
      };
    }
    for (const [obsId, pioneer] of pioneers) out[obsId] ??= { obsId, topRankLevel: 0, taxa: [], pioneer };
    return out;
  },

  async setUser({ login }) {
    const user = await lookupUser(login);
    await browser.storage.local.set({ userId: user.id });
    void syncAndCheckBadges(user.id).catch(() => undefined);
    return user;
  },

  async getUser() {
    return currentUser();
  },

  async sync({ full }) {
    const user = await currentUser();
    if (!user) throw new Error('Set your iNaturalist username first.');
    void syncAndCheckBadges(user.id, { full }).catch(() => undefined);
    return { started: true };
  },

  async getSummary() {
    const user = await currentUser();
    if (!user) return { observations: 0, lifers: 0, byTier: {}, badges: 0 };
    const d = await db();
    const [observations, lifers, badges] = await Promise.all([
      d.countFromIndex('observations', 'byUser', user.id),
      d.getAllFromIndex('lifers', 'byUser', user.id),
      userBadges(user.id),
    ]);
    const byTier: Record<string, number> = {};
    for (const r of lifers) {
      const label = tierFor(r.topRankLevel).label;
      byTier[label] = (byTier[label] ?? 0) + 1;
    }
    return { observations, lifers: lifers.length, byTier, badges: badges.filter((b) => b.current).length };
  },

  async getStats({ refresh, cachedOnly }) {
    const user = await currentUser();
    if (!user) throw new Error('Set your iNaturalist username first.');
    const cached = await (await db()).get('stats', user.id);
    const current = cached?.version === STATS_VERSION ? cached : undefined;
    const fresh = current && Date.now() - Date.parse(current.computedAt) < STATS_MAX_AGE_MS;
    if (cachedOnly || (fresh && !refresh)) return current ?? null;
    if (!user.lastSyncCompletedAt) throw new Error('Your first sync is still running; ranks need your observations.');
    // Refresh profile totals first; they're the worldwide fallback when you're outside the top 500.
    statsJob ??= lookupUser(user.login)
      .then(computeStats)
      .finally(() => (statsJob = null));
    return statsJob;
  },

  async getBadges() {
    const user = await currentUser();
    if (!user) return { badges: [], status: null };
    const d = await db();
    const badges = await userBadges(user.id);
    const taxa = (await Promise.all([...new Set(badges.map((b) => b.taxonId))].map((id) => d.get('taxa', id)))).filter(
      (t) => !!t,
    );
    await ensureCommonNames(taxa).catch(() => undefined);
    const byId = new Map(taxa.map((t) => [t.id, t]));
    const views: BadgeView[] = badges.map((b) => {
      const t = byId.get(b.taxonId);
      return {
        ...b,
        taxonName: t?.name ?? `Taxon ${b.taxonId}`,
        commonName: t?.commonName || undefined,
        taxonRank: t?.rank ?? '',
        taxonRankLevel: t?.rankLevel ?? 0,
      };
    });
    const { badgeStatus } = (await browser.storage.local.get('badgeStatus')) as { badgeStatus?: BadgeStatus };
    return { badges: views, status: badgeStatus ?? null };
  },

  async getNeeds(req) {
    const user = await requireUser();
    return fetchNeeds({ ...req, userId: user.id });
  },

  async getLifeTree({ placeId }) {
    const user = await requireUser();
    return lifeTree(user.id, placeId);
  },

  async getCompletion({ placeId, taxonIds }) {
    return completion(placeId, taxonIds);
  },

  async getPioneers() {
    const user = await currentUser();
    if (!user) return { pioneers: [], status: null };
    const d = await db();
    const pioneers = await userPioneers(user.id);
    const taxa = (await Promise.all(pioneers.map((p) => d.get('taxa', p.speciesId)))).filter((t) => !!t);
    await ensureCommonNames(taxa).catch(() => undefined);
    const byId = new Map(taxa.map((t) => [t.id, t]));
    const views: PioneerView[] = pioneers.map((p) => ({
      ...p,
      speciesName: byId.get(p.speciesId)?.name ?? `Taxon ${p.speciesId}`,
      commonName: byId.get(p.speciesId)?.commonName || undefined,
    }));
    const { pioneerStatus } = (await browser.storage.local.get('pioneerStatus')) as { pioneerStatus?: PioneerStatus };
    return { pioneers: views, status: pioneerStatus ?? null };
  },

  async checkPioneers() {
    const user = await requireUser();
    if (!user.lastSyncCompletedAt) throw new Error('Your first sync is still running; pioneers need your observations.');
    void checkPioneers(user.id).catch(() => undefined);
    return { started: true };
  },

  async checkBadges() {
    const user = await currentUser();
    if (!user) throw new Error('Set your iNaturalist username first.');
    if (!user.lastSyncCompletedAt) throw new Error('Your first sync is still running; badges need your observations.');
    void checkBadges(user.id, { force: true }).catch(() => undefined);
    return { started: true };
  },
};

let statsJob: Promise<StatsSnapshot> | null = null;

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((msg: Message, _sender, sendResponse) => {
    const handler = handlers[msg.type] as (req: Message) => Promise<unknown>;
    if (!handler) return false;
    handler(msg).then(
      (data) => sendResponse({ ok: true, data }),
      (err) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
    );
    return true; // keep the channel open for the async response
  });

  browser.alarms.create(SYNC_ALARM, { periodInMinutes: SYNC_PERIOD_MINUTES });
  browser.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== SYNC_ALARM) return;
    const user = await currentUser();
    if (user) await syncAndCheckBadges(user.id).catch(() => undefined);
  });

  void resumeInterruptedSync()
    .then(resumeInterruptedBadgeCheck)
    .catch(() => undefined);
});
