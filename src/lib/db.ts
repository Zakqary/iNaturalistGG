import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Badge, LiferRecord, Obs, Pioneer, Place, StatsSnapshot, Taxon, UserMeta } from './types';

interface GGSchema extends DBSchema {
  observations: { key: number; value: Obs; indexes: { byUser: number } };
  lifers: { key: number; value: LiferRecord; indexes: { byUser: number } };
  taxa: { key: number; value: Taxon };
  users: { key: number; value: UserMeta };
  places: { key: number; value: Place };
  stats: { key: number; value: StatsSnapshot };
  badges: { key: string; value: Badge; indexes: { byUser: number } };
  /** Species totals per group per place, keyed placeId:taxonId. */
  completion: { key: string; value: { key: string; total: number; fetchedAt: string } };
  pioneers: { key: string; value: Pioneer; indexes: { byUser: number; byObs: number } };
}

let dbPromise: Promise<IDBPDatabase<GGSchema>> | null = null;

export function db(): Promise<IDBPDatabase<GGSchema>> {
  dbPromise ??= openDB<GGSchema>('inaturalistgg', 6, {
    async upgrade(d, oldVersion, _newVersion, tx) {
      if (oldVersion < 1) {
        d.createObjectStore('observations', { keyPath: 'id' }).createIndex('byUser', 'userId');
        d.createObjectStore('lifers', { keyPath: 'obsId' }).createIndex('byUser', 'userId');
        d.createObjectStore('taxa', { keyPath: 'id' });
        d.createObjectStore('users', { keyPath: 'id' });
      }
      if (oldVersion < 2) {
        d.createObjectStore('places', { keyPath: 'id' });
        d.createObjectStore('stats', { keyPath: 'userId' });
      }
      if (oldVersion < 3) {
        d.createObjectStore('badges', { keyPath: 'key' }).createIndex('byUser', 'userId');
      }
      if (oldVersion < 4) {
        d.createObjectStore('completion', { keyPath: 'key' });
      }
      if (oldVersion < 5) {
        const pioneers = d.createObjectStore('pioneers', { keyPath: 'key' });
        pioneers.createIndex('byUser', 'userId');
        pioneers.createIndex('byObs', 'obsId');
      }
      if (oldVersion === 5) {
        // "county" was renamed "district" (it isn't a county outside the US).
        for await (const cursor of tx.objectStore('pioneers').iterate()) {
          if ((cursor.value.level as string) === 'county') await cursor.update({ ...cursor.value, level: 'district' });
        }
      }
    },
  });
  return dbPromise;
}

export async function putMany<S extends 'observations' | 'taxa' | 'places'>(
  store: S,
  values: GGSchema[S]['value'][],
): Promise<void> {
  const tx = (await db()).transaction(store, 'readwrite');
  await Promise.all([...values.map((v) => tx.store.put(v as never)), tx.done]);
}

export async function userObservations(userId: number): Promise<Obs[]> {
  return (await db()).getAllFromIndex('observations', 'byUser', userId);
}

/** Deletes the user's stored observations whose ids aren't in `keep`. */
export async function pruneObservations(userId: number, keep: Set<number>): Promise<number> {
  const tx = (await db()).transaction('observations', 'readwrite');
  let removed = 0;
  for await (const cursor of tx.store.index('byUser').iterate(userId)) {
    if (!keep.has(cursor.value.id)) {
      await cursor.delete();
      removed++;
    }
  }
  await tx.done;
  return removed;
}

export async function replaceLifers(userId: number, records: LiferRecord[]): Promise<void> {
  const tx = (await db()).transaction('lifers', 'readwrite');
  for await (const cursor of tx.store.index('byUser').iterate(userId)) await cursor.delete();
  for (const r of records) await tx.store.put(r);
  await tx.done;
}
