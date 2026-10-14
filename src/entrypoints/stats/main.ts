import { toBlob, toPng } from 'html-to-image';
import { send } from '../../lib/messages';
import { TIERS } from '../../lib/ranks';
import { LEADERBOARD_LIMIT, SCOPE_LABELS, STATS_MAX_AGE_MS } from '../../lib/stats';
import type { ScopeStats, StatsSnapshot, UserMeta } from '../../lib/types';

const CARD_WIDTH = 1200;
const CARD_HEIGHT = 630;

type Summary = Awaited<ReturnType<typeof send<'getSummary'>>>;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const fmt = (n: number) => n.toLocaleString();
const rankText = (rank: number | null, approx = false) =>
  rank === null ? `${LEADERBOARD_LIMIT}+` : `${approx ? '≈' : ''}#${fmt(rank)}`;
const APPROX_NOTE =
  'Estimated: iNaturalist can’t compute the worldwide species leaderboard, so this ranks the top 500 observers by their profile species totals.';
const placeLabel = (s: ScopeStats) => (s.parentName ? `${s.placeName}, ${s.parentName}` : s.placeName);
const medalClass = (rank: number | null) => (rank !== null && rank <= 3 ? `medal-${rank}` : '');

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function showMessage(text: string | null, isError = false): void {
  const msg = $('message');
  msg.hidden = !text;
  msg.textContent = text ?? '';
  msg.classList.toggle('error', isError);
}

let state: { user: UserMeta; summary: Summary; stats: StatsSnapshot | null; avatarDataUrl: string };

// ---------- page sections ----------

function renderProfile(user: UserMeta, summary: Summary): void {
  $('profile').hidden = false;
  $<HTMLImageElement>('avatar').src = user.iconUrl ?? '';
  $('display-name').textContent = user.name || user.login;
  const link = $<HTMLAnchorElement>('profile-link');
  link.href = `https://www.inaturalist.org/people/${user.login}`;
  link.textContent = `@${user.login}`;
  $('total-obs').textContent = fmt(user.observationsCount);
  $('total-species').textContent = fmt(user.speciesCount);
  $('total-lifers').textContent = fmt(summary.lifers);
}

function metric(name: string, rank: number | null, count: number, unit: string, approx = false): HTMLElement {
  const row = el('div', 'metric');
  const left = el('div');
  left.append(el('div', 'metric-name', name), el('div', 'metric-count', `${fmt(count)} ${unit}`));
  const rankEl = el('span', `rank ${rank === null ? 'unranked' : medalClass(rank)}`, rankText(rank, approx));
  if (approx) rankEl.title = APPROX_NOTE;
  row.append(left, rankEl);
  return row;
}

function renderScopes(stats: StatsSnapshot | null, loading: boolean): void {
  const container = $('scopes');
  if (!stats) {
    container.replaceChildren(
      ...Object.values(SCOPE_LABELS).map((label) => {
        const card = el('div', 'scope skeleton');
        card.append(el('div', 'scope-label', label), el('div', 'scope-place', loading ? 'Loading…' : '—'));
        return card;
      }),
    );
    return;
  }
  container.replaceChildren(
    ...stats.scopes.map((s) => {
      const card = el('div', `scope${loading ? ' skeleton' : ''}`);
      const place = el('div', 'scope-place', s.placeName);
      if (s.parentName) place.append(el('span', 'scope-parent', `, ${s.parentName}`));
      place.title = placeLabel(s);
      card.append(
        el('div', 'scope-label', SCOPE_LABELS[s.scope]),
        place,
        metric('Species', s.speciesRank, s.speciesCount, 'species', s.speciesRankApprox),
        metric('Observations', s.observationRank, s.observationCount, 'obs'),
      );
      return card;
    }),
  );
  $('updated').textContent = `Ranks updated ${new Date(stats.computedAt).toLocaleString()}`;
}

function renderTiers(summary: Summary): void {
  const max = Math.max(1, ...Object.values(summary.byTier));
  $('tiers').replaceChildren(
    ...TIERS.map((t) => {
      const count = summary.byTier[t.label] ?? 0;
      const row = el('div', `tier-row ${t.className}`);
      const track = el('div', 'tier-track');
      const fill = el('div', 'tier-fill');
      fill.style.width = `${(count / max) * 100}%`;
      track.append(fill);
      row.append(el('span', 'tier-name', t.label), track, el('span', 'tier-count', fmt(count)));
      return row;
    }),
  );
}

// ---------- share card ----------

/** Inlines the avatar so the exported PNG doesn't depend on a cross-origin image. */
async function toDataUrl(url: string | null): Promise<string> {
  if (!url) return '';
  try {
    const blob = await (await fetch(url)).blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => resolve('');
      reader.readAsDataURL(blob);
    });
  } catch {
    return '';
  }
}

function cardRankCell(rank: number | null, count: number, approx = false): HTMLTableCellElement {
  const td = el('td');
  td.append(el('small', '', fmt(count)), el('span', medalClass(rank), rankText(rank, approx)));
  return td;
}

function renderCard(): void {
  const { user, summary, stats, avatarDataUrl } = state;
  const card = $('card');

  const head = el('div', 'card-head');
  const avatar = el('img', 'card-avatar');
  if (avatarDataUrl) avatar.src = avatarDataUrl;
  const who = el('div');
  who.append(el('div', 'card-name', user.name || user.login), el('div', 'card-login', `@${user.login}`));
  const logo = el('div', 'card-logo');
  logo.append('iNaturalist', el('b', '', 'GG'));
  head.append(avatar, who, logo);

  const totals = el('div', 'card-totals');
  for (const [value, label] of [
    [user.observationsCount, 'observations'],
    [user.speciesCount, 'species'],
    [summary.lifers, 'lifers'],
  ] as const) {
    const t = el('div', 'card-total');
    t.append(el('span', '', fmt(value)), el('small', '', label));
    totals.append(t);
  }

  const table = el('table', 'card-table');
  const header = el('tr');
  header.append(el('th', '', 'Leaderboard'), el('th', '', 'Species'), el('th', '', 'Observations'));
  table.append(header);
  for (const s of stats?.scopes ?? ([] as ScopeStats[])) {
    const tr = el('tr');
    tr.append(
      el('td', '', s.scope === 'world' ? 'Worldwide' : placeLabel(s)),
      cardRankCell(s.speciesRank, s.speciesCount, s.speciesRankApprox),
      cardRankCell(s.observationRank, s.observationCount),
    );
    table.append(tr);
  }

  const body = el('div', 'card-body');
  body.append(totals, table);

  const foot = el('div', 'card-foot');
  const tiers = el('div', 'card-tiers');
  for (const t of TIERS) {
    const count = summary.byTier[t.label];
    if (count) tiers.append(el('span', `card-tier ${t.className}`, `${fmt(count)} ${t.label}`));
  }
  foot.append(tiers, el('span', '', new Date().toLocaleDateString(undefined, { dateStyle: 'long' })));

  card.replaceChildren(head, body, foot);
}

function fitCard(): void {
  const frame = $('card-frame');
  const scale = frame.clientWidth / CARD_WIDTH;
  $('card').style.transform = `scale(${scale})`;
  frame.style.height = `${CARD_HEIGHT * scale}px`;
}

const exportOptions = () => ({
  width: CARD_WIDTH,
  height: CARD_HEIGHT,
  pixelRatio: 1,
  style: { transform: 'none' },
});

async function downloadPng(): Promise<void> {
  const dataUrl = await toPng($('card'), exportOptions());
  const a = el('a');
  a.href = dataUrl;
  a.download = `inaturalistgg-${state.user.login}.png`;
  a.click();
}

async function copyPng(button: HTMLButtonElement): Promise<void> {
  const blob = await toBlob($('card'), exportOptions());
  if (!blob) throw new Error('Could not render the card');
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  button.textContent = 'Copied!';
  setTimeout(() => (button.textContent = 'Copy image'), 1500);
}

// ---------- data loading ----------

async function loadStats(refresh: boolean): Promise<void> {
  const refreshBtn = $<HTMLButtonElement>('refresh');
  refreshBtn.disabled = true;
  renderScopes(state.stats, true);
  showMessage('Updating ranks… this takes about 20 seconds.');
  try {
    state.stats = await send('getStats', { refresh });
    // Ranks refresh the profile totals too.
    state.user = (await send('getUser', {})) ?? state.user;
    renderProfile(state.user, state.summary);
    showMessage(null);
  } catch (err) {
    showMessage(err instanceof Error ? err.message : String(err), true);
  } finally {
    refreshBtn.disabled = false;
    renderScopes(state.stats, false);
    renderCard();
  }
}

async function init(): Promise<void> {
  const user = await send('getUser', {});
  if (!user) {
    showMessage('Set your iNaturalist username in the iNaturalistGG popup first.');
    renderScopes(null, false);
    return;
  }
  const [summary, cached, avatarDataUrl] = await Promise.all([
    send('getSummary', {}),
    send('getStats', { cachedOnly: true }),
    toDataUrl(user.iconUrl),
  ]);
  state = { user, summary, stats: cached, avatarDataUrl };

  renderProfile(user, summary);
  renderTiers(summary);
  renderScopes(cached, false);
  renderCard();
  fitCard();
  new ResizeObserver(fitCard).observe($('card-frame'));

  $('refresh').addEventListener('click', () => void loadStats(true));
  $('download-png').addEventListener('click', () =>
    downloadPng().catch((e) => showMessage(`Export failed: ${e}`, true)),
  );
  const copyBtn = $<HTMLButtonElement>('copy-png');
  copyBtn.addEventListener('click', () => copyPng(copyBtn).catch((e) => showMessage(`Copy failed: ${e}`, true)));

  const stale = !cached || Date.now() - Date.parse(cached.computedAt) > STATS_MAX_AGE_MS;
  if (stale) await loadStats(false);
}

void init();
