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
  lastBadgeCheckAt?: string | null;
}

export interface Place {
  id: number;
  name: string;
  displayName: string;
  /** iNat admin levels: -10 continent, 0 country, 10 territory (state/province), 20 district (county/municipality), 30 town; null for user-made places. */
  adminLevel: number | null;
  /** Containing places from continent down, including this place. */
  ancestorPlaceIds?: number[];
}

export type ScopeKey = 'district' | 'territory' | 'country' | 'continent' | 'world';

export interface ScopeStats {
  scope: ScopeKey;
  placeId: number | null;
  placeName: string;
  /** For a district, the territory it's in (which may differ from your top territory). */
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

export type BadgeMetric = 'species' | 'observations';

/** A worldwide, all-time top-3 placing in a group at order rank or above. */
export interface Badge {
  key: string; // userId:taxonId:metric
  userId: number;
  taxonId: number;
  metric: BadgeMetric;
  rank: number;
  count: number;
  bestRank: number;
  /** False once you drop out of the top 3; kept as badge history. */
  current: boolean;
  firstEarnedAt: string;
  lastConfirmedAt: string;
  lostAt: string | null;
}

export interface BadgeStatus {
  running: boolean;
  checked: number;
  total: number;
  completedAt?: string;
  error?: string;
}

export type PioneerLevel = 'district' | 'territory' | 'country';

/** Whether your first verifiable observation of a species was the first iNat record in its place. */
export interface Pioneer {
  key: string; // userId:speciesId
  userId: number;
  speciesId: number;
  obsId: number;
  observedOn: string;
  /** The largest place it was first in, or null if it wasn't first anywhere. */
  level: PioneerLevel | null;
  placeId: number | null;
  placeName: string | null;
  checkedAt: string;
}

export interface PioneerStatus {
  running: boolean;
  /** Species checked in this run, out of `total` scheduled for it. */
  checked: number;
  total: number;
  /** Species still waiting for a check, including future runs. */
  remaining: number;
  species: number;
  completedAt?: string;
  error?: string;
}

export type SyncPhase = 'idle' | 'observations' | 'taxonomy' | 'lifers' | 'error';

export interface SyncStatus {
  phase: SyncPhase;
  userId: number | null;
  fetched: number;
  total: number;
  message?: string;
}
