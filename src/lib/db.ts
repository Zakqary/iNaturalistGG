import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { LiferRecord, Obs, Place, StatsSnapshot, Taxon, UserMeta } from './types';

interface GGSchema extends DBSchema {
  observations: { key: number; value: Obs; indexes: { byUser: number } };
  lifers: { key: number; value: LiferRecord; indexes: { byUser: number } };
  taxa: { key: number; value: Taxon };
  users: { key: number; value: UserMeta };
  places: { key: number; value: Place };
  stats: { key: number; value: StatsSnapshot };
}

let dbPromise: Promise<IDBPDatabase<GGSchema>> | null = null;

export function db(): Promise<IDBPDatabase<GGSchema>> {
  dbPromise ??= openDB<GGSchema>('inaturalistgg', 2, {
    upgrade(d, oldVersion) {
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
