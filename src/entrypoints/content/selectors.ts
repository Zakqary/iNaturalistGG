/**
 * Everything that depends on iNaturalist's page markup lives here, so a site
 * redesign only means updating this file.
 */

/** Pathname of a single observation page or link. */
export const OBS_PATH_RE = /^\/observations\/(\d+)\/?$/;

/** Where to put the lifer banner on an observation's own page, most specific first. */
export const DETAIL_TITLE_SELECTORS = ['.ObservationTitle', '.obs-title', '#ObservationShow h1', 'h1'];

/** Classes that mark a link as a photo thumbnail rather than a text link. */
export const THUMBNAIL_HINT_RE = /photo|thumb|image|img/i;

export function obsIdFromHref(a: HTMLAnchorElement): number | null {
  if (!a.hostname.endsWith('inaturalist.org')) return null;
  const m = OBS_PATH_RE.exec(a.pathname);
  return m ? Number(m[1]) : null;
}

/** True when the link is (or wraps) a photo, so a chip can float over it. */
export function isThumbnailLink(a: HTMLAnchorElement): boolean {
  if (a.querySelector('img')) return true;
  if (THUMBNAIL_HINT_RE.test(a.className)) return true;
  return getComputedStyle(a).backgroundImage !== 'none';
}
