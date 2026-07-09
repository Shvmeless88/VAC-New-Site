import ReactPixel from 'react-facebook-pixel';

const PIXEL_ID = import.meta.env.VITE_FB_PIXEL_ID;

export const initPixel = () => {
  if (typeof window !== 'undefined') {
    if (PIXEL_ID) {
      console.log("[PIXEL] Initializing with ID:", PIXEL_ID);
      ReactPixel.init(PIXEL_ID, undefined, {
        autoConfig: true,
        debug: false,
      });
      ReactPixel.pageView();
    } else {
      console.warn("[PIXEL] No Pixel ID found in VITE_FB_PIXEL_ID environment variable.");
    }
  }
};

export const trackPixelEvent = (event: string, data?: any) => {
  if (typeof window !== 'undefined' && PIXEL_ID) {
    try {
      ReactPixel.track(event, data);
    } catch (e) {
      console.error("[PIXEL] Error tracking event:", e);
    }
  }
};

export const trackCustomEvent = (event: string, data?: any) => {
  if (typeof window !== 'undefined' && PIXEL_ID) {
    try {
      ReactPixel.trackCustom(event, data);
    } catch (e) {
      console.error("[PIXEL] Error tracking custom event:", e);
    }
  }
};
