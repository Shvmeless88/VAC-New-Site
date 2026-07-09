
export const captureUtms = () => {
  if (typeof window === 'undefined') return;

  const urlParams = new URLSearchParams(window.location.search);
  const utms: Record<string, string> = {};

  ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].forEach(param => {
    const value = urlParams.get(param);
    if (value) {
      utms[param] = value;
    }
  });

  if (Object.keys(utms).length > 0) {
    // If we have new UTMs, store them. 
    // We use sessionStorage so the source persists during the browsing session.
    const existing = JSON.parse(sessionStorage.getItem('vac_utms') || '{}');
    const updated = { ...existing, ...utms };
    sessionStorage.setItem('vac_utms', JSON.stringify(updated));
  }
};

export const getStoredUtms = () => {
  if (typeof window === 'undefined') return {};
  return JSON.parse(sessionStorage.getItem('vac_utms') || '{}');
};
