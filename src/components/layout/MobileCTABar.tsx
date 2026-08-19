import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

/**
 * Persistent bottom call-to-action for mobile.
 *
 * 90% of traffic is mobile, and the homepage is ~15 phone-screens tall with no
 * always-visible CTA once the hero scrolls off. This keeps "Get Pre-Approved"
 * (and a tap-to-call) in reach the entire way down. Hidden on lg+ where the
 * sticky top nav already carries a CTA. Reveals only after the hero passes, so
 * it doesn't double up with the hero's own button.
 */
export default function MobileCTABar() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    // Reveal once scrolled past roughly the hero. Using scroll position keeps
    // this self-contained (no ref wiring into the page).
    const onScroll = () => {
      const y = window.scrollY || document.documentElement.scrollTop || 0;
      setShow(y > 600);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div
      className={`fixed bottom-0 left-0 right-0 z-40 lg:hidden transition-transform duration-300 ${
        show ? 'translate-y-0' : 'translate-y-full'
      }`}
    >
      <div className="bg-white/95 backdrop-blur-md border-t border-slate-200 shadow-[0_-8px_30px_rgba(0,0,0,0.06)] px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <Link
          to="/apply-now"
          className="block w-full h-12 rounded-xl bg-brand-secondary text-white font-bold text-base flex items-center justify-center active:scale-[0.98] transition-transform"
        >
          Get Pre-Approved
        </Link>
        <p className="text-center text-[11px] text-slate-400 mt-1.5">
          ⚡ 60-second form · no obligation
        </p>
      </div>
    </div>
  );
}
