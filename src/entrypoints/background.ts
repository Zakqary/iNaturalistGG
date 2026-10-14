import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { apiGet, type Page } from '../lib/api';
import { db } from '../lib/db';
import type { LiferInfo, Message, MessageMap, MessageType } from '../lib/messages';
import { tierFor } from '../lib/ranks';
import { lookupUser, resumeInterruptedSync, sync } from '../lib/sync';
import type { Taxon, UserMeta } from '../lib/types';

const SYNC_ALARM = 'igg-sync';
const SYNC_PERIOD_MINUTES = 6 * 60;
const TAXA_BATCH = 30; // max ids /v2/taxa accepts per request
const COMMON_NAME_WAIT_MS = 3000;

async function currentUser(): Promise<UserMeta | null> {
  const { userId } = (await browser.storage.local.get('userId')) as { userId?: number };
  return userId ? ((await (await db()).get('users', userId)) ?? null) : null;
}

/** Fills in common names (iNat's taxonomy endpoint only returns scientific names). */
async function ensureCommonNames(taxa: Taxon[]): Promise<void> {
  const missing = taxa.filter((t) => t.commonName === undefined);
  for (let i = 0; i < missing.length; i += TAXA_BATCH) {
    const batch = missing.slice(i, i + TAXA_BATCH);
    const res = await apiGet<Page<{ id: number; preferred_common_name?: string }>>(
      `/v2/taxa/${batch.map((t) => t.id).join(',')}`,
      { fields: 'id,preferred_common_name' },
    );
    const names = new Map(res.results.map((r) => [r.id, r.preferred_common_name ?? '']));
    const tx = (await db()).transaction('taxa', 'readwrite');
    for (const t of batch) {
      t.commonName = names.get(t.id) ?? '';
      void tx.store.put(t);
    }
    await tx.done;
  }
}

const handlers: { [T in MessageType]: (req: MessageMap[T]['req']) => Promise<MessageMap[T]['res']> } = {
  async getLifers({ obsIds }) {
    const d = await db();
    const records = (await Promise.all(obsIds.map((id) => d.get('lifers', id)))).filter((r) => !!r);
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
      };
    }
    return out;
  },

  async setUser({ login }) {
    const user = await lookupUser(login);
    await browser.storage.local.set({ userId: user.id });
    void sync(user.id).catch(() => undefined);
    return user;
  },

  async getUser() {
    return currentUser();
  },

  async sync({ full }) {
    const user = await currentUser();
    if (!user) throw new Error('Set your iNaturalist username first.');
    void sync(user.id, { full }).catch(() => undefined);
    return { started: true };
  },

  async getSummary() {
    const user = await currentUser();
    if (!user) return { observations: 0, lifers: 0, byTier: {} };
    const d = await db();
    const [observations, lifers] = await Promise.all([
      d.countFromIndex('observations', 'byUser', user.id),
      d.getAllFromIndex('lifers', 'byUser', user.id),
    ]);
    const byTier: Record<string, number> = {};
    for (const r of lifers) {
      const label = tierFor(r.topRankLevel).label;
      byTier[label] = (byTier[label] ?? 0) + 1;
    }
    return { observations, lifers: lifers.length, byTier };
  },
};

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
    if (user) await sync(user.id).catch(() => undefined);
  });

  void resumeInterruptedSync().catch(() => undefined);
});
