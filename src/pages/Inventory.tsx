import React, { useState, useMemo, useEffect } from 'react';
import { useSearchParams, Link, useLocation } from 'react-router-dom';
import { useInventory } from '@/hooks/useInventory';
import { useDebounce } from '@/hooks/useDebounce';
import CarCard from '@/components/inventory/CarCard';
import TrustCard from '@/components/inventory/TrustCard';
import VehicleScoutCard from '@/components/inventory/VehicleScoutCard';
import VehicleScoutModal from '@/components/inventory/VehicleScoutModal';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, X, Car as CarIcon, Loader2, Truck, Car, Gauge, Zap, Filter, ChevronUp, RotateCcw, ChevronDown, SlidersHorizontal, ListFilter, XIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { motion, AnimatePresence } from 'motion/react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Sheet, SheetContent, SheetTrigger, SheetClose } from '@/components/ui/sheet';
import { FilterContent } from '@/components/inventory/FilterContent';
import { cn } from '@/lib/utils';

const bodyStyles = [
  { name: 'SUV', icon: Car },
  { name: 'Sedan', icon: Car },
  { name: 'Truck', icon: Truck },
  { name: 'Hatchback', icon: Car },
  { name: 'Van', icon: Car },
  { name: 'Convertible', icon: Car },
];

export default function Inventory() {
  const { inventory, loading, error } = useInventory();
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchQuery, setSearchQuery] = useState(() => sessionStorage.getItem('inventory_searchQuery') || searchParams.get('q') || '');
  const [selectedBody, setSelectedBody] = useState(() => sessionStorage.getItem('inventory_selectedBody') || searchParams.get('body') || 'all');
  const [selectedBudget, setSelectedBudget] = useState<string | null>(null);
  const [priceRange, setPriceRange] = useState<[number, number]>([6000, 100000]);
  const [maxDownPayment, setMaxDownPayment] = useState<number>(0);
  const [drivetrain, setDrivetrain] = useState<string>('all');
  const [sortBy, setSortBy] = useState(() => sessionStorage.getItem('inventory_sortBy') || 'newest');
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [currentPage, setCurrentPage] = useState(() => Number(sessionStorage.getItem('inventory_currentPage')) || 1);
  const [isScoutModalOpen, setIsScoutModalOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    if (location.pathname === '/inventory/success') {
      setIsScoutModalOpen(true);
    }
  }, [location.pathname]);
  const [isMobile, setIsMobile] = useState(false);
  const [visibleCount, setVisibleCount] = useState(15);
  const pageSize = 15;

  // Track Mobile View
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    handleResize(); // Init on mount
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // New Filters
  const [selectedMakes, setSelectedMakes] = useState<string[]>([]);
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [selectedFeatures, setSelectedFeatures] = useState<string[]>([]);
  const [yearRange, setYearRange] = useState<[number, number]>([2015, 2026]);
  const [mileageRange, setMileageRange] = useState<[number, number]>(() => JSON.parse(sessionStorage.getItem('inventory_mileageRange') || '[0, 200000]'));

  const debouncedPriceRange = useDebounce(priceRange, 300);
  const debouncedYearRange = useDebounce(yearRange, 300);
  const debouncedMileageRange = useDebounce(mileageRange, 300);

  // Update searchQuery when searchParams change
  useEffect(() => {
    const q = searchParams.get('q');
    if (q !== null) {
      setSearchQuery(q);
      sessionStorage.setItem('inventory_searchQuery', q);
    }
  }, [searchParams]);

  // Sync filters to URL
  useEffect(() => {
    const params = new URLSearchParams();
    if (searchQuery) params.set('q', searchQuery);
    if (selectedBody !== 'all') params.set('body', selectedBody);
    
    setSearchParams(params, { replace: true, preventScrollReset: true });
  }, [searchQuery, selectedBody, setSearchParams]);

  // Save state to sessionStorage
  useEffect(() => {
    sessionStorage.setItem('inventory_searchQuery', searchQuery);
    sessionStorage.setItem('inventory_selectedBody', selectedBody);
    sessionStorage.setItem('inventory_sortBy', sortBy);
    sessionStorage.setItem('inventory_currentPage', currentPage.toString());
    if (selectedBudget) {
      sessionStorage.setItem('inventory_selectedBudget', selectedBudget);
    } else {
      sessionStorage.removeItem('inventory_selectedBudget');
    }
    sessionStorage.setItem('inventory_mileageRange', JSON.stringify(mileageRange));
  }, [searchQuery, selectedBody, sortBy, currentPage, selectedBudget, mileageRange]);

  // Restore scroll position
  useEffect(() => {
    if (!loading && inventory.length > 0) {
      const savedScroll = sessionStorage.getItem('inventory_scrollPosition');
      if (savedScroll) {
        // Small delay to ensure grid is rendered
        setTimeout(() => {
          window.scrollTo(0, Number(savedScroll));
        }, 100);
      } else {
        window.scrollTo(0, 0);
      }
    }
  }, [loading, inventory.length]);

  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 500) {
        setShowBackToTop(true);
      } else {
        setShowBackToTop(false);
      }
      // Save scroll position
      sessionStorage.setItem('inventory_scrollPosition', window.scrollY.toString());
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const getBiweekly = (price: number | string) => Number(price) / 156;

  const filteredInventory = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    const queryWords = query.split(/\s+/).filter(word => word.length > 0);
    
    return inventory
      .filter(car => {
        // Exclude Sold vehicles older than 5 days (120 hours)
        if (car.status === 'Sold') {
          const now = Date.now();
          const soldAt = car.soldAt?.toMillis ? car.soldAt.toMillis() : (car.soldAt ? new Date(car.soldAt).getTime() : 0);
          const fiveDaysInMs = 5 * 24 * 60 * 60 * 1000;
          if (!soldAt || (now - soldAt) > fiveDaysInMs) {
            return false;
          }
        }

        const price = Number(car.price);
        if (!price || isNaN(price)) return false; // Skip cars with no price
        
        const fullTitle = `${car.year} ${car.make} ${car.model} ${car.bodyStyle || ''} ${car.trim || ''}`.toLowerCase();
        
        const matchesSearch = query === '' || queryWords.every(word => fullTitle.includes(word));
        const matchesBody = selectedBody === 'all' || car.bodyStyle === selectedBody;
        const matchesPrice = price >= debouncedPriceRange[0] && price <= debouncedPriceRange[1];
        
        // Use pre-calculated biWeekly field with fallback
        const carBiweekly = parseFloat(String(car.biWeekly).replace(/[^0-9.]/g, '')) || (Number(car.price) / 156) || 999;
        
        let matchesPayment = true;
        if (selectedBudget === '< $150') matchesPayment = carBiweekly < 150;
        else if (selectedBudget === '$150-$200') matchesPayment = carBiweekly >= 150 && carBiweekly <= 200;
        else if (selectedBudget === '$200-$250') matchesPayment = carBiweekly >= 200 && carBiweekly <= 250;
        else if (selectedBudget === '$250-$300') matchesPayment = carBiweekly >= 250 && carBiweekly <= 300;
        else if (selectedBudget === '$300+') matchesPayment = carBiweekly > 300;
        
        const dt = (car.drivetrain || 'AWD').toLowerCase();
        const matchesDrivetrain = drivetrain === 'all' || 
          (drivetrain === 'AWD' ? (dt.includes('awd') || dt.includes('4wd') || dt.includes('4x4') || dt.includes('all-wheel') || dt.includes('four-wheel') || dt.includes('all wheel') || dt.includes('four wheel')) : 
           drivetrain === 'FWD' ? (dt.includes('fwd') || dt.includes('front-wheel') || dt.includes('front wheel')) : false);
        
        // New filters
        const matchesMake = selectedMakes.length === 0 || selectedMakes.includes(car.make);
        const matchesModel = selectedModels.length === 0 || selectedModels.includes(car.model);
        const matchesYear = car.year >= debouncedYearRange[0] && car.year <= debouncedYearRange[1];
        const matchesMileage = car.mileage >= debouncedMileageRange[0] && car.mileage <= debouncedMileageRange[1];
        
        let matchesFeatures = true;
        if (selectedFeatures.length > 0) {
          const carFeatures = car.features || [];
          matchesFeatures = selectedFeatures.every(f => carFeatures.includes(f));
        }

        return matchesSearch && matchesBody && matchesPrice && matchesPayment && matchesDrivetrain && matchesMake && matchesModel && matchesYear && matchesMileage && matchesFeatures;
      })
      .sort((a, b) => {
        if (sortBy === 'price-low') return a.price - b.price;
        if (sortBy === 'price-high') return b.price - a.price;
        if (sortBy === 'newest') {
          const aDate = a.createdAt?.toMillis ? a.createdAt.toMillis() : new Date(a.createdAt || 0).getTime();
          const bDate = b.createdAt?.toMillis ? b.createdAt.toMillis() : new Date(b.createdAt || 0).getTime();
          return bDate - aDate;
        }
        if (sortBy === 'mileage-low') return a.mileage - b.mileage;
        if (sortBy === 'efficiency') return 0;
        if (sortBy === 'payment-low') {
          const aBiweekly = parseFloat(String(a.biWeekly).replace(/[^0-9.]/g, '')) || (Number(a.price) / 156) || 999;
          const bBiweekly = parseFloat(String(b.biWeekly).replace(/[^0-9.]/g, '')) || (Number(b.price) / 156) || 999;
          return aBiweekly - bBiweekly;
        }
        return 0;
      });
  }, [inventory, searchQuery, selectedBody, selectedBudget, debouncedPriceRange, maxDownPayment, drivetrain, sortBy, selectedMakes, selectedModels, debouncedYearRange, debouncedMileageRange]);

  // Reset to page 1 and visibleCount when filters change
  useEffect(() => {
    setCurrentPage(1);
    setVisibleCount(15);
  }, [searchQuery, selectedBody, selectedBudget, debouncedPriceRange, maxDownPayment, drivetrain, sortBy, selectedMakes, selectedModels, debouncedYearRange, debouncedMileageRange]);

  const displayedInventory = useMemo(() => {
    if (isMobile) {
      return filteredInventory.slice(0, visibleCount);
    } else {
      const start = (currentPage - 1) * pageSize;
      return filteredInventory.slice(start, start + pageSize);
    }
  }, [filteredInventory, currentPage, pageSize, isMobile, visibleCount]);

  const totalPages = Math.ceil(filteredInventory.length / pageSize);

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const clearAllFilters = () => {
    setSelectedBody('all');
    setPriceRange([6000, 100000]);
    setSelectedBudget(null);
    setMaxDownPayment(0);
    setDrivetrain('all');
    setSelectedMakes([]);
    setSelectedModels([]);
    setYearRange([2015, 2026]);
    setMileageRange([0, 200000]);
    setSearchQuery('');
  };

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (selectedBody !== 'all') count++;
    if (selectedMakes.length > 0) count += selectedMakes.length;
    if (selectedModels.length > 0) count += selectedModels.length;
    if (drivetrain !== 'all') count++;
    if (selectedBudget) count++;
    if (priceRange[0] > 6000 || priceRange[1] < 100000) count++;
    if (yearRange[0] > 2015 || yearRange[1] < 2026) count++;
    if (mileageRange[0] > 0 || mileageRange[1] < 200000) count++;
    return count;
  }, [selectedBody, selectedMakes, selectedModels, drivetrain, selectedBudget, priceRange, yearRange, mileageRange]);

  const filterProps = {
    selectedBody,
    setSelectedBody,
    selectedBudget,
    setSelectedBudget,
    priceRange,
    setPriceRange,
    maxDownPayment,
    setMaxDownPayment,
    drivetrain,
    setDrivetrain,
    selectedMakes,
    setSelectedMakes,
    selectedModels,
    setSelectedModels,
    selectedFeatures,
    setSelectedFeatures,
    yearRange,
    setYearRange,
    mileageRange,
    setMileageRange,
    clearAllFilters,
    inventory
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <Loader2 className="h-12 w-12 text-brand-primary animate-spin mx-auto mb-4" />
          <p className="text-gray-500 font-medium">Loading inventory...</p>
        </div>
      </div>
    );
  }

  if (error) {
    const isQuotaError = error.includes('quota') || error.includes('resource-exhausted') || error.includes('limit exceeded');
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center max-w-md px-6">
          <div className="bg-red-50 h-20 w-20 rounded-full flex items-center justify-center mx-auto mb-6 shadow-sm">
            {isQuotaError ? <Zap className="h-10 w-10 text-brand-accent animate-pulse" /> : <X className="h-10 w-10 text-red-600" />}
          </div>
          <h3 className="text-2xl font-display font-bold text-brand-primary mb-2">
            {isQuotaError ? "High Traffic Alert" : "Connection Issue"}
          </h3>
          <p className="text-gray-500 mb-8 leading-relaxed">
            {isQuotaError 
              ? "We've had an incredible amount of traffic today! Our daily free database limit has been reached. Please check back shortly or wait 24 hours for the reset. We apologize for the inconvenience."
              : error}
          </p>
          <Button onClick={() => window.location.reload()} className="bg-brand-primary hover:bg-brand-secondary px-8 h-12 rounded-xl">
            {isQuotaError ? "Retry Later" : "Try Again"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white pb-20 pt-14 md:pt-16 overflow-x-hidden">
      <div className="w-full max-w-none px-2 sm:px-6 lg:px-8 pt-2 lg:pt-6 flex flex-col lg:flex-row gap-4 lg:gap-8 box-border">
        {/* Sidebar Filters (Desktop) */}
        <aside className="hidden lg:block w-[300px] flex-shrink-0 h-[calc(100vh-80px)] sticky top-20 overflow-y-auto overflow-x-hidden [scrollbar-width:thin]">
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
            <div className="flex items-center justify-between mb-6 sticky top-0 bg-white z-10 py-2">
              <h2 className="text-sm font-extrabold text-[#41456B] uppercase tracking-wider">Filters</h2>
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={clearAllFilters}
                className="text-sm font-bold text-[#7380FF] hover:text-[#7380FF]/80 hover:bg-transparent p-0"
              >
                Clear All
              </Button>
            </div>
            <FilterContent {...filterProps} />
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 min-w-0">
          <div className="hidden lg:block mb-10">
            <h1 className="text-4xl md:text-5xl lg:text-7xl font-display font-black text-brand-primary leading-[1.1] mb-2 tracking-tighter">
              Explore Inventory<span className="text-[#7380FF]">.</span>
            </h1>
            <p className="text-lg text-slate-500 font-medium tracking-tight">
              Premium vehicles delivered anywhere in Atlantic Canada.
            </p>
          </div>

          {/* Mobile Header */}
          <div className="lg:hidden bg-white pt-2 pb-4 space-y-3">
            {/* New Inventory Alert */}
            <motion.div 
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-emerald-50/50 border border-emerald-100 rounded-xl px-4 py-2.5 flex items-center justify-between"
            >
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                <span className="text-xs font-black text-emerald-600 uppercase tracking-wider">New inventory added weekly!</span>
              </div>
              <Zap className="h-3.5 w-3.5 text-emerald-400 fill-emerald-400/20" />
            </motion.div>

            {/* Search Bar */}
            <div className="relative w-full group">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-[#64748B] group-focus-within:text-[#41456B] transition-colors duration-300 ease-in-out" />
              <Input
                placeholder="Search by make, model..."
                className="h-12 pl-12 rounded-xl bg-white border-[#CBD5E1] shadow-sm placeholder:text-[#64748B] font-medium text-base transition-all duration-300 ease-in-out hover:border-[#94A3B8] focus-visible:border-[#7380FF] focus-visible:ring-4 focus-visible:ring-[#7380FF]/15 w-full"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            
            {/* Filter & Sort Row */}
            <div className="flex items-center h-12">
              <Sheet>
                <SheetTrigger asChild>
                  <button className="flex-1 flex items-center justify-center h-full text-[#41456B] font-bold text-base transition-colors">
                    <SlidersHorizontal className="w-4 h-4 mr-2" />
                    Filter
                    {activeFilterCount > 0 && (
                      <span className="ml-2 flex h-5 w-5 items-center justify-center rounded-full bg-[#41456B] text-xs font-bold text-white">
                        {activeFilterCount}
                      </span>
                    )}
                  </button>
                </SheetTrigger>
                <SheetContent side="bottom" className="!h-[75dvh] w-full p-0 overflow-hidden rounded-t-[32px] border-none bg-white flex flex-col" showCloseButton={false}>
                  <motion.div 
                    initial={{ y: "100%" }}
                    animate={{ y: 0 }}
                    exit={{ y: "100%" }}
                    transition={{ type: "spring", damping: 25, stiffness: 200 }}
                    className="flex flex-col h-full w-full"
                  >
                    {/* Drag Handle & Header */}
                    <div className="sticky top-0 bg-white pt-3 pb-2 z-10">
                      <div className="w-12 h-1.5 bg-gray-300 rounded-full mx-auto mb-3" />
                      <div className="px-4 flex items-center justify-between">
                        <Button variant="ghost" onClick={clearAllFilters} className="text-[#7380FF] font-bold px-0">Clear All</Button>
                        <h2 className="text-lg font-bold text-[#41456B]">Filters</h2>
                        <SheetClose asChild>
                          <Button variant="ghost" size="icon" className="px-0"><XIcon className="h-6 w-6" /></Button>
                        </SheetClose>
                      </div>
                    </div>
                    
                    {/* Scrollable Content */}
                    <div className="flex-1 overflow-y-auto px-4">
                      <FilterContent {...filterProps} />
                    </div>
                    
                    {/* Sticky Bottom Button */}
                    <div className="sticky bottom-0 bg-white p-4 border-t border-gray-100">
                      <SheetClose asChild>
                        <Button variant="brand" className="w-full h-12 rounded-xl">
                          Show {filteredInventory.length} Results
                        </Button>
                      </SheetClose>
                    </div>
                  </motion.div>
                </SheetContent>
              </Sheet>

              <div className="h-6 w-[1px] bg-gray-300"></div>

              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger className="flex-1 flex items-center justify-center h-full border-none shadow-none bg-transparent text-[#41456B] font-bold text-base focus:ring-0 [&_.lucide-chevron-down]:hidden transition-colors">
                  <ListFilter className="w-4 h-4 mr-2" />
                  Sort
                </SelectTrigger>
                <SelectContent className="rounded-xl shadow-lg border-gray-100 min-w-[200px] p-1">
                  {[
                    { value: 'newest', label: 'Newest' },
                    { value: 'price-low', label: 'Price: Low' },
                    { value: 'price-high', label: 'Price: High' },
                    { value: 'efficiency', label: 'Fuel Efficiency' },
                    { value: 'payment-low', label: 'Lowest Monthly Payment' },
                  ].map((option) => (
                    <SelectItem 
                      key={option.value} 
                      value={option.value}
                      className="rounded-lg text-sm font-medium text-gray-700 focus:bg-gray-50 focus:text-[#7380FF] cursor-pointer py-2.5 px-3 transition-colors"
                    >
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            {/* Results Count Mobile */}
            <div className="flex items-center justify-between pt-2">
              <span className="text-sm font-bold text-[#41456B]">
                {filteredInventory.length} Results
              </span>
              {(selectedBody !== 'all' || selectedMakes.length > 0 || drivetrain !== 'all' || selectedBudget || priceRange[0] > 6000 || priceRange[1] < 100000 || yearRange[0] > 2015 || yearRange[1] < 2026 || mileageRange[0] > 0 || mileageRange[1] < 200000) && (
                <button 
                  onClick={clearAllFilters}
                  className="font-medium text-sm text-[#7380FF] hover:text-[#41456B] transition-colors"
                >
                  Clear Filters
                </button>
              )}
            </div>
          </div>

          {/* Desktop Search & Quick Filters Block */}
          <div className="hidden lg:block bg-white rounded-2xl border border-slate-100 shadow-sm mb-6 overflow-hidden">
            <div className="p-4 border-b border-slate-100">
              <div className="flex gap-4">
                <div className="relative flex-grow group">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-[#64748B] group-focus-within:text-[#41456B] transition-colors duration-300 ease-in-out" />
                  <Input
                    placeholder="Search by make, model..."
                    className="h-12 pl-12 rounded-xl bg-white border-[#CBD5E1] shadow-sm placeholder:text-[#64748B] font-medium text-base transition-all duration-300 ease-in-out hover:border-[#94A3B8] focus-visible:border-brand-accent focus-visible:ring-4 focus-visible:ring-brand-accent/15"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
              </div>
            </div>

            {/* Quick-Filter Row */}
            <div className="px-4 py-3 flex gap-2 overflow-x-auto custom-scrollbar">
              {[
                { label: 'Under $20,000', filter: () => setPriceRange(priceRange[1] === 20000 ? [6000, 154000] : [6000, 20000]), active: priceRange[1] === 20000 },
                { label: '2020 or Newer', filter: () => setYearRange(yearRange[0] === 2020 ? [2015, 2026] : [2020, 2026]), active: yearRange[0] === 2020 },
                { label: 'AWD / 4WD', filter: () => setDrivetrain(drivetrain === 'AWD' ? 'all' : 'AWD'), active: drivetrain === 'AWD' },
                { label: 'Low Mileage', filter: () => setMileageRange(mileageRange[1] === 60000 ? [0, 200000] : [0, 60000]), active: mileageRange[1] === 60000 },
              ].map((pill) => (
                <Button
                  key={pill.label}
                  variant="ghost"
                  onClick={pill.filter}
                  className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-medium transition-colors h-9 ${
                    pill.active 
                      ? 'bg-brand-accent text-white hover:bg-brand-accent/90' 
                      : 'bg-[#F3F4F6] text-brand-primary hover:bg-gray-200'
                  }`}
                >
                  {pill.label}
                </Button>
              ))}
            </div>
          </div>

          {/* Applied Filters Bar (Desktop) */}
          <div className="hidden lg:flex flex-wrap items-center gap-2 mb-6">
            <AnimatePresence mode="popLayout">
              {selectedBody !== 'all' && (
                <motion.div key="body-filter" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }}>
                  <Badge variant="secondary" className="bg-white border-slate-100 text-brand-primary px-3 py-1.5 rounded-full flex items-center gap-2 shadow-sm font-medium">
                    {selectedBody}
                    <X className="h-3 w-3 cursor-pointer hover:text-red-500" onClick={() => setSelectedBody('all')} />
                  </Badge>
                </motion.div>
              )}
                {selectedMakes.map(make => (
                  <motion.div key={`make-${make}`} initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }}>
                    <Badge variant="secondary" className="bg-white border-[#E2E8F0] text-[#41456B] px-3 py-1.5 rounded-full flex items-center gap-2 shadow-sm font-medium">
                      {make}
                      <X className="h-3 w-3 cursor-pointer hover:text-red-500" onClick={() => setSelectedMakes(prev => prev.filter(m => m !== make))} />
                    </Badge>
                  </motion.div>
                ))}
                {drivetrain !== 'all' && (
                  <motion.div key="drivetrain-filter" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }}>
                    <Badge variant="secondary" className="bg-white border-[#E2E8F0] text-[#41456B] px-3 py-1.5 rounded-full flex items-center gap-2 shadow-sm font-medium">
                      {drivetrain}
                      <X className="h-3 w-3 cursor-pointer hover:text-red-500" onClick={() => setDrivetrain('all')} />
                    </Badge>
                  </motion.div>
                )}
                {(selectedBody !== 'all' || selectedMakes.length > 0 || drivetrain !== 'all') && (
                  <motion.div key="clear-all-filter" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }}>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      onClick={clearAllFilters}
                      className="text-sm font-medium text-gray-500 hover:text-brand-primary hover:bg-transparent"
                    >
                      Clear All
                    </Button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Results Info (Desktop) */}
          <div className="hidden lg:flex items-center justify-between mb-6">
            <div className="flex items-center gap-4">
              <span className="text-lg font-bold text-brand-primary">
                {filteredInventory.length} Results
              </span>
              <button 
                onClick={clearAllFilters}
                className="font-medium text-sm text-[#64748B] hover:text-brand-primary transition-colors"
              >
                Clear All
              </button>
            </div>
            <div className="flex items-center">
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger className="w-auto h-10 border-none bg-transparent hover:bg-gray-50 focus:ring-0 shadow-none px-3 rounded-lg group transition-colors">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-[#64748B]">Sort:</span>
                    <SelectValue placeholder="Sort By" className="font-bold text-[#41456B]" />
                  </div>
                </SelectTrigger>
                <SelectContent className="rounded-xl shadow-lg border-gray-100 min-w-[200px] p-1 absolute right-0">
                  {[
                    { value: 'newest', label: 'Newest' },
                    { value: 'price-low', label: 'Price: Low' },
                    { value: 'price-high', label: 'Price: High' },
                    { value: 'efficiency', label: 'Fuel Efficiency' },
                    { value: 'payment-low', label: 'Lowest Monthly Payment' },
                  ].map((option) => (
                    <SelectItem 
                      key={option.value} 
                      value={option.value}
                      className="rounded-lg text-sm font-medium text-gray-700 focus:bg-gray-50 focus:text-[#7380FF] cursor-pointer py-2.5 px-3 transition-colors"
                    >
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Inventory Grid */}
          {displayedInventory.length > 0 ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8 min-h-[800px] px-4 md:px-0 box-border justify-items-center max-w-full">
                {displayedInventory.map((car, index) => (
                  <React.Fragment key={car.id}>
                    <div className="w-full h-full">
                        <CarCard car={car} />
                    </div>
                    {(index + 1) % 8 === 0 && (
                      <div className="w-full h-full">
                        <VehicleScoutCard index={index} />
                      </div>
                    )}
                  </React.Fragment>
                ))}
              </div>

              {/* Pagination / Load More */}
              {isMobile ? (
                visibleCount < filteredInventory.length && (
                  <div className="mt-12 flex justify-center w-full pb-8">
                    <Button 
                      variant="outline" 
                      onClick={() => setVisibleCount(prev => prev + 15)}
                      className="border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-brand-primary rounded-full px-8 py-2 font-semibold transition-all shadow-sm h-12 w-11/12 max-w-sm"
                    >
                      Load More Vehicles
                    </Button>
                  </div>
                )
              ) : (
                totalPages > 1 && (
                  <div className="mt-16 flex justify-center items-center gap-2 hidden md:flex">
                    <Button
                      variant="outline"
                      disabled={currentPage === 1}
                      onClick={() => handlePageChange(currentPage - 1)}
                      className="rounded-xl border-gray-200"
                    >
                      Previous
                    </Button>
                    
                    <div className="flex items-center gap-2 mx-4">
                      {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                        <Button
                          key={page}
                          variant={currentPage === page ? "default" : "ghost"}
                          onClick={() => handlePageChange(page)}
                          className={cn(
                            "w-10 h-10 rounded-xl font-bold",
                            currentPage === page ? "bg-brand-accent text-white" : "text-gray-500"
                          )}
                        >
                          {page}
                        </Button>
                      ))}
                    </div>

                    <Button
                      variant="outline"
                      disabled={currentPage === totalPages}
                      onClick={() => handlePageChange(currentPage + 1)}
                      className="rounded-xl border-gray-200"
                    >
                      Next
                    </Button>
                  </div>
                )
              )}
            </>
          ) : (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.4, ease: "easeOut" }}
              className="mt-20 text-center py-20 bg-white rounded-[2rem] shadow-xl border border-[#E2E8F0] flex flex-col items-center justify-center max-w-3xl mx-auto px-8"
            >
              <div className="w-20 h-20 bg-indigo-50 rounded-3xl flex items-center justify-center mb-8">
                <Search className="h-10 w-10 text-[#6366f1]" />
              </div>

              <h3 className="text-3xl font-black text-brand-primary tracking-tighter mb-4">
                Don't see what you're looking for?
              </h3>
              
              <p className="text-slate-600 text-lg mb-10 max-w-md mx-auto leading-relaxed">
                Our scouts have access to thousands of off-market vehicles across Atlantic Canada. Tell us your dream car, and we'll find it.
              </p>

              <div className="flex flex-col items-center gap-6 w-full max-w-sm">
                <Button 
                  onClick={() => setIsScoutModalOpen(true)}
                  className="w-full bg-[#6366f1] hover:bg-[#4f46e5] text-white px-10 py-7 text-lg font-bold rounded-2xl shadow-xl shadow-indigo-500/20 transition-all duration-300"
                >
                  Start Your Search
                </Button>

                <button 
                  onClick={clearAllFilters}
                  className="text-slate-400 hover:text-[#6366f1] font-bold text-sm transition-colors flex items-center gap-2"
                >
                  <RotateCcw className="h-4 w-4" />
                  Clear All Filters
                </button>
              </div>
            </motion.div>
          )}
        </main>
      </div>

      <VehicleScoutModal isOpen={isScoutModalOpen} onClose={() => setIsScoutModalOpen(false)} />

      <AnimatePresence>
        {showBackToTop && (
          <motion.button
            initial={{ opacity: 0, scale: 0.8, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.8, y: 20 }}
            onClick={scrollToTop}
            className="fixed bottom-28 md:bottom-8 right-6 md:right-8 z-50 bg-brand-accent text-white p-4 rounded-full shadow-2xl shadow-brand-accent/40 hover:bg-brand-accent/90 transition-all group"
            aria-label="Back to top"
          >
            <ChevronUp className="h-6 w-6 group-hover:-translate-y-1 transition-transform" />
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
