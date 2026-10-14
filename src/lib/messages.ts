import { browser } from 'wxt/browser';
import type { CompletionInfo, NeedsItem, TreeNode } from './explore';
import type { Badge, BadgeStatus, Pioneer, PioneerLevel, PioneerStatus, StatsSnapshot, UserMeta } from './types';

export interface LiferTaxon {
  id: number;
  name: string;
  commonName?: string;
  rank: string;
  rankLevel: number;
}

export interface BadgeView extends Badge {
  taxonName: string;
  commonName?: string;
  taxonRank: string;
  taxonRankLevel: number;
}

export interface PioneerView extends Pioneer {
  speciesName: string;
  commonName?: string;
}

export interface LiferInfo {
  obsId: number;
  topRankLevel: number;
  taxa: LiferTaxon[];
  /** Set when this observation was the first iNat record of its species in a place. */
  pioneer?: { level: PioneerLevel; placeName: string };
}

/** Every message the background script handles, mapped to its response type. */
export interface MessageMap {
  getLifers: { req: { obsIds: number[] }; res: Record<number, LiferInfo> };
  setUser: { req: { login: string }; res: UserMeta };
  getUser: { req: Record<string, never>; res: UserMeta | null };
  sync: { req: { full?: boolean }; res: { started: boolean } };
  getSummary: {
    req: Record<string, never>;
    res: { observations: number; lifers: number; byTier: Record<string, number>; badges: number };
  };
  getBadges: { req: Record<string, never>; res: { badges: BadgeView[]; status: BadgeStatus | null } };
  /** Starts a badge check now, even if one ran recently. */
  checkBadges: { req: Record<string, never>; res: { started: boolean } };
  getNeeds: {
    req: { placeId: number; taxonId?: number; months?: number[]; page: number };
    res: { total: number; items: NeedsItem[] };
  };
  getLifeTree: { req: { placeId: number }; res: TreeNode[] };
  getCompletion: { req: { placeId: number; taxonIds: number[] }; res: Record<number, CompletionInfo> };
  getPioneers: { req: Record<string, never>; res: { pioneers: PioneerView[]; status: PioneerStatus | null } };
  /** Checks the next batch of species now. */
  checkPioneers: { req: Record<string, never>; res: { started: boolean } };
  /** Cached ranks if fresh (or `cachedOnly`), otherwise recomputes them (~10–30 s). */
  getStats: { req: { refresh?: boolean; cachedOnly?: boolean }; res: StatsSnapshot | null };
}

export type MessageType = keyof MessageMap;
export type Message<T extends MessageType = MessageType> = { type: T } & MessageMap[T]['req'];

export type Response<T extends MessageType> = { ok: true; data: MessageMap[T]['res'] } | { ok: false; error: string };

export async function send<T extends MessageType>(
  type: T,
  req: MessageMap[T]['req'],
): Promise<MessageMap[T]['res']> {
  const res = (await browser.runtime.sendMessage({ type, ...req })) as Response<T>;
  if (!res.ok) throw new Error(res.error);
  return res.data;
}
