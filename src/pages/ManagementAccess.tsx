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
        <div className="flex items-center justify-center gap-2 mb-6">
          <Logo className="h-8 w-auto" />
          <span className="text-xl font-black text-brand-primary tracking-tight">VAC Admin</span>
        </div>

        <div className="bg-white rounded-[2.5rem] shadow-xl shadow-gray-200/50 border border-gray-100 p-8 md:p-10">
          <div className="text-center mb-8">
            <div className="bg-brand-accent/10 h-16 w-16 rounded-2xl flex items-center justify-center mx-auto mb-5">
              <ShieldCheck className="h-8 w-8 text-brand-accent" />
            </div>
            <h1 className="text-3xl font-display font-bold text-brand-primary tracking-tight">Management Access</h1>
            <p className="text-gray-500 mt-1">Internal administrative portal</p>
          </div>

          <p className="text-center text-sm text-gray-500 leading-relaxed mb-6">
            This area is restricted to authorized VAC personnel. Please sign in with your corporate Google account to continue.
          </p>

          <Button
            onClick={handleLogin}
            disabled={isLoading}
            variant="brand"
            className="w-full h-14 rounded-2xl font-bold text-lg flex items-center justify-center gap-3"
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
                className="mt-4 p-4 bg-red-50 border border-red-100 rounded-xl flex items-center gap-3 text-red-600 text-sm"
              >
                <div className="shrink-0 w-8 h-8 rounded-full bg-red-100 flex items-center justify-center text-red-600">
                  <ShieldCheck className="h-4 w-4" />
                </div>
                <p className="font-medium">{errorMessage}</p>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="pt-6 flex items-center justify-center">
            <button
              onClick={() => navigate('/')}
              className="text-gray-400 hover:text-brand-primary text-sm font-semibold flex items-center gap-1 transition-colors"
            >
              Return to Public Site
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
