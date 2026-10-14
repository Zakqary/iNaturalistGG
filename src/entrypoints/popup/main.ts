import { browser } from 'wxt/browser';
import { send } from '../../lib/messages';
import { TIERS } from '../../lib/ranks';
import type { SyncStatus, UserMeta } from '../../lib/types';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const form = $<HTMLFormElement>('user-form');
const loginInput = $<HTMLInputElement>('login');
const userError = $('user-error');
const userSection = $('user-section');
const syncBtn = $<HTMLButtonElement>('sync');
const fullSyncBtn = $<HTMLButtonElement>('full-sync');
const statusEl = $('status');
const progress = $<HTMLProgressElement>('progress');

const fmt = (n: number) => n.toLocaleString();

function renderUser(user: UserMeta | null): void {
  userSection.hidden = !user;
  if (!user) return;
  loginInput.value = user.login;
  $<HTMLImageElement>('avatar').src = user.iconUrl ?? '';
  $('display-name').textContent = user.name || user.login;
  $('counts').textContent = `${fmt(user.observationsCount)} observations · ${fmt(user.speciesCount)} species`;
}

async function renderSummary(): Promise<void> {
  const summary = await send('getSummary', {});
  $('lifer-count').textContent = fmt(summary.lifers);
  $('obs-count').textContent = fmt(summary.observations);
  const tiers = $('tiers');
  tiers.replaceChildren(
    ...TIERS.filter((t) => summary.byTier[t.label]).map((t) => {
      const li = document.createElement('li');
      li.className = t.className;
      li.textContent = `${fmt(summary.byTier[t.label])} ${t.label}`;
      return li;
    }),
  );
}

function renderStatus(status: SyncStatus | undefined, user: UserMeta | null): void {
  const busy = !!status && status.phase !== 'idle' && status.phase !== 'error';
  syncBtn.disabled = fullSyncBtn.disabled = busy;
  progress.hidden = !busy;

  if (!status || status.phase === 'idle') {
    const last = user?.lastSyncCompletedAt;
    statusEl.textContent = last ? `Last synced ${new Date(last).toLocaleString()}` : 'Not synced yet';
    return;
  }
  if (status.phase === 'error') {
    statusEl.textContent = `Sync failed: ${status.message ?? 'unknown error'}`;
    return;
  }
  if (status.phase === 'observations') {
    statusEl.textContent = `Downloading observations… ${fmt(status.fetched)} / ${fmt(status.total)}`;
    progress.max = Math.max(status.total, 1);
    progress.value = status.fetched;
  } else {
    statusEl.textContent = status.phase === 'taxonomy' ? 'Downloading your taxonomy…' : 'Finding lifers…';
    progress.removeAttribute('value'); // indeterminate
  }
}

async function refresh(): Promise<void> {
  const user = await send('getUser', {});
  const { syncStatus } = (await browser.storage.local.get('syncStatus')) as { syncStatus?: SyncStatus };
  renderUser(user);
  renderStatus(syncStatus, user);
  if (user) await renderSummary();
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  userError.hidden = true;
  try {
    renderUser(await send('setUser', { login: loginInput.value }));
  } catch (err) {
    userError.textContent = err instanceof Error ? err.message : String(err);
    userError.hidden = false;
  }
});

syncBtn.addEventListener('click', () => void send('sync', {}));
fullSyncBtn.addEventListener('click', () => void send('sync', { full: true }));

browser.storage.onChanged.addListener((changes) => {
  if (changes.syncStatus) void refresh();
});

void refresh();
