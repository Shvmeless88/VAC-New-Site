
export const captureUtms = () => {
  if (typeof window === 'undefined') return;

  const urlParams = new URLSearchParams(window.location.search);
  const utms: Record<string, string> = {};

  // Campaign params + ad-click identifiers: gclid (Google Ads), fbclid (Meta),
  // msclkid (Microsoft). Stored with every lead so buyers can tie a sale back
  // to the exact ad click.
  ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid', 'fbclid', 'msclkid'].forEach(param => {
    const value = urlParams.get(param);
    if (value) {
      utms[param] = value;
    }
  });

  if (Object.keys(utms).length > 0) {
    // If we have new UTMs, store them.
    // We use sessionStorage so the source persists during the browsing session.
    const existing = JSON.parse(sessionStorage.getItem('vac_utms') || '{}');
    // Record where the click first landed once — useful attribution for buyers.
    if (!existing.landing_page) {
      existing.landing_page = window.location.pathname + window.location.search;
      existing.landing_referrer = document.referrer || '';
      existing.first_seen = new Date().toISOString();
    }
    const updated = { ...existing, ...utms };
    sessionStorage.setItem('vac_utms', JSON.stringify(updated));
  }
};

export const getStoredUtms = () => {
  if (typeof window === 'undefined') return {};
  return JSON.parse(sessionStorage.getItem('vac_utms') || '{}');
};
