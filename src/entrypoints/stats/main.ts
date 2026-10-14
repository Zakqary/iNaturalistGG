import { toBlob, toPng } from 'html-to-image';
import { browser } from 'wxt/browser';
import { send, type BadgeView, type PioneerView } from '../../lib/messages';
import { capitalize, TIERS } from '../../lib/ranks';
import { SCOPE_LABELS, STATS_MAX_AGE_MS } from '../../lib/stats';
import type { BadgeStatus, PioneerLevel, PioneerStatus, ScopeStats, StatsSnapshot, UserMeta } from '../../lib/types';
import { $, el, fmt, type PlaceOption } from './dom';
import { setTreePlaces, showLifeList } from './lifelist';
import { setNeedsPlaces, showNeeds } from './needs';

const CARD_WIDTH = 1200;
const CARD_HEIGHT = 630;
const CARD_MAX_BADGES = 3;
const BADGE_REFRESH_THROTTLE_MS = 3000;

type Summary = Awaited<ReturnType<typeof send<'getSummary'>>>;

const rankText = (rank: number | null, approx = false) =>
  rank === null ? 'Unranked' : `${approx ? '≈' : ''}#${fmt(rank)}`;
const APPROX_NOTE =
  'Estimated: iNaturalist can’t compute the worldwide species leaderboard, so this ranks the top 500 observers by their profile species totals.';
const placeLabel = (s: ScopeStats) => (s.parentName ? `${s.placeName}, ${s.parentName}` : s.placeName);
const medalClass = (rank: number | null) => (rank !== null && rank <= 3 ? `medal-${rank}` : '');

function showMessage(text: string | null, isError = false): void {
  const msg = $('message');
  msg.hidden = !text;
  msg.textContent = text ?? '';
  msg.classList.toggle('error', isError);
}

let state: {
  user: UserMeta;
  summary: Summary;
  stats: StatsSnapshot | null;
  avatarDataUrl: string;
  badges: BadgeView[];
  pioneers: PioneerView[];
};

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

// ---------- badges ----------

/** A drawn medal (the 🥇 emoji renders copper-ish on Windows, and can't be recoloured). */
function medalIcon(rank: number, className: string): HTMLElement {
  const medal = el('span', `medal-icon medal-icon-${rank} ${className}`, String(rank));
  medal.setAttribute('aria-hidden', 'true');
  return medal;
}
const metricLabel = (b: BadgeView) => (b.metric === 'species' ? 'species' : 'observations');
const badgeTaxon = (b: BadgeView) => (b.commonName ? `${b.taxonName} (${b.commonName})` : b.taxonName);

/** Best placings first, then bigger groups (class beats order at the same rank). */
function sortBadges(badges: BadgeView[]): BadgeView[] {
  return [...badges].sort((a, b) => a.rank - b.rank || b.taxonRankLevel - a.taxonRankLevel || b.count - a.count);
}

function renderBadges(badges: BadgeView[], status: BadgeStatus | null): void {
  const current = sortBadges(badges.filter((b) => b.current));
  const former = badges.filter((b) => !b.current).sort((a, b) => (b.lostAt ?? '').localeCompare(a.lostAt ?? ''));

  const statusEl = $('badge-status');
  const progress = $<HTMLProgressElement>('badge-progress');
  const checkBtn = $<HTMLButtonElement>('check-badges');
  progress.hidden = !status?.running;
  checkBtn.disabled = !!status?.running;
  if (status?.running) {
    statusEl.textContent = `Checking worldwide leaderboards… ${fmt(status.checked)} / ${fmt(status.total)} groups`;
    progress.max = Math.max(status.total, 1);
    progress.value = status.checked;
  } else if (status?.error) {
    statusEl.textContent = `Last check failed: ${status.error}`;
  } else if (status?.completedAt) {
    statusEl.textContent = `Checked ${fmt(status.total)} groups · ${new Date(status.completedAt).toLocaleString()}`;
  } else {
    statusEl.textContent = 'Not checked yet. Badges are checked automatically after a sync.';
  }

  const grid = $('badges');
  if (!current.length) {
    grid.replaceChildren(
      el(
        'p',
        'muted empty',
        status?.completedAt
          ? 'No badges yet. Be in the worldwide top 3 for any order (or bigger group) to earn one.'
          : 'No badges yet.',
      ),
    );
  } else {
    grid.replaceChildren(
      ...current.map((b) => {
        const card = el('div', `badge medal-${b.rank}`);
        const medal = medalIcon(b.rank, 'badge-medal');
        const info = el('div', 'badge-info');
        info.append(
          el('div', 'badge-taxon', b.taxonName),
          el('div', 'badge-meta', `#${b.rank} · ${capitalize(b.taxonRank)} · ${fmt(b.count)} ${metricLabel(b)}`),
        );
        card.append(medal, info);
        card.title =
          `${badgeTaxon(b)}: #${b.rank} worldwide by ${metricLabel(b)}` +
          ` · since ${new Date(b.firstEarnedAt).toLocaleDateString()}` +
          (b.bestRank < b.rank ? ` · best #${b.bestRank}` : '');
        return card;
      }),
    );
  }

  const formerSection = $<HTMLDetailsElement>('former-badges');
  formerSection.hidden = !former.length;
  $('former-count').textContent = String(former.length);
  $('former-list').replaceChildren(
    ...former.map((b) =>
      el(
        'li',
        '',
        `Former #${b.bestRank} in ${badgeTaxon(b)} by ${metricLabel(b)}` +
          (b.lostAt ? ` · until ${new Date(b.lostAt).toLocaleDateString()}` : ''),
      ),
    ),
  );
}

async function loadBadges(): Promise<void> {
  const { badges, status } = await send('getBadges', {});
  state.badges = badges;
  renderBadges(badges, status);
  renderCard();
}

let badgeRefreshTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleBadgeRefresh(): void {
  badgeRefreshTimer ??= setTimeout(() => {
    badgeRefreshTimer = undefined;
    void loadBadges();
  }, BADGE_REFRESH_THROTTLE_MS);
}

// ---------- pioneers ----------

const PIONEER_ORDER: PioneerLevel[] = ['country', 'territory', 'district'];
const PIONEER_LABELS: Record<PioneerLevel, string> = { country: 'Country', territory: 'Territory', district: 'District' };

function renderPioneers(pioneers: PioneerView[], status: PioneerStatus | null): void {
  const statusEl = $('pioneer-status');
  const progress = $<HTMLProgressElement>('pioneer-progress');
  const button = $<HTMLButtonElement>('check-pioneers');
  progress.hidden = !status?.running;
  button.disabled = !!status?.running;
  if (!status) {
    statusEl.textContent = 'Not checked yet. The first batch starts after your next sync.';
  } else if (status.running) {
    statusEl.textContent = `Checking… ${fmt(status.checked)} / ${fmt(status.total)} this batch, ${fmt(status.remaining)} species to go.`;
    progress.max = Math.max(status.total, 1);
    progress.value = status.checked;
  } else if (status.error) {
    statusEl.textContent = `Last check failed: ${status.error}`;
  } else {
    statusEl.textContent = status.remaining
      ? `${fmt(status.species - status.remaining)} of ${fmt(status.species)} species checked; the rest follow in later batches.`
      : `All ${fmt(status.species)} species checked.`;
  }

  const counts = $('pioneer-counts');
  counts.replaceChildren(
    ...PIONEER_ORDER.map((level) => {
      const box = el('div', `pioneer-count pioneer-${level}`);
      box.append(
        el('span', '', fmt(pioneers.filter((p) => p.level === level).length)),
        el('small', '', `${PIONEER_LABELS[level]} firsts`),
      );
      return box;
    }),
  );

  const sorted = [...pioneers].sort(
    (a, b) =>
      PIONEER_ORDER.indexOf(a.level!) - PIONEER_ORDER.indexOf(b.level!) || b.observedOn.localeCompare(a.observedOn),
  );
  $('pioneer-list').replaceChildren(
    ...sorted.map((p) => {
      const li = el('li', 'pioneer');
      const link = el('a', 'pioneer-name', p.commonName || p.speciesName);
      link.href = `https://www.inaturalist.org/observations/${p.obsId}`;
      link.target = '_blank';
      link.rel = 'noopener';
      const names = el('div', 'pioneer-names');
      names.append(link);
      if (p.commonName) names.append(el('i', 'muted', p.speciesName));
      li.append(
        el('span', `pioneer-level pioneer-${p.level}`, PIONEER_LABELS[p.level!]),
        names,
        el('span', 'pioneer-where muted', `${p.placeName} · ${new Date(`${p.observedOn}T00:00:00`).toLocaleDateString()}`),
      );
      return li;
    }),
  );
}

async function loadPioneers(): Promise<void> {
  const { pioneers, status } = await send('getPioneers', {});
  state.pioneers = pioneers;
  renderPioneers(pioneers, status);
  renderCard();
}

let pioneerRefreshTimer: ReturnType<typeof setTimeout> | undefined;
function schedulePioneerRefresh(): void {
  pioneerRefreshTimer ??= setTimeout(() => {
    pioneerRefreshTimer = undefined;
    void loadPioneers();
  }, BADGE_REFRESH_THROTTLE_MS);
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

  const badgeRow = el('div', 'card-badges');
  for (const b of sortBadges(state.badges.filter((x) => x.current)).slice(0, CARD_MAX_BADGES)) {
    const chip = el('div', `card-badge medal-${b.rank}`);
    chip.append(
      medalIcon(b.rank, 'card-badge-medal'),
      el('span', '', `#${b.rank} ${b.taxonName}`),
      el('small', '', `world · ${metricLabel(b)}`),
    );
    badgeRow.append(chip);
  }

  const foot = el('div', 'card-foot');
  const tiers = el('div', 'card-tiers');
  for (const t of TIERS) {
    const count = summary.byTier[t.label];
    if (count) tiers.append(el('span', `card-tier ${t.className}`, `${fmt(count)} ${t.label}`));
  }
  const badgeTotal = state.badges.filter((b) => b.current).length;
  if (badgeTotal) tiers.append(el('span', 'card-tier card-badge-total', `${fmt(badgeTotal)} ${badgeTotal === 1 ? 'Badge' : 'Badges'}`));
  if (state.pioneers.length) tiers.append(el('span', 'card-tier card-pioneer', `${fmt(state.pioneers.length)} Pioneer`));
  foot.append(tiers, el('span', '', new Date().toLocaleDateString(undefined, { dateStyle: 'long' })));

  card.replaceChildren(head, body, ...(badgeRow.childElementCount ? [badgeRow] : []), foot);
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

// ---------- tabs ----------

const TABS = ['stats', 'needs', 'lifelist'] as const;
type Tab = (typeof TABS)[number];

function showTab(): void {
  const hash = location.hash.slice(1);
  const tab: Tab = (TABS as readonly string[]).includes(hash) ? (hash as Tab) : 'stats';
  document.querySelectorAll<HTMLElement>('[data-tab]').forEach((node) => (node.hidden = node.dataset.tab !== tab));
  document.querySelectorAll<HTMLAnchorElement>('[data-tab-link]').forEach((a) => {
    if (a.dataset.tabLink === tab) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  if (tab === 'needs') showNeeds();
  if (tab === 'lifelist') showLifeList();
}

/** Your home places (not worldwide) for the Needs and Life list pickers. */
function updatePlacePickers(stats: StatsSnapshot | null): void {
  const places: PlaceOption[] = (stats?.scopes ?? [])
    .filter((s) => s.placeId !== null)
    .map((s) => ({ id: s.placeId!, scope: s.scope, label: `${placeLabel(s)} (${SCOPE_LABELS[s.scope]})` }));
  setNeedsPlaces(places);
  setTreePlaces(places);
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
    updatePlacePickers(state.stats);
    renderCard();
  }
}

async function init(): Promise<void> {
  const user = await send('getUser', {});
  window.addEventListener('hashchange', showTab);
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
  state = { user, summary, stats: cached, avatarDataUrl, badges: [], pioneers: [] };

  renderProfile(user, summary);
  renderTiers(summary);
  renderScopes(cached, false);
  updatePlacePickers(cached);
  showTab();
  renderCard();
  fitCard();
  new ResizeObserver(fitCard).observe($('card-frame'));
  await Promise.all([loadBadges(), loadPioneers()]);
  browser.storage.onChanged.addListener((changes) => {
    if (changes.badgeStatus) scheduleBadgeRefresh();
    if (changes.pioneerStatus) schedulePioneerRefresh();
  });
  $('check-pioneers').addEventListener('click', () =>
    send('checkPioneers', {}).catch((e) => showMessage(e instanceof Error ? e.message : String(e), true)),
  );
  $('check-badges').addEventListener('click', () =>
    send('checkBadges', {}).catch((e) => showMessage(e instanceof Error ? e.message : String(e), true)),
  );

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
