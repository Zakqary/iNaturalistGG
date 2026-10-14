import { browser } from 'wxt/browser';
import type { StatsSnapshot, UserMeta } from './types';

export interface LiferTaxon {
  id: number;
  name: string;
  commonName?: string;
  rank: string;
  rankLevel: number;
}

export interface LiferInfo {
  obsId: number;
  topRankLevel: number;
  taxa: LiferTaxon[];
}

/** Every message the background script handles, mapped to its response type. */
export interface MessageMap {
  getLifers: { req: { obsIds: number[] }; res: Record<number, LiferInfo> };
  setUser: { req: { login: string }; res: UserMeta };
  getUser: { req: Record<string, never>; res: UserMeta | null };
  sync: { req: { full?: boolean }; res: { started: boolean } };
  getSummary: { req: Record<string, never>; res: { observations: number; lifers: number; byTier: Record<string, number> } };
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
