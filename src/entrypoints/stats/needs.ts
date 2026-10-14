import type { NeedsItem } from '../../lib/explore';
import { seasonMonths } from '../../lib/explore';
import { send } from '../../lib/messages';
import { $, el, fillPlaceSelect, fmt, type PlaceOption } from './dom';

/** Quick filters by iconic taxon. */
const GROUPS: { label: string; taxonId?: number }[] = [
  { label: 'All' },
  { label: 'Birds', taxonId: 3 },
  { label: 'Plants', taxonId: 47126 },
  { label: 'Insects', taxonId: 47158 },
  { label: 'Fungi', taxonId: 47170 },
  { label: 'Mammals', taxonId: 40151 },
  { label: 'Reptiles', taxonId: 26036 },
  { label: 'Amphibians', taxonId: 20978 },
  { label: 'Ray-finned fishes', taxonId: 47178 },
  { label: 'Mollusks', taxonId: 47115 },
  { label: 'Arachnids', taxonId: 47119 },
];

let group = GROUPS[0];
let page = 1;
let loaded = 0;
/** Ignores responses from a query the user has since changed. */
let generation = 0;
let started = false;

function renderItem(item: NeedsItem, placeId: number): HTMLLIElement {
  const li = el('li', 'need');
  const img = el('img', 'need-photo');
  img.loading = 'lazy';
  img.alt = '';
  if (item.photoUrl) img.src = item.photoUrl;

  const names = el('div', 'need-names');
  const title = el('a', 'need-title', item.commonName || item.name);
  title.href = `https://www.inaturalist.org/taxa/${item.taxonId}`;
  title.target = '_blank';
  title.rel = 'noopener';
  names.append(title);
  if (item.commonName) names.append(el('i', 'need-sci', item.name));

  const where = el('a', 'need-count', `${fmt(item.count)} obs here`);
  where.href = `https://www.inaturalist.org/observations?place_id=${placeId}&taxon_id=${item.taxonId}&verifiable=true&subview=map`;
  where.target = '_blank';
  where.rel = 'noopener';
  where.title = 'See where it has been seen';

  li.append(img, names, where);
  return li;
}

async function load(reset: boolean): Promise<void> {
  const placeId = Number($<HTMLSelectElement>('needs-place').value);
  if (!placeId) return;
  const list = $('needs-list');
  const more = $<HTMLButtonElement>('needs-more');
  const summary = $('needs-summary');
  const mine = reset ? ++generation : generation;
  if (reset) {
    page = 1;
    loaded = 0;
    list.replaceChildren();
  }
  summary.textContent = 'Loading…';
  more.disabled = true;

  try {
    const months = $<HTMLInputElement>('needs-season').checked ? seasonMonths() : undefined;
    const res = await send('getNeeds', { placeId, taxonId: group.taxonId, months, page });
    if (mine !== generation) return;
    list.append(...res.items.map((item) => renderItem(item, placeId)));
    loaded += res.items.length;
    page++;
    summary.textContent = res.total
      ? `${fmt(res.total)} species you haven't seen yet`
      : 'Nothing left to find here. You’ve seen every species recorded!';
    more.hidden = loaded >= res.total;
  } catch (err) {
    if (mine === generation) summary.textContent = `Couldn't load needs: ${err instanceof Error ? err.message : err}`;
  } finally {
    more.disabled = false;
  }
}

function renderGroups(): void {
  $('needs-groups').replaceChildren(
    ...GROUPS.map((g) => {
      const chip = el('button', `chip${g === group ? ' active' : ''}`, g.label);
      chip.type = 'button';
      chip.setAttribute('aria-pressed', String(g === group));
      chip.addEventListener('click', () => {
        group = g;
        renderGroups();
        void load(true);
      });
      return chip;
    }),
  );
}

/** Called whenever the home places are known (or change after a ranks refresh). */
export function setNeedsPlaces(places: PlaceOption[]): void {
  const select = $<HTMLSelectElement>('needs-place');
  const before = select.value;
  fillPlaceSelect(select, places, 'district');
  // The tab may have opened before places were known; load once they are.
  if (started && select.value !== before) void load(true);
}

/** Loads lazily the first time the tab is opened. */
export function showNeeds(): void {
  if (started) return;
  started = true;
  renderGroups();
  $('needs-place').addEventListener('change', () => void load(true));
  $('needs-season').addEventListener('change', () => void load(true));
  $('needs-more').addEventListener('click', () => void load(false));
  void load(true);
}
