import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { send, type LiferInfo, type LiferTaxon } from '../../lib/messages';
import { capitalize, MAJOR_RANK_LEVELS, tierFor } from '../../lib/ranks';
import { DETAIL_BANNER_AFTER_SELECTORS, isThumbnailLink, obsIdFromHref, OBS_PATH_RE } from './selectors';
import './style.css';

const SCAN_DEBOUNCE_MS = 250;
const PIONEER_LABELS = { district: 'District', territory: 'Territory', country: 'Country' } as const;
const LOOKUP_CHUNK = 100;
const MAX_MINOR_TAXA_SHOWN = 4;

export default defineContentScript({
  matches: ['https://www.inaturalist.org/*', 'https://inaturalist.org/*'],
  runAt: 'document_idle',
  main(ctx) {
    /** obsId → lifer info, or null when that observation isn't a lifer (or not ours). */
    const cache = new Map<number, LiferInfo | null>();
    const tooltip = createTooltip();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void scan(), SCAN_DEBOUNCE_MS);
    };

    async function scan(): Promise<void> {
      const anchorsById = new Map<number, HTMLAnchorElement[]>();
      for (const a of document.querySelectorAll<HTMLAnchorElement>('a[href*="/observations/"]')) {
        if (a.closest('.igg-root')) continue;
        const id = obsIdFromHref(a);
        if (id === null) continue;
        const list = anchorsById.get(id) ?? [];
        list.push(a);
        anchorsById.set(id, list);
      }
      const detailMatch = OBS_PATH_RE.exec(location.pathname);
      const detailId = detailMatch ? Number(detailMatch[1]) : null;

      const wanted = [...anchorsById.keys()];
      if (detailId !== null) wanted.push(detailId);
      await lookup(wanted.filter((id) => !cache.has(id)));
      if (ctx.isInvalid) return;

      for (const [id, anchors] of anchorsById) {
        const info = cache.get(id);
        if (info) decorateLinks(anchors, info);
      }
      renderDetailBanner(detailId === null ? null : (cache.get(detailId) ?? null));
    }

    async function lookup(ids: number[]): Promise<void> {
      for (let i = 0; i < ids.length; i += LOOKUP_CHUNK) {
        const chunk = ids.slice(i, i + LOOKUP_CHUNK);
        try {
          const found = await send('getLifers', { obsIds: chunk });
          for (const id of chunk) cache.set(id, found[id] ?? null);
        } catch (err) {
          console.warn('[iNaturalistGG] lifer lookup failed', err);
          return;
        }
      }
    }

    function decorateLinks(anchors: HTMLAnchorElement[], info: LiferInfo): void {
      const thumbs = anchors.filter(isThumbnailLink);
      if (thumbs.length) {
        for (const a of thumbs) {
          if (a.querySelector(':scope > .igg-chips')) continue;
          if (getComputedStyle(a).position === 'static') a.style.position = 'relative';
          a.append(makeChips(info, 'overlay'));
        }
        return;
      }
      // Text-only views (e.g. list/table): one inline chip after the first link.
      const first = anchors[0];
      if (first.nextElementSibling?.classList.contains('igg-chips')) return;
      first.after(makeChips(info, 'inline'));
    }

    function renderDetailBanner(info: LiferInfo | null): void {
      const existing = document.querySelector<HTMLElement>('.igg-banner');
      if (existing && (!info || existing.dataset.obsId !== String(info.obsId))) existing.remove();
      if (!info || document.querySelector('.igg-banner')) return;

      // iNat renders the page after load; if the title isn't there yet, the next scan will retry.
      const anchor = DETAIL_BANNER_AFTER_SELECTORS.map((s) => document.querySelector(s)).find((el) => !!el);
      if (!anchor) return;
      const banner = document.createElement('div');
      banner.className = 'igg-root igg-banner';
      banner.dataset.obsId = String(info.obsId);
      banner.append(makeChips(info, 'inline'));
      const parts: string[] = [];
      const firsts = info.taxa.filter((t) => MAJOR_RANK_LEVELS.has(t.rankLevel));
      if (firsts.length) parts.push(`First ${firsts.map((t) => `${t.rank} ${t.name}`).join(' · ')}`);
      if (info.pioneer) parts.push(`First iNat record of this species in ${info.pioneer.placeName}`);
      const text = document.createElement('span');
      text.className = 'igg-banner-text';
      text.textContent = parts.join(' — ');
      banner.append(text);
      anchor.after(banner);
    }

    /** The LIFER chip and/or PIONEER chip for an observation, stacked together. */
    function makeChips(info: LiferInfo, mode: 'overlay' | 'inline'): HTMLElement {
      const group = document.createElement('span');
      group.className = `igg-root igg-chips igg-chips-${mode}`;

      if (info.taxa.length) {
        const tier = tierFor(info.topRankLevel);
        const chip = document.createElement('span');
        chip.className = `igg-chip ${tier.className}`;
        chip.textContent = info.topRankLevel >= 20 ? `LIFER · ${tier.label}` : 'LIFER';
        chip.addEventListener('mouseenter', () => tooltip.show(chip, info));
        chip.addEventListener('mouseleave', () => tooltip.hide());
        group.append(chip);
      }
      if (info.pioneer) {
        const { level, placeName } = info.pioneer;
        const chip = document.createElement('span');
        chip.className = 'igg-chip igg-pioneer';
        chip.textContent = `PIONEER · ${PIONEER_LABELS[level]}`;
        chip.addEventListener('mouseenter', () =>
          tooltip.showText(chip, 'Pioneer', `The first iNaturalist record of this species in ${placeName}.`),
        );
        chip.addEventListener('mouseleave', () => tooltip.hide());
        group.append(chip);
      }
      return group;
    }

    // Forget cached answers once a sync or pioneer check finishes, so new results show up.
    const onStorage = (changes: Record<string, { newValue?: unknown }>) => {
      const status = changes.syncStatus?.newValue as { phase?: string } | undefined;
      const pioneers = changes.pioneerStatus?.newValue as { running?: boolean } | undefined;
      if (status?.phase === 'idle' || pioneers?.running === false) {
        cache.clear();
        // Redraw so existing chips pick up new results (e.g. a lifer that's now also a pioneer).
        document.querySelectorAll('.igg-chips, .igg-banner').forEach((node) => node.remove());
        schedule();
      }
    };
    browser.storage.onChanged.addListener(onStorage);
    ctx.onInvalidated(() => browser.storage.onChanged.removeListener(onStorage));

    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    ctx.onInvalidated(() => {
      observer.disconnect();
      clearTimeout(timer);
      document.querySelectorAll('.igg-root').forEach((el) => el.remove());
    });
    schedule();
  },
});

function describe(t: LiferTaxon): string {
  return t.commonName ? `${t.name} (${t.commonName})` : t.name;
}

function createTooltip() {
  const el = document.createElement('div');
  el.className = 'igg-root igg-tooltip';
  el.hidden = true;
  document.body.append(el);

  function place(anchor: HTMLElement) {
    el.hidden = false;
    const r = anchor.getBoundingClientRect();
    const tip = el.getBoundingClientRect();
    const left = Math.min(Math.max(8, r.left), window.innerWidth - tip.width - 8);
    const top = r.bottom + tip.height + 6 > window.innerHeight ? r.top - tip.height - 6 : r.bottom + 6;
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }

  return {
    showText(anchor: HTMLElement, heading: string, body: string) {
      const h = document.createElement('div');
      h.className = 'igg-tooltip-heading';
      h.textContent = heading;
      const p = document.createElement('div');
      p.textContent = body;
      el.replaceChildren(h, p);
      place(anchor);
    },
    show(anchor: HTMLElement, info: LiferInfo) {
      el.replaceChildren();
      const heading = document.createElement('div');
      heading.className = 'igg-tooltip-heading';
      heading.textContent = `Your first observation of ${info.taxa.length} group${info.taxa.length === 1 ? '' : 's'}`;
      el.append(heading);

      const major = info.taxa.filter((t) => MAJOR_RANK_LEVELS.has(t.rankLevel));
      const minor = info.taxa.filter((t) => !MAJOR_RANK_LEVELS.has(t.rankLevel));
      const rows = [...major, ...minor.slice(0, MAX_MINOR_TAXA_SHOWN)].sort((a, b) => b.rankLevel - a.rankLevel);
      for (const t of rows) {
        const row = document.createElement('div');
        row.className = `igg-tooltip-row ${tierFor(t.rankLevel).className}`;
        const rank = document.createElement('span');
        rank.className = 'igg-tooltip-rank';
        rank.textContent = capitalize(t.rank);
        const name = document.createElement('span');
        name.textContent = describe(t);
        row.append(rank, name);
        el.append(row);
      }
      if (minor.length > MAX_MINOR_TAXA_SHOWN) {
        const more = document.createElement('div');
        more.className = 'igg-tooltip-more';
        more.textContent = `+${minor.length - MAX_MINOR_TAXA_SHOWN} more minor ranks`;
        el.append(more);
      }

      place(anchor);
    },
    hide() {
      el.hidden = true;
    },
  };
}
