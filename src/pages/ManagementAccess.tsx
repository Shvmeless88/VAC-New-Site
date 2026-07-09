import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ShieldCheck, LogIn, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { loginWithGoogle } from '@/lib/firebase';
import { useNavigate } from 'react-router-dom';
import { useAdmin } from '@/hooks/useAdmin';
import Logo from '@/components/layout/Logo';

export default function ManagementAccess() {
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { user, isAdmin } = useAdmin();
  const navigate = useNavigate();

  // If already logged in and is admin, redirect to admin dashboard
  useEffect(() => {
    if (user && isAdmin) {
      navigate('/admin');
    }
  }, [user, isAdmin, navigate]);

  const handleLogin = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      await loginWithGoogle();
      // The ProtectedRoute in App.tsx will handle the redirect if they are authorized
    } catch (error: any) {
      console.error('Login failed:', error);
      setErrorMessage(error.message || 'Login failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        <div className="bg-white rounded-[2.5rem] shadow-2xl shadow-slate-200/50 overflow-hidden border border-slate-100">
          <div className="bg-brand-primary p-12 text-center relative overflow-hidden">
            {/* Decorative background */}
            <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2 blur-2xl" />
            <div className="absolute bottom-0 left-0 w-24 h-24 bg-indigo-500/20 rounded-full translate-y-1/2 -translate-x-1/2 blur-xl" />
            
            <div className="relative z-10">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-white/10 rounded-2xl mb-6 backdrop-blur-sm border border-white/20">
                <ShieldCheck className="h-8 w-8 text-white" />
              </div>
              <h1 className="text-2xl font-display font-bold text-white tracking-tight mb-2">
                Management Access
              </h1>
              <p className="text-indigo-100/80 text-sm font-medium">
                Internal Administrative Portal
              </p>
            </div>
          </div>

          <div className="p-10">
            <div className="space-y-6">
              <div className="text-center space-y-2">
                <p className="text-slate-600 text-sm leading-relaxed">
                  This area is restricted to authorized VAC personnel only. Please sign in with your corporate credentials to continue.
                </p>
              </div>

              <Button
                onClick={handleLogin}
                disabled={isLoading}
                className="w-full bg-brand-primary hover:bg-brand-secondary text-white h-14 rounded-2xl font-bold text-lg transition-all duration-300 flex items-center justify-center gap-3 shadow-lg shadow-indigo-100"
              >
                {isLoading ? (
                  <div className="h-5 w-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <>
                    <LogIn className="h-5 w-5" />
                    Sign in with Google
                  </>
                )}
              </Button>

              <AnimatePresence>
                {errorMessage && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="p-4 bg-red-50 border border-red-100 rounded-xl flex items-center gap-3 text-red-600 text-sm"
                  >
                    <div className="shrink-0 w-8 h-8 rounded-full bg-red-100 flex items-center justify-center text-red-600">
                      <ShieldCheck className="h-4 w-4" />
                    </div>
                    <p className="font-medium">{errorMessage}</p>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="pt-4 flex items-center justify-center">
                <button 
                  onClick={() => navigate('/')}
                  className="text-slate-400 hover:text-brand-primary text-sm font-semibold flex items-center gap-1 transition-colors"
                >
                  Return to Public Site
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8 flex justify-center">
          <Logo className="h-6 w-auto opacity-20 grayscale" />
        </div>
      </motion.div>
    </div>
  );
}
