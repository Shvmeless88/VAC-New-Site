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
import { ScrollArea } from '@/components/ui/scroll-area';
import { Toaster } from 'sonner';
import { useAdmin } from '@/hooks/useAdmin';
import { cn } from '@/lib/utils';
import { initPixel } from '@/lib/pixel';
import { initGTM } from '@/lib/gtm';
import { captureUtms } from '@/lib/utms';

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
  const { user, isAdmin, role, loading } = useAdmin();
  const authorizedEmail = 'j.jackson@drivevac.ca';

  if (loading) {
    return <div className="h-screen flex items-center justify-center">Loading...</div>;
  }

  if (!user) {
    return <Navigate to="/" replace />;
  }

  if (requireSuperAdmin && user.email !== authorizedEmail) {
    return <Navigate to="/" replace />;
  }

  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }

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

  return (
    <div className={cn(
      "flex flex-col min-h-screen",
      isFinancingPage ? "bg-slate-50" : "bg-white"
    )}>
      <Navbar />
      <main className="flex-grow">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/inventory" element={<Inventory />} />
          <Route path="/inventory/success" element={<Inventory />} />
          <Route path="/inventory/:slugWithId" element={<CarDetails />} />
          <Route path="/inventory/:slugWithId/success" element={<CarDetails />} />
          <Route path="/inventory/:id/:slug" element={<CarDetails />} />
          <Route path="/inventory/:id/:slug/success" element={<CarDetails />} />
          <Route path="/financing" element={<Financing />} />
          <Route path="/financing/success" element={<Financing />} />
          <Route path="/apply-now" element={<Financing />} />
          <Route path="/apply-now/success" element={<Financing />} />
          <Route path="/about" element={<About />} />
          <Route path="/team" element={<Team />} />
          <Route path="/return-policy" element={<ReturnPolicy />} />
          <Route path="/management-access" element={<ManagementAccess />} />
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
          {/* Fallback to Home */}
          <Route path="*" element={<Home />} />
        </Routes>
      </main>
      <Footer />
      <Toaster position="top-right" richColors closeButton />
    </div>
  );
}
