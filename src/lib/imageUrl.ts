/**
 * Image URL helpers.
 *
 * Vehicle photos are hosted on Sirv, which resizes on the fly from query params
 * and already negotiates AVIF/WebP from the Accept header. We were requesting
 * the full 1920px original for a card displayed at ~308px — roughly 6x more
 * pixels across than needed, on phones, over mobile data.
 *
 * Firebase Storage (delivery photos, hero) has NO on-the-fly resizing — it
 * serves whatever bytes were uploaded. Those have to be shrunk at upload time
 * instead; see `compressImage`.
 */

/** Ask Sirv for a given render width. No-op for non-Sirv URLs. */
export function sirvResize(url: string | undefined, width: number, quality = 80): string {
  if (!url || !url.includes('sirv.com')) return url || '';
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}w=${width}&q=${quality}`;
}

/**
 * Build a responsive srcset so a phone downloads a phone-sized image and a
 * desktop downloads a desktop-sized one. Returns undefined for non-Sirv URLs so
 * the caller can fall back to a plain src.
 */
export function sirvSrcSet(
  url: string | undefined,
  widths: number[] = [400, 600, 800, 1200]
): string | undefined {
  if (!url || !url.includes('sirv.com')) return undefined;
  return widths.map((w) => `${sirvResize(url, w)} ${w}w`).join(', ');
}
