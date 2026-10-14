import type { CompletionInfo, TreeNode } from '../../lib/explore';
import { send } from '../../lib/messages';
import { capitalize } from '../../lib/ranks';
import { $, el, fillPlaceSelect, fmt, type PlaceOption } from './dom';

let started = false;
let generation = 0;
let children = new Map<number | null, TreeNode[]>();
const completions = new Map<number, CompletionInfo>();

function placeId(): number {
  return Number($<HTMLSelectElement>('tree-place').value);
}

async function fetchCompletion(nodes: TreeNode[]): Promise<void> {
  const missing = nodes.filter((n) => !completions.has(n.id)).map((n) => n.id);
  if (!missing.length) return;
  const res = await send('getCompletion', { placeId: placeId(), taxonIds: missing });
  for (const [id, info] of Object.entries(res)) completions.set(Number(id), info);
}

function row(node: TreeNode, depth: number): HTMLElement {
  const wrap = el('div', 'tree-item');
  wrap.setAttribute('role', 'treeitem');
  const line = el('div', 'tree-row');
  line.style.paddingLeft = `${depth * 20}px`;

  const kids = children.get(node.id) ?? [];
  const toggle = el('button', 'tree-toggle', kids.length ? '▸' : '');
  toggle.type = 'button';
  toggle.disabled = !kids.length;
  toggle.setAttribute('aria-label', `Expand ${node.name}`);

  const info = completions.get(node.id);
  const name = el('div', 'tree-name');
  name.append(el('span', 'tree-rank', capitalize(node.rank)), el('span', 'tree-sci', node.name));
  const common = info?.commonName ?? node.commonName;
  if (common) name.append(el('span', 'tree-common', common));

  const total = info?.total;
  const pct = total ? Math.min(100, (node.userSpecies / total) * 100) : 0;
  const bar = el('div', 'tree-bar');
  const fill = el('div', 'tree-fill');
  fill.style.width = `${pct}%`;
  bar.append(fill);
  const count = el(
    'span',
    'tree-count',
    total === undefined ? `${fmt(node.userSpecies)} / …` : `${fmt(node.userSpecies)} / ${fmt(total)} · ${pct.toFixed(pct < 10 && pct > 0 ? 1 : 0)}%`,
  );

  line.append(toggle, name, bar, count);
  const body = el('div', 'tree-children');
  body.hidden = true;
  wrap.append(line, body);

  toggle.addEventListener('click', async () => {
    const open = body.hidden;
    toggle.textContent = open ? '▾' : '▸';
    toggle.setAttribute('aria-expanded', String(open));
    body.hidden = !open;
    if (!open || body.childElementCount) return;
    body.append(el('div', 'tree-loading muted', 'Loading…'));
    const mine = generation;
    await fetchCompletion(kids).catch(() => undefined);
    if (mine !== generation) return;
    body.replaceChildren(...kids.map((k) => row(k, depth + 1)));
  });
  return wrap;
}

async function load(): Promise<void> {
  const tree = $('tree');
  const mine = ++generation;
  completions.clear();
  tree.replaceChildren(el('p', 'muted', 'Loading your life list…'));
  try {
    const nodes = await send('getLifeTree', { placeId: placeId() });
    if (mine !== generation) return;
    children = new Map();
    for (const n of nodes) {
      const list = children.get(n.parentId) ?? [];
      list.push(n);
      children.set(n.parentId, list);
    }
    for (const list of children.values()) list.sort((a, b) => b.userSpecies - a.userSpecies || a.name.localeCompare(b.name));
    const roots = children.get(null) ?? [];
    await fetchCompletion(roots).catch(() => undefined);
    if (mine !== generation) return;
    tree.replaceChildren(...(roots.length ? roots.map((r) => row(r, 0)) : [el('p', 'muted', 'Sync first to build your life list.')]));
  } catch (err) {
    if (mine === generation) tree.replaceChildren(el('p', 'error', `Couldn't load: ${err instanceof Error ? err.message : err}`));
  }
}

export function setTreePlaces(places: PlaceOption[]): void {
  const select = $<HTMLSelectElement>('tree-place');
  const before = select.value;
  fillPlaceSelect(select, places, 'territory');
  // The tab may have opened before places were known; load once they are.
  if (started && select.value !== before) void load();
}

export function showLifeList(): void {
  if (started) return;
  started = true;
  $('tree-place').addEventListener('change', () => void load());
  void load();
}
