import React from 'react';

// Elfsight All-in-One Reviews (real 5-star Google + Facebook reviews, auto-synced).
// Lazy: the platform.js script is injected only when the section nears the viewport,
// so the third-party widget can never slow down first paint. The widget renders in
// a shadow DOM — page innerText won't see its content.
export default function ElfsightReviews() {
  const holder = React.useRef<HTMLDivElement>(null);
  const [load, setLoad] = React.useState(false);
  React.useEffect(() => {
    const el = holder.current;
    if (!el) return;
    const obs = new IntersectionObserver((entries) => {
      if (entries.some(e => e.isIntersecting)) {
        setLoad(true);
        obs.disconnect();
      }
    }, { rootMargin: '600px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  React.useEffect(() => {
    if (!load) return;
    if (!document.querySelector('script[src="https://elfsightcdn.com/platform.js"]')) {
      const s = document.createElement('script');
      s.src = 'https://elfsightcdn.com/platform.js';
      s.async = true;
      document.body.appendChild(s);
    }
  }, [load]);
  return (
    <div ref={holder} className="min-h-[400px]">
      {load && <div className="elfsight-app-9db6caed-1e35-4f55-9a80-5843a9e10e19" data-elfsight-app-lazy />}
    </div>
  );
}
