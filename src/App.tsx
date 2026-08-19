import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import React, { useEffect } from 'react';
import Navbar from '@/components/layout/Navbar';
import Footer from '@/components/layout/Footer';
import Home from '@/pages/Home';
import Inventory from '@/pages/Inventory';
import CarDetails from '@/pages/CarDetails';
import Financing from '@/pages/Financing';
import About from '@/pages/About';
import Team from '@/pages/Team';
import Admin from '@/pages/Admin';
import VACFamily from '@/pages/VACFamily';
import ManagementAccess from '@/pages/ManagementAccess';
import Privacy from '@/pages/Privacy';
import Terms from '@/pages/Terms';
import ReturnPolicy from '@/pages/ReturnPolicy';
import TradeIn from '@/pages/TradeIn';
import Appraisal from '@/pages/Appraisal';
import QuickAddDelivery from '@/pages/QuickAddDelivery';
import DriveVacApply from '@/pages/DriveVacApply';
import DriveVacLegal from '@/pages/DriveVacLegal';
import CustomerPortal from '@/pages/CustomerPortal';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Toaster } from 'sonner';
import { useAdmin } from '@/hooks/useAdmin';
import { cn } from '@/lib/utils';
import { initPixel } from '@/lib/pixel';
import { initGTM } from '@/lib/gtm';
import { captureUtms } from '@/lib/utms';

// The customer portal is deployed but kept PRIVATE until launch. Public visits to
// /account redirect to the homepage. To test it yourself, visit /account?preview
// once — that unlocks it in your browser (persisted). Flip PORTAL_ENABLED to true
// (and it goes public) when Phase 1b is done and you're ready to launch.
const PORTAL_ENABLED = false;
function PortalGate() {
  if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('preview')) {
    try { localStorage.setItem('vac_portal_preview', '1'); } catch { /* ignore */ }
  }
  const allowed = PORTAL_ENABLED || (typeof window !== 'undefined' && localStorage.getItem('vac_portal_preview') === '1');
  return allowed ? <CustomerPortal /> : <Navigate to="/" replace />;
}

function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    initPixel();
    initGTM();
    // Skip scroll to top if we are returning to the inventory page
    // This allows Inventory.tsx to handle its own scroll restoration
    if (pathname === '/inventory') return;
    
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}

function ProtectedRoute({ children, requireSuperAdmin = false }: { children: React.ReactNode, requireSuperAdmin?: boolean }) {
  const { user, loading } = useAdmin();
  const authorizedEmail = 'j.jackson@drivevac.ca';

  if (loading) {
    return <div className="h-screen flex items-center justify-center">Loading...</div>;
  }

  if (requireSuperAdmin && user?.email !== authorizedEmail) {
    return <Navigate to="/" replace />;
  }

  // Let the Admin page render its OWN sign-in / access-denied screens so invite
  // links (and any logged-out visit to /admin) land on sign-in — not the homepage.
  return <>{children}</>;
}

export default function App() {
  const { isAdmin, loading } = useAdmin();

  return (
    <Router>
      <ScrollToTop />
      <AppLayout />
    </Router>
  );
}

function AppLayout() {
  const location = useLocation();

  useEffect(() => {
    captureUtms();
  }, [location]);

  const isFinancingPage = location.pathname.startsWith('/financing') || location.pathname.startsWith('/apply-now') || location.pathname.startsWith('/apply');

  // The pre-approval funnel gets its own subdomain (apply.vehicleapprovalcentre.com).
  // On that host we serve the funnel at the root and strip the VAC nav/footer so an
  // ad click lands straight in the application.
  const isApplyHost = typeof window !== 'undefined' && window.location.hostname.startsWith('apply.');

  // The appraisal form is a focused task a customer was sent a link to — no
  // footer, so there's nothing to wander off into mid-form. Same for the funnel.
  const isAppraisalPage = isApplyHost || location.pathname.startsWith('/appraisal') || location.pathname.startsWith('/quick-add') || location.pathname.startsWith('/get-approved') || location.pathname.startsWith('/apply-now') || location.pathname.startsWith('/dv-') || location.pathname.startsWith('/admin') || location.pathname.startsWith('/management-access') || location.pathname.startsWith('/account');

  return (
    <div className={cn(
      "flex flex-col min-h-screen",
      isFinancingPage ? "bg-slate-50" : "bg-white"
    )}>
      {!isAppraisalPage && <Navbar />}
      <main className="flex-grow">
        <Routes>
          {/* On the apply.* subdomain the root IS the pre-approval funnel. */}
          <Route path="/" element={isApplyHost ? <DriveVacApply /> : <Home />} />
          <Route path="/inventory" element={<Inventory />} />
          <Route path="/inventory/success" element={<Inventory />} />
          <Route path="/inventory/:slugWithId" element={<CarDetails />} />
          <Route path="/inventory/:slugWithId/success" element={<CarDetails />} />
          <Route path="/inventory/:id/:slug" element={<CarDetails />} />
          <Route path="/inventory/:id/:slug/success" element={<CarDetails />} />
          {/* Old contact-first form retired 2026-08-17 — redirect to the new full-form. */}
          <Route path="/financing" element={<Navigate to="/apply-now" replace />} />
          <Route path="/financing/success" element={<Navigate to="/apply-now" replace />} />
          {/* FLIPPED 2026-08-17: /apply-now now serves the winning full-form (contact-last),
              leads land in VAC's own Pipedrive as a LEAD via /api/apply-now. Old Financing
              form still available at /financing. */}
          <Route path="/apply-now" element={<DriveVacApply mode="dealership" />} />
          <Route path="/apply-now/success" element={<DriveVacApply mode="dealership" />} />
          <Route path="/about" element={<About />} />
          <Route path="/team" element={<Team />} />
          <Route path="/return-policy" element={<ReturnPolicy />} />
          <Route path="/management-access" element={<ManagementAccess />} />
          {/* Customer portal — passwordless login, application status (+ docs soon). */}
          <Route path="/account" element={<PortalGate />} />
          <Route path="/admin" 
            element={
              <ProtectedRoute>
                <Admin />
              </ProtectedRoute>
            } 
          />
          <Route path="/family" element={<VACFamily />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/trade-in" element={<Navigate to="/" replace />} />
          <Route path="/trade-in/success" element={<Navigate to="/" replace />} />
          {/* Sent to customers by a rep after they've spoken — not linked in the nav. */}
          <Route path="/appraisal" element={<Appraisal />} />
          {/* Internal: logistics manager publishes a delivery photo. PIN-gated, unlisted. */}
          <Route path="/quick-add" element={<QuickAddDelivery />} />
          {/* VAC pre-approval funnel (contact-last quiz). Also served at the root
              of apply.vehicleapprovalcentre.com. Standalone, no VAC chrome. */}
          <Route path="/get-approved" element={<DriveVacApply />} />
          {/* Unlisted TEST route: the winning full-form, but leads land in VAC's OWN
              Pipedrive as a LEAD (via /api/apply-now). Live /apply-now (Financing) is
              untouched until we flip it. */}
          <Route path="/apply-now-v2" element={<DriveVacApply mode="dealership" />} />
          {/* Funnel legal pages (in-house drafts pending lawyer review). */}
          <Route path="/dv-privacy" element={<DriveVacLegal doc="privacy" />} />
          <Route path="/dv-terms" element={<DriveVacLegal doc="terms" />} />
          {/* Fallback: funnel on the apply subdomain, Home elsewhere. */}
          <Route path="*" element={isApplyHost ? <DriveVacApply /> : <Home />} />
        </Routes>
      </main>
      {!isAppraisalPage && <Footer />}
      <Toaster position="top-right" richColors closeButton />
    </div>
  );
}
