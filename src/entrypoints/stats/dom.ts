export const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export const fmt = (n: number) => n.toLocaleString();

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export interface PlaceOption {
  id: number;
  label: string;
  scope: string;
}

/** Fills a place <select>, keeping the current choice if it's still offered. */
export function fillPlaceSelect(select: HTMLSelectElement, places: PlaceOption[], preferredScope: string): void {
  const previous = select.value;
  select.replaceChildren(
    ...places.map((p) => {
      const option = el('option', '', p.label);
      option.value = String(p.id);
      return option;
    }),
  );
  const keep = places.find((p) => String(p.id) === previous);
  const preferred = places.find((p) => p.scope === preferredScope) ?? places[0];
  const chosen = keep ?? preferred;
  if (chosen) select.value = String(chosen.id);
}
