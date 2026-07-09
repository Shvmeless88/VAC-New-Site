import TagManager from 'react-gtm-module';

const GTM_ID = import.meta.env.VITE_GTM_ID;

export const initGTM = () => {
  // GTM is now initialized manually in index.html as per recent request.
  // We keep this function as a placeholder if App.tsx calls it, 
  // but we don't need to call TagManager.initialize() anymore.
  if (typeof window !== 'undefined') {
    console.log("[GTM] Handled via index.html manual script.");
  }
};

export const trackGTMEvent = (event: string, data?: any) => {
  if (typeof window !== 'undefined' && GTM_ID) {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({
      event: event,
      ...data
    });
  }
};

declare global {
  interface Window {
    dataLayer: any[];
  }
}
