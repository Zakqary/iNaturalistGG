/**
 * Single rate-limited queue for every iNaturalist API request.
 * iNat asks clients to stay around 1 request/second; we leave a little headroom.
 */
const API_ROOT = 'https://api.inaturalist.org';
const MIN_INTERVAL_MS = 1100;
const RATE_LIMIT_BACKOFF_MS = 60_000;
const MAX_RETRIES = 3;

let queue: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type Params = Record<string, string | number | boolean | undefined | null>;

export function buildUrl(path: string, params: Params = {}): string {
  const url = new URL(path, API_ROOT);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  return url.toString();
}

async function fetchWithRetry<T>(url: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();

    const res = await fetch(url, { headers: { 'X-Via': 'iNaturalistGG' } });
    if (res.ok) return (await res.json()) as T;
    if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
      await sleep(res.status === 429 ? RATE_LIMIT_BACKOFF_MS : 5_000 * (attempt + 1));
      continue;
    }
    throw new Error(`iNaturalist API ${res.status} for ${url}`);
  }
}

export function apiGet<T>(path: string, params?: Params): Promise<T> {
  const url = buildUrl(path, params);
  const result = queue.then(() => fetchWithRetry<T>(url));
  queue = result.catch(() => undefined);
  return result;
}

export interface Page<T> {
  total_results: number;
  page: number;
  per_page: number;
  results: T[];
}
