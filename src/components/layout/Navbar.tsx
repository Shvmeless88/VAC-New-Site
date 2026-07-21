import { Link, useLocation } from 'react-router-dom';
import { Phone, Menu, X, CreditCard, Info, ShieldCheck, LogIn, LogOut, User, ChevronDown, Users, LayoutDashboard } from 'lucide-react';
import { useState, useEffect } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { useAdmin } from '@/hooks/useAdmin';
import { loginWithGoogle, logout } from '@/lib/firebase';
import Logo from './Logo';

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

const primaryLinks = [
  { name: 'Shop Cars', path: '/inventory' },
  { name: 'VAC Family', path: '/family' },
  { name: 'Financing', path: '/financing' },
  { name: 'Trade-In', path: '/trade-in' },
];

const moreLinks = [
  { name: 'Team', path: '/team', icon: Users },
  { name: 'About Us', path: '/about', icon: Info },
];

export default function Navbar({ className }: { className?: string }) {
  const [isVisible, setIsVisible] = useState(true);
  const [lastScrollY, setLastScrollY] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const location = useLocation();
  const { isAdmin, user } = useAdmin();

  const isVDP = location.pathname.startsWith('/inventory/');
  const isFinancing = location.pathname.startsWith('/financing') || location.pathname.startsWith('/apply-now') || location.pathname.startsWith('/apply');
  const showStickyButton = lastScrollY > 600 && !isFinancing;


  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      
      // Keep navbar visible but translucent while scrolling on mobile VDP 
      // as per request for "behind transparency" effect
      if (isVDP && window.innerWidth < 768) {
        setIsVisible(true);
      } else {
        // Standard behavior
        setIsVisible(true);
      }
      
      setLastScrollY(currentScrollY);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [lastScrollY, isVDP]);

  const handleLogin = async () => {
    try {
      await loginWithGoogle();
    } catch (error) {
      console.error('Login failed:', error);
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  return (
    <nav className={cn(
      "fixed top-0 z-50 w-full transition-all duration-300",
      isVDP && window.innerWidth < 768
        ? "bg-white/90 backdrop-blur-md shadow-sm" 
        : "bg-white/90 backdrop-blur-md border-b border-slate-100",
      !isVisible && "md:translate-y-0 -translate-y-full",
      className
    )}>
      <div className="w-full max-w-none px-4 sm:px-6">
        <div className="flex justify-between h-14 md:h-16 items-center">
          {/* Logo */}
          <Link to="/" className="flex items-center space-x-1.5 group">
            <Logo className="h-6 md:h-7 max-h-[22px] md:max-h-[26px] w-auto" />
            <span className="font-display font-bold text-lg md:text-xl tracking-tight text-brand-primary">
              VAC
            </span>
          </Link>

          {/* Desktop Nav */}
          <div className="hidden md:flex items-center space-x-8">
            {!isFinancing ? (
              <>
                {primaryLinks.map((item) => (
                  <Link
                    key={item.name}
                    to={item.path}
                    className={cn(
                      "text-sm font-semibold tracking-tight transition-colors hover:text-brand-secondary",
                      location.pathname === item.path ? "text-brand-primary" : "text-brand-primary/80"
                    )}
                  >
                    {item.name}
                  </Link>
                ))}

                {/* More Dropdown */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="text-sm font-semibold tracking-tight text-brand-primary/80 hover:text-brand-secondary flex items-center gap-1 cursor-pointer outline-none">
                      More
                      <ChevronDown className="h-3 w-3" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48 rounded-2xl shadow-xl border-slate-100 p-2">
                    {moreLinks.map((item) => (
                      <DropdownMenuItem key={item.name} asChild>
                        <Link 
                          to={item.path} 
                          className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold text-brand-primary hover:bg-slate-50 cursor-pointer"
                        >
                          {item.icon && <item.icon className="h-4 w-4 text-brand-secondary" />}
                          {item.name}
                        </Link>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                
                <div className="h-4 w-px bg-slate-200 mx-2" />
              </>
            ) : null}

            {!isFinancing && (
              <a href="tel:17828305985" className="flex items-center text-sm font-bold tracking-tight text-brand-primary hover:text-brand-secondary">
                <Phone className="h-3.5 w-3.5 mr-1.5" />
                (782) 830-5985
              </a>
            )}

            <AnimatePresence>
              {showStickyButton && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.2 }}
                >
                  <Button asChild className="bg-brand-primary text-white font-bold uppercase tracking-widest text-xs h-9 px-6 rounded-xl shadow-md hover:brightness-110 transition-all">
                    <Link to="/financing" className="text-white">GET APPROVED</Link>
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Mobile: Menu Drawer */}
          <div className="md:hidden flex items-center gap-4">
            <AnimatePresence>
              {showStickyButton && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ duration: 0.2 }}
                >
                  <Button asChild className="bg-brand-primary text-white font-bold uppercase tracking-widest text-[11px] h-8 px-4 rounded-lg shadow-md hover:brightness-110 transition-all">
                    <Link to="/financing">GET APPROVED</Link>
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>

            {!isFinancing && (
              <Sheet open={isOpen} onOpenChange={setIsOpen}>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="icon" className="text-brand-primary">
                    <Menu className="h-6 w-6" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="right" className="w-[300px] sm:w-[400px] p-0 flex flex-col">
                <SheetHeader className="p-6 border-b border-slate-50 text-left">
                  <SheetTitle className="flex items-center space-x-2">
                    <Logo className="h-6 w-auto" />
                    <span className="font-display font-bold text-xl tracking-tight text-brand-primary">VAC</span>
                  </SheetTitle>
                </SheetHeader>
                
                <div className="flex-1 overflow-y-auto py-6 px-6">
                  <nav className="flex flex-col space-y-6">
                    {/* Primary Links */}
                    <div className="space-y-4">
                      <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Main Menu</p>
                      {primaryLinks.map((item) => (
                        <Link
                          key={item.name}
                          to={item.path}
                          onClick={() => setIsOpen(false)}
                          className={cn(
                            "flex items-center text-lg font-bold tracking-tight py-2 transition-colors",
                            location.pathname === item.path ? "text-brand-accent" : "text-brand-primary"
                          )}
                        >
                          {item.name}
                        </Link>
                      ))}
                    </div>

                    {/* More Links */}
                    <div className="space-y-4 pt-4 border-t border-slate-50">
                      <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Company</p>
                      {moreLinks.map((item) => (
                        <Link
                          key={item.name}
                          to={item.path}
                          onClick={() => setIsOpen(false)}
                          className="flex items-center text-lg font-bold tracking-tight py-2 text-brand-primary"
                        >
                          {item.icon && <item.icon className="h-5 w-5 mr-3 text-brand-secondary" />}
                          {item.name}
                        </Link>
                      ))}
                    </div>

                    {/* Support */}
                    <div className="space-y-4 pt-4 border-t border-slate-50">
                      <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Support</p>
                      <a 
                        href="tel:17828305985" 
                        className="flex items-center text-lg font-bold tracking-tight py-2 text-brand-primary"
                      >
                        <Phone className="h-5 w-5 mr-3 text-brand-secondary" />
                        (782) 830-5985
                      </a>
                    </div>
                  </nav>
                </div>

                <div className="p-6 border-t border-slate-50">
                  <Button asChild className="w-full bg-brand-primary text-white font-bold uppercase tracking-widest text-xs h-14 rounded-xl shadow-md hover:brightness-110 transition-all">
                    <Link to="/financing" onClick={() => setIsOpen(false)}>GET APPROVED</Link>
                  </Button>
                </div>
              </SheetContent>
            </Sheet>
            )}
          </div>
        </div>
      </div>

      {/* AnimatePresence removed to maintain strictly minimalist header as per request */}
    </nav>
  );
}
