/** A user's observation, trimmed to the fields iNaturalistGG needs. */
export interface Obs {
  id: number;
  userId: number;
  observedOn: string | null; // YYYY-MM-DD
  timeObservedAt: string | null; // ISO timestamp with offset
  qualityGrade: string;
  taxonId: number | null;
  taxonRankLevel: number | null;
  /** Includes the observation's own taxon as the last element (iNat convention). */
  ancestorIds: number[];
  placeIds: number[];
}

export interface Taxon {
  id: number;
  name: string;
  rank: string;
  rankLevel: number;
  parentId: number | null;
  commonName?: string;
}

/** The groups a single observation was the user's first observation of. */
export interface LiferRecord {
  obsId: number;
  userId: number;
  taxonIds: number[];
  topRankLevel: number;
}

export interface UserMeta {
  id: number;
  login: string;
  name: string | null;
  iconUrl: string | null;
  observationsCount: number;
  speciesCount: number;
  /** ISO time the last completed sync started; used as updated_since next time. */
  lastSyncStartedAt: string | null;
  lastSyncCompletedAt: string | null;
  /** Full syncs catch deleted observations, which updated_since can't see. */
  lastFullSyncAt: string | null;
}

export type SyncPhase = 'idle' | 'observations' | 'taxonomy' | 'lifers' | 'error';

export interface SyncStatus {
  phase: SyncPhase;
  userId: number | null;
  fetched: number;
  total: number;
  message?: string;
}
