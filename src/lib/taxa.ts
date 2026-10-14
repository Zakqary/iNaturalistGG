import { apiGet, type Page } from './api';
import { db } from './db';
import type { Taxon } from './types';

const TAXA_BATCH = 30; // max ids /v2/taxa accepts per request

/** Fills in common names (iNat's taxonomy endpoint only returns scientific names). */
export async function ensureCommonNames(taxa: Taxon[]): Promise<void> {
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
