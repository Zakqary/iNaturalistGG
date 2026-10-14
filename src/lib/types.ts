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

export interface Place {
  id: number;
  name: string;
  displayName: string;
  /** iNat admin levels: -10 continent, 0 country, 10 territory (state/province), 20 county, 30 town; null for user-made places. */
  adminLevel: number | null;
  /** Containing places from continent down, including this place. */
  ancestorPlaceIds?: number[];
}

export type ScopeKey = 'county' | 'territory' | 'country' | 'continent' | 'world';

export interface ScopeStats {
  scope: ScopeKey;
  placeId: number | null;
  placeName: string;
  /** For a county, the territory it's in (which may differ from your top territory). */
  parentName?: string;
  observationCount: number;
  speciesCount: number;
  /** Competition rank (ties share a rank); null when outside the top 500 iNat reports. */
  observationRank: number | null;
  speciesRank: number | null;
  /** Worldwide species rank is estimated; see approximateSpeciesBoard. */
  speciesRankApprox?: boolean;
}

export interface StatsSnapshot {
  version?: number;
  userId: number;
  computedAt: string;
  scopes: ScopeStats[];
}

export type SyncPhase = 'idle' | 'observations' | 'taxonomy' | 'lifers' | 'error';

export interface SyncStatus {
  phase: SyncPhase;
  userId: number | null;
  fetched: number;
  total: number;
  message?: string;
}
