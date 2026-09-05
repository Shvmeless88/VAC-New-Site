import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { calculateBiWeeklyPayment, cn, getVehicleUrl, maxFinancingTerm } from '@/lib/utils';
import { useInventory } from '@/hooks/useInventory';
import { useSoldStories } from '@/hooks/useSoldStories';
import CarCard from '@/components/inventory/CarCard';
import ElfsightReviews from '@/components/ElfsightReviews';
import CarLoanCalculator from '@/components/calculator/CarLoanCalculator';
import MobileCTABar from '@/components/layout/MobileCTABar';
import { motion } from 'motion/react';
import { db, collection, query, orderBy, limit, onSnapshot, storage, ref, getDownloadURL, addDoc, Timestamp, handleFirestoreError, OperationType } from '@/lib/firebase';
import React, { useState, useEffect } from 'react';
import { Car } from '@/types';
import { 
  ArrowRight, 
  ShieldCheck, 
  Truck, 
  CreditCard, 
  ChevronRight, 
  RotateCcw, 
  Search, 
  CheckCircle,
  Smartphone,
  Star,
  StarHalf,
  Lock,
  FileText,
  MapPin,
  Loader2,
  RotateCw,
  RefreshCcw,
  TrendingUp,
  Car as CarIcon
} from 'lucide-react';

const stats = [
  { label: 'Vehicles Delivered', value: '5,000+' },
  { label: 'Customer Rating', value: '4.5/5' },
  { label: 'Years Serving Atlantic Canada', value: '8+' },
  { label: 'Lending Partners', value: '15+' },
];

const bodyStyles = [
  { name: 'SUV', path: '/inventory?body=SUV' },
  { name: 'Sedan', path: '/inventory?body=Sedan' },
  { name: 'Truck', path: '/inventory?body=Truck' },
  { name: 'Hatchback', path: '/inventory?body=Hatchback' },
  { name: 'Van', path: '/inventory?body=Van' },
  { name: 'Convertible', path: '/inventory?body=Convertible' },
];

const steps = [
  {
    title: 'Find Your Vehicle',
    description: 'Browse our certified inventory and check availability or explore our interactive 360° tours with zero pressure.',
    icon: Search,
  },
  {
    title: 'Quick Online Approval',
    description: 'Complete our secure 2-minute application to see your personalized financing options.',
    icon: CreditCard,
  },
  {
    title: 'Doorstep Delivery',
    description: 'We deliver your vehicle to your door anywhere in Atlantic Canada. Every vehicle comes with a VAC warranty for total peace of mind.',
    icon: Truck,
  },
];

const trustSignals = [
  {
    title: 'VAC Warranty Included',
    description: 'Every vehicle comes with a VAC warranty.',
    icon: ShieldCheck,
  },
  {
    title: '150-Point Inspection',
    description: 'Every vehicle undergoes a rigorous quality certification.',
    icon: CheckCircle,
  },
  {
    title: 'Atlantic Canada Delivery',
    description: 'Serving NS, NB, PEI, and Newfoundland.',
    icon: MapPin,
  },
];

export default function Home() {
  const [deliveries, setDeliveries] = useState<any[]>([]);
  const [heroImageUrl, setHeroImageUrl] = useState<string | null>(null);
  const { inventory, loading } = useInventory();
  const navigate = useNavigate();

  useEffect(() => {
    const fetchHeroImage = async () => {
      try {
        const imageRef = ref(storage, 'Generated Image April 06, 2026 - 12_06PM.jpg');
        const url = await getDownloadURL(imageRef);
        setHeroImageUrl(url);
      } catch (error) {
        console.error('Error fetching hero image from storage:', error);
      }
    };
    fetchHeroImage();
  }, []);

  useEffect(() => {
    const q = query(collection(db, 'deliveries'), orderBy('createdAt', 'desc'), limit(6));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setDeliveries(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, 'deliveries');
      } catch (e) {
        console.error("Home deliveries error caught:", e);
      }
    });
    return () => unsubscribe();
  }, []);

  const [activeSlide, setActiveSlide] = useState(0);
  const [activeDeliverySlide, setActiveDeliverySlide] = useState(0);
  const [activeTestimonialSlide, setActiveTestimonialSlide] = useState(0);
  const carouselRef = React.useRef<HTMLDivElement>(null);
  const deliveriesCarouselRef = React.useRef<HTMLDivElement>(null);
  const testimonialsCarouselRef = React.useRef<HTMLDivElement>(null);
  const cardRefs = React.useRef<(HTMLDivElement | null)[]>([]);
  const deliveriesCardRefs = React.useRef<(HTMLDivElement | null)[]>([]);
  const testimonialsCardRefs = React.useRef<(HTMLDivElement | null)[]>([]);
  const featuredCars = inventory.filter(car => car.isFeatured).slice(0, 3);

  // Shop-by-Style tiles: newest hero image per body style as the tile background.
  // Owner's call (Sep 2026): only the three main styles, no availability counts.
  const styleTiles = React.useMemo(() => {
    return bodyStyles
      .filter(s => ['SUV', 'Sedan', 'Truck'].includes(s.name))
      .map(s => {
        const cars = inventory.filter(c =>
          c.bodyStyle === s.name && c.status !== 'Sold' && c.status !== 'Pending Sale');
        const withImg = cars.find(c => c.images?.[0]);
        return { ...s, count: cars.length, image: withImg?.images?.[0] };
      }).filter(t => t.count > 0);
  }, [inventory]);

  // Newest arrivals, auto-populated — the owner buys daily and the freshest cars
  // are the draw. No admin flag needed: anything For Sale, newest createdAt first.
  const justLanded = React.useMemo(() => {
    const ts = (c: any) => {
      try {
        const d = c.createdAt?.toDate ? c.createdAt.toDate() : new Date(c.createdAt);
        return isNaN(d.getTime()) ? 0 : d.getTime();
      } catch (e) {
        return 0;
      }
    };
    return inventory
      .filter(c => c.status !== 'Sold' && c.status !== 'Pending Sale')
      .sort((a, b) => ts(b) - ts(a))
      .slice(0, 8);
  }, [inventory]);

  // Hero spotlight: the newest arrival WITH a showroom hero image. The old
  // stock press photo (heroImageUrl) stays as fallback until inventory loads.
  const heroCar = justLanded.find(c => c.images?.[0]) || null;
  const heroCarPrice = heroCar ? Number(heroCar.price) : 0;
  const heroCarTerm = heroCar && heroCarPrice > 0
    ? maxFinancingTerm(Number(heroCar.year), Number(heroCar.mileage))
    : null;
  const heroCarBiWeekly = heroCarTerm ? calculateBiWeeklyPayment(heroCarPrice, 6.99, heroCarTerm) : 0;

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const index = parseInt(entry.target.getAttribute('data-index') || '0');
            setActiveSlide(index);
          }
        });
      },
      { threshold: 0.5 }
    );

    cardRefs.current.forEach((ref) => {
      if (ref) observer.observe(ref);
    });

    return () => observer.disconnect();
  }, [featuredCars]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const index = parseInt(entry.target.getAttribute('data-index') || '0');
            setActiveDeliverySlide(index);
          }
        });
      },
      { threshold: 0.5 }
    );

    deliveriesCardRefs.current.forEach((ref) => {
      if (ref) observer.observe(ref);
    });

    return () => observer.disconnect();
  }, [deliveries]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const index = parseInt(entry.target.getAttribute('data-index') || '0');
            setActiveTestimonialSlide(index);
          }
        });
      },
      { threshold: 0.5 }
    );

    testimonialsCardRefs.current.forEach((ref) => {
      if (ref) observer.observe(ref);
    });

    return () => observer.disconnect();
  }, []);

  return (
    <div className="flex flex-col min-h-screen pt-14 md:pt-16">
      <MobileCTABar />
      {/* Hero Section - Professional, Financing First */}
      <section className="lg:min-h-[80vh] flex flex-col lg:flex-row bg-white relative overflow-hidden">
        {/* Left Column - Text and CTA */}
        <div className="flex-1 flex items-center justify-center pt-8 pb-6 lg:py-24 px-6 md:px-16 lg:px-24 z-10">
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8 }}
            className="max-w-2xl w-full"
          >
            <div className="hidden md:inline-flex items-center space-x-1.5 bg-white px-4 py-1.5 rounded-full mb-6 border border-brand-accent/20 shadow-sm">
              <CheckCircle className="h-4 w-4 text-brand-accent" />
              <span className="text-xs font-bold text-brand-accent uppercase tracking-wider">Instant Decision • Rates from 6.99% O.A.C.</span>
            </div>
            <h1 className="text-4xl md:text-5xl lg:text-7xl font-display font-black text-brand-primary leading-[1.05] mb-4 md:mb-8 tracking-tighter">
              Get approved in minutes. <span className="text-brand-secondary">Delivered to your door.</span>
            </h1>
            <div className="mb-6 md:mb-8">
              <p className="text-slate-600 text-base md:text-lg max-w-2xl leading-relaxed">
                Apply in about 60 seconds — <span className="font-bold text-slate-800">no obligation, rates from 6.99% O.A.C.</span> We work with every credit situation, right across Atlantic Canada.
              </p>
            </div>
            <div className="flex flex-col gap-3 mb-6">
              <Button asChild variant="brand" size="xl" className="w-full">
                <Link to="/apply-now">Get Pre-Approved</Link>
              </Button>
              <p className="text-center text-xs text-slate-400">⚡ 60-second form · no obligation</p>
              <Button asChild variant="outline" size="xl" className="w-full border-brand-accent text-brand-accent hover:bg-brand-accent hover:text-white">
                <Link to="/inventory">Browse Inventory</Link>
              </Button>
            </div>

            {/* Social proof, right next to the CTA — numbers match the live widget
                (4.4 across Google + Facebook); clicking jumps to the reviews. */}
            <button
              type="button"
              onClick={() => document.getElementById('vac-reviews')?.scrollIntoView({ behavior: 'smooth' })}
              className="flex items-center gap-2 mb-6 text-sm text-slate-500 hover:text-slate-700 transition-colors"
            >
              <span className="text-amber-400 tracking-wide text-base">★★★★<span className="text-slate-300">★</span></span>
              <span className="font-bold text-brand-primary">4.4</span>
              <span className="underline underline-offset-4 decoration-slate-300">from 650+ reviews on Google & Facebook</span>
            </button>

            {/* Trust chips — no repeats of the rate/no-obligation lines already in
                the badge and paragraph a few lines up */}
            <div className="flex flex-wrap gap-2 mb-4 md:mb-12">
              {['Every credit situation', '150-point inspected', 'VAC warranty included'].map((t) => (
                <span key={t} className="inline-flex items-center gap-1.5 text-xs text-slate-600 bg-slate-50 border border-slate-100 px-3 py-1.5 rounded-lg">
                  <CheckCircle className="h-3.5 w-3.5 text-green-500" />
                  {t}
                </span>
              ))}
            </div>
          </motion.div>
        </div>
        {/* Right Column - Newest arrival spotlight (real inventory, clickable).
            Falls back to the old stock press photo until inventory loads. */}
        <div className="flex-1 relative flex items-center justify-center lg:justify-end p-6 md:p-10 lg:pr-16">
          {heroCar ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.95, x: 20 }}
              animate={{ opacity: 1, scale: 1, x: 0 }}
              transition={{ duration: 0.8, delay: 0.2 }}
              className="relative z-10 w-full max-w-2xl"
            >
              <Link to={getVehicleUrl(heroCar)} className="block group">
                <div className="relative overflow-hidden rounded-[2rem] shadow-2xl shadow-brand-primary/20 ring-1 ring-black/5">
                  <img
                    src={heroCar.images[0]}
                    alt={`${heroCar.year} ${heroCar.make} ${heroCar.model}`}
                    width={1184}
                    height={864}
                    fetchPriority="high"
                    className="w-full h-auto object-cover group-hover:scale-[1.02] transition-transform duration-700"
                    referrerPolicy="no-referrer"
                  />
                  <div className="absolute top-4 left-4 inline-flex items-center gap-2 bg-emerald-500 text-white rounded-full px-3 py-1.5 text-xs font-black uppercase tracking-wider shadow-lg">
                    <span className="h-2 w-2 rounded-full bg-white animate-pulse" />
                    Just Landed
                  </div>
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent px-5 pt-10 pb-4 flex items-end justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-white font-display font-bold text-lg md:text-xl leading-tight truncate">
                        {heroCar.year} {heroCar.make} {heroCar.model}
                      </p>
                      <p className="text-white/80 text-xs md:text-sm font-medium truncate">
                        {(heroCar.mileage || 0).toLocaleString()} km
                        {heroCarPrice > 0 && <> · ${heroCarPrice.toLocaleString()}</>}
                        {heroCarTerm ? <> · ${Math.round(heroCarBiWeekly).toLocaleString()}/bw</> : null}
                      </p>
                    </div>
                    <span className="hidden sm:inline-flex items-center gap-1 text-white text-xs font-bold bg-white/15 backdrop-blur-sm rounded-full px-3 py-1.5 whitespace-nowrap group-hover:bg-brand-accent transition-colors">
                      View Vehicle <ArrowRight className="h-3.5 w-3.5" />
                    </span>
                  </div>
                </div>
              </Link>
            </motion.div>
          ) : (
            <div className="relative w-full flex justify-end overflow-visible">
              <motion.div
                initial={{ opacity: 0, scale: 0.9, x: 20 }}
                animate={{ opacity: heroImageUrl ? 1 : 0, scale: heroImageUrl ? 1 : 0.9, x: heroImageUrl ? 0 : 20 }}
                transition={{ duration: 1, delay: 0.2 }}
                className="relative z-10 w-full max-w-4xl overflow-visible"
              >
                {heroImageUrl && (
                  <img
                    src={heroImageUrl}
                    alt="VAC Featured Vehicle"
                    className="w-full h-auto object-contain [mask-image:linear-gradient(to_bottom,black_85%,transparent_100%)]"
                    referrerPolicy="no-referrer"
                  />
                )}
              </motion.div>
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: heroImageUrl ? 1 : 0, scale: heroImageUrl ? 1 : 0.8 }}
                transition={{ duration: 1, delay: 0.4 }}
                className="absolute bottom-[12%] right-0 w-[85%] h-[8%] bg-gray-900/20 blur-3xl rounded-[100%] z-0"
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: heroImageUrl ? 1 : 0, scale: heroImageUrl ? 1 : 0.8 }}
                transition={{ duration: 1, delay: 0.4 }}
                className="absolute bottom-[14%] right-[5%] w-[75%] h-[2%] bg-gray-900/40 blur-xl rounded-[100%] z-0"
              />
            </div>
          )}
        </div>
      </section>

      {/* Just Landed — auto-fed from the newest For Sale listings */}
      {!loading && justLanded.length > 0 && (
        <motion.section
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="py-12 md:py-20 bg-[#F8FAFC]"
        >
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-8 gap-4">
              <div className="max-w-2xl w-full">
                <div className="inline-flex items-center gap-2 bg-emerald-50 text-emerald-700 rounded-full px-3 py-1 text-xs font-black uppercase tracking-wider mb-3">
                  <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                  Just Landed
                </div>
                <h2 className="text-2xl md:text-5xl font-display font-bold text-brand-primary tracking-tight mb-2 md:mb-3">
                  Fresh On the Lot
                </h2>
                <p className="text-gray-500 text-base md:text-lg">
                  New arrivals hit our showroom daily — these are the latest.
                </p>
              </div>
              <Button asChild variant="outline" className="hidden border-brand-accent text-brand-accent hover:bg-brand-accent hover:text-white font-bold md:flex text-base p-6 transition-colors rounded-xl">
                <Link to="/inventory">
                  See All Arrivals <ChevronRight className="ml-2 h-5 w-5" />
                </Link>
              </Button>
            </div>

            <div className="flex gap-4 md:gap-6 overflow-x-auto snap-x snap-mandatory [&::-webkit-scrollbar]:hidden pb-4 -mx-4 px-4 sm:mx-0 sm:px-1">
              {/* The hero spotlight car already headlines the page — skip it here */}
              {justLanded.filter(car => car.id !== heroCar?.id).map((car) => (
                <div
                  key={car.id}
                  className="w-[calc(100vw-72px)] sm:w-[320px] md:w-[340px] flex-shrink-0 snap-center"
                >
                  <CarCard car={car} />
                </div>
              ))}
            </div>

            <Button asChild variant="outline" className="w-full mt-4 h-12 font-bold border-brand-primary/20 text-brand-primary hover:bg-brand-primary/5 hover:text-brand-primary transition-all md:hidden">
              <Link to="/inventory" className="flex items-center justify-center">
                See All Arrivals
              </Link>
            </Button>
          </div>
        </motion.section>
      )}

      {/* Shop by Style — replaced the manual "Popular Inventory" carousel
          2026-09-05 (it duplicated Just Landed). Tiles use each body style's
          newest showroom hero and a live count, so they maintain themselves. */}
      <motion.section
        initial={{ opacity: 0, y: 40 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className="py-12 md:py-24 bg-white"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-8 md:mb-16 gap-6">
            <div className="max-w-2xl w-full">
              <h2 className="text-2xl md:text-5xl font-display font-bold text-brand-primary tracking-tight mb-2 md:mb-4">
                Shop by Style
              </h2>
              <p className="text-gray-500 text-base md:text-lg">
                Know what you're after? Jump straight to it.
              </p>
            </div>
            <Button asChild variant="outline" className="hidden border-brand-accent text-brand-accent hover:bg-brand-accent hover:text-white font-bold md:flex text-base p-6 transition-colors rounded-xl">
              <Link to="/inventory">
                View Full Inventory <ChevronRight className="ml-2 h-5 w-5" />
              </Link>
            </Button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-6">
            {styleTiles.map((tile) => (
              <Link key={tile.name} to={tile.path} className="group relative rounded-2xl md:rounded-3xl overflow-hidden aspect-[4/3] bg-gray-100 shadow-sm hover:shadow-xl transition-all duration-300 last:col-span-2 md:last:col-span-1">
                {tile.image && (
                  <img
                    src={tile.image}
                    alt={tile.name}
                    className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                  />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
                <div className="absolute inset-x-0 bottom-0 p-3 md:p-5 flex items-end justify-between gap-2">
                  <p className="text-white font-display font-bold text-base md:text-2xl leading-tight">{tile.name}s</p>
                  <span className="hidden md:inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/15 backdrop-blur-sm text-white group-hover:bg-brand-accent transition-colors">
                    <ChevronRight className="h-5 w-5" />
                  </span>
                </div>
              </Link>
            ))}
          </div>

          <Button asChild variant="outline" className="w-full mt-6 h-12 font-bold border-brand-primary/20 text-brand-primary hover:bg-brand-primary/5 hover:text-brand-primary transition-all md:hidden">
            <Link to="/inventory" className="flex items-center justify-center">
              View Full Inventory
            </Link>
          </Button>
        </div>
      </motion.section>

      {/* Trade-In Appraisal Section hidden for now */}

      {/* Trust Bar - Premium Checklist Bridge */}
      <section className="py-8 md:py-16 bg-white relative z-10">
        {/* Clean dark card — the old grid-line texture / stacked glows / hover-scale
            read as busy and dated. One soft glow, nothing else. */}
        <div className="max-w-[95%] lg:max-w-7xl mx-auto relative overflow-hidden rounded-[2rem] lg:rounded-[3rem] bg-brand-primary shadow-xl py-8 md:py-14 px-4 md:px-6">
          <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-brand-secondary/15 blur-[130px] rounded-full pointer-events-none translate-x-1/2 -translate-y-1/2" />

          <div className="max-w-6xl mx-auto relative z-10">
            <div className="grid grid-cols-3 gap-2 md:gap-8 divide-x divide-white/5">
              {/* Real, hard numbers — the rating already shows live in the reviews
                  section, so this bar carries the stats no other section states. */}
              {[
                { Icon: TrendingUp, value: '5,000+', label: 'Vehicles Delivered' },
                { Icon: MapPin, value: '8+ Years', label: 'Serving Atlantic Canada' },
                { Icon: CreditCard, value: '15+', label: 'Lending Partners' },
              ].map(({ Icon, value, label }) => (
                <div key={label} className="flex flex-col items-center text-center px-2 md:px-4">
                  <Icon className="h-5 w-5 md:h-7 md:w-7 text-brand-secondary mb-3 md:mb-5" />
                  <p className="font-display font-bold text-white text-lg md:text-2xl lg:text-4xl mb-1 md:mb-2 tracking-tight leading-none">{value}</p>
                  <p className="text-[9px] md:text-xs text-white/60 font-bold uppercase tracking-[0.1em] md:tracking-[0.2em] max-w-[200px] leading-relaxed">{label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Recent Deliveries Section */}
      <section className="py-12 md:py-24 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-8 md:mb-16 gap-6">
            <div className="max-w-2xl w-full">
              <h2 className="text-2xl md:text-5xl font-display font-bold text-brand-primary tracking-tight mb-2 md:mb-4">
                The VAC Family
              </h2>
              <p className="text-gray-500 text-base md:text-lg">
                Real stories from happy drivers across Atlantic Canada.
              </p>
            </div>
            <Button asChild variant="outline" className="hidden border-brand-accent text-brand-accent hover:bg-brand-accent hover:text-white font-bold md:flex text-base p-6 transition-colors rounded-xl">
              <Link to="/family">
                View VAC Family <ChevronRight className="ml-2 h-5 w-5" />
              </Link>
            </Button>
          </div>

          {/* Desktop Slider */}
          <div className="hidden md:block overflow-hidden whitespace-nowrap relative py-8 -mx-4 px-4 md:mx-0 md:px-0 [mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)]">
            <div className="flex gap-4 md:gap-8 min-w-max w-fit px-4 animate-scroll-carousel will-change-transform [backface-visibility:hidden]">
              {[...deliveries.slice(0, 6), ...deliveries.slice(0, 6)].map((story, index) => (
                <div
                  key={`${story.id}-${index}`}
                  className="w-[300px] md:w-[400px] flex-shrink-0 group bg-white rounded-xl overflow-hidden shadow-sm hover:shadow-2xl transition-all duration-500 border border-gray-100 px-0 whitespace-normal text-left"
                >
                  <div className="relative aspect-[4/3] overflow-hidden bg-gray-100 rounded-t-xl">
                    <img 
                      src={story.photoUrl}
                      alt={`Congrats, ${story.firstName}!`}
                      className="h-full w-full object-cover transition-transform duration-1000 group-hover:scale-105"
                      referrerPolicy="no-referrer"
                      loading="lazy"
                    />
                  </div>
                  <div className="px-6 pt-[6px] pb-6">
                    <div className="flex items-center gap-2 h-[24px] mb-1">
                      <Badge className="bg-[#41456B] text-white border-none px-2 py-0.5 font-semibold shadow-none text-xs uppercase tracking-wider rounded-sm flex items-center">
                        <div className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse mr-1.5" />
                        Live Delivery
                      </Badge>
                    </div>
                    <div className="flex items-start justify-between mb-2 min-h-[28px]">
                      <h3 className="text-lg font-semibold tracking-tight text-brand-primary truncate">Congrats, {story.firstName}!</h3>
                      <span className="text-sm font-medium text-[#64748B] whitespace-nowrap ml-2">
                        {story.createdAt?.toDate().toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                      </span>
                    </div>
                    <div className="space-y-[2px] mb-6">
                      <p className="text-[#64748B] text-sm font-medium flex items-center gap-2.5 truncate leading-[1.5]">
                        <CarIcon className="h-4 w-4 text-[#7380FF] shrink-0" /> {story.vehicle}
                      </p>
                      <p className="text-[#64748B] text-sm font-medium flex items-center gap-2.5 truncate leading-[1.5]">
                        <MapPin className="h-4 w-4 text-[#7380FF] shrink-0" /> {story.city}, {story.province}
                      </p>
                    </div>
                    <div className="flex gap-3">
                      <Badge className="bg-[#7380FF]/5 text-[#7380FF] border-none px-2 py-0.5 font-bold text-xs uppercase tracking-wider rounded-lg">
                        360° VERIFIED
                      </Badge>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Mobile Single Card View */}
          <div className="block md:hidden">
            {deliveries.length > 0 && (
              <div className="max-w-sm mx-auto bg-white rounded-xl overflow-hidden shadow-sm border border-gray-100 mb-6">
                <div className="relative aspect-[4/3] overflow-hidden bg-gray-100 rounded-t-xl">
                  <img 
                    src={deliveries[0].photoUrl}
                    alt={`Congrats, ${deliveries[0].firstName}!`}
                    className="h-full w-full object-cover"
                    referrerPolicy="no-referrer"
                    loading="lazy"
                  />
                </div>
                <div className="p-6">
                  <div className="flex items-center gap-2 mb-3">
                    <Badge className="bg-[#41456B] text-white border-none px-2 py-0.5 font-semibold shadow-none text-xs uppercase tracking-wider rounded-sm flex items-center">
                      <div className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse mr-1.5" />
                      Live Delivery
                    </Badge>
                  </div>
                  <div className="flex items-start justify-between mb-4">
                    <h3 className="text-xl font-bold tracking-tight text-brand-primary truncate">Congrats, {deliveries[0].firstName}!</h3>
                    <span className="text-sm font-medium text-[#64748B] whitespace-nowrap ml-2">
                      {deliveries[0].createdAt?.toDate().toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                    </span>
                  </div>
                  <div className="space-y-2 mb-6">
                    <p className="text-[#64748B] text-base font-medium flex items-center gap-2.5 truncate">
                      <CarIcon className="h-5 w-5 text-[#7380FF] shrink-0" /> {deliveries[0].vehicle}
                    </p>
                    <p className="text-[#64748B] text-base font-medium flex items-center gap-2.5 truncate">
                      <MapPin className="h-5 w-5 text-[#7380FF] shrink-0" /> {deliveries[0].city}, {deliveries[0].province}
                    </p>
                  </div>
                  <div className="flex gap-3">
                    <Badge className="bg-[#7380FF]/5 text-[#7380FF] border-none px-2 py-0.5 font-bold text-xs uppercase tracking-wider rounded-lg">
                      360° VERIFIED
                    </Badge>
                  </div>
                </div>
              </div>
            )}
            
            <Button asChild variant="outline" className="w-full mt-6 h-12 md:h-14 font-bold border-brand-primary/20 text-brand-primary hover:bg-brand-primary/5 hover:text-brand-primary transition-all">
              <Link to="/family" className="flex items-center justify-center">
                View 100+ More Happy Customers
              </Link>
            </Button>
          </div>

          {/* Reviews — folded in from the old standalone "Customer Experiences" section */}
          <div className="mt-14 md:mt-24 pt-14 md:pt-24 border-t border-gray-100">
            {/* Real, auto-synced 5-star reviews from Google + Facebook.
                The widget shows its own live aggregate rating, so no static
                stars header here (it would drift out of date). */}
            <div id="vac-reviews" className="scroll-mt-24">
              <ElfsightReviews />
            </div>
          </div>
        </div>
      </section>

      {/* Payment Calculator */}
      <section className="bg-white border-t border-gray-100">
        <CarLoanCalculator />
      </section>


      {/* How it Works - The 3-Step Process */}
      <section className="py-14 md:py-24 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-8 md:mb-24">
            <h2 className="text-3xl md:text-6xl font-display font-bold text-brand-primary mb-4 md:mb-6">How It Works</h2>
            <p className="text-gray-500 text-base md:text-xl max-w-2xl mx-auto">
              Shop first or Apply first. We've reimagined the car buying experience to be completely online and transparent.
            </p>
          </div>

          {/* Compact on phones — each step was filling most of a screen */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-16 relative">
            {steps.map((step, index) => (
              <motion.div
                key={step.title}
                initial={{ opacity: 0, scale: 0.9 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true, margin: "-100px" }}
                transition={{ duration: 0.7, delay: index * 0.2, ease: "easeOut" }}
                className="flex flex-col items-center text-center group"
              >
                <div className="h-16 w-16 md:h-24 md:w-24 rounded-2xl md:rounded-[2rem] bg-brand-primary text-white flex items-center justify-center mb-4 md:mb-10 shadow-2xl shadow-brand-primary/20 group-hover:bg-[#7380FF] group-hover:rotate-6 transition-all duration-500">
                  <step.icon className="h-7 w-7 md:h-10 md:w-10" />
                </div>
                <div className="flex items-center justify-center mb-3 md:mb-6">
                  <span className="text-xs font-bold text-[#7380FF] uppercase tracking-[0.2em] bg-[#7380FF]/5 px-5 py-2 rounded-full">Step 0{index + 1}</span>
                </div>
                <h3 className="text-xl md:text-2xl font-display font-bold text-brand-primary mb-2 md:mb-5">{step.title}</h3>
                <p className="text-base md:text-lg text-gray-500 leading-relaxed max-w-sm">{step.description}</p>
              </motion.div>
            ))}
          </div>

          {/* Browse, not another Get Pre-Approved — the sticky mobile bar already
              shows that CTA right below this spot (two identical buttons stacked). */}
          <div className="mt-10 md:mt-16 text-center">
            <Button asChild size="lg" variant="outline" className="border-[#7380FF] text-[#7380FF] hover:bg-[#7380FF] hover:text-white px-12 py-8 text-xl font-bold rounded-xl transition-colors">
              <Link to="/inventory">Browse Inventory</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* "Peace of Mind" section removed 2026-09-05: its three points (warranty,
          delivery, pricing) already appear in the hero chips, How It Works step 3,
          and the market-price badges on every card — it was the page's third
          restatement of the same message. */}

      {/* Final CTA */}
      <section className="py-16 md:py-32 bg-[#41456B] relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-white via-transparent to-transparent" />
        </div>
        
        <div className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
          >
            <h2 className="text-4xl md:text-7xl font-display font-bold text-white mb-10 leading-[1.1]">
              Ready to Start Your Journey?
            </h2>
            <p className="text-xl text-gray-300 mb-14 leading-relaxed max-w-2xl mx-auto">
              Whether you're browsing first or getting approved first, VAC makes it easy to buy your next car 100% online.
            </p>
            <div className="flex flex-col sm:flex-row justify-center gap-6">
              <Button asChild className="h-16 px-12 rounded-xl bg-transparent border-2 border-[#7380FF] text-[#7380FF] font-bold hover:bg-[#7380FF] hover:text-white hover:shadow-lg transition-all duration-300 ease-in-out text-lg">
                <Link to="/inventory">Browse Inventory</Link>
              </Button>
              <Button asChild className="h-16 px-12 rounded-xl bg-[#7380FF] text-white font-bold shadow-2xl shadow-[#7380FF]/40 hover:bg-[#41456B] hover:text-white hover:shadow-lg transition-all duration-300 ease-in-out text-lg">
                <Link to="/apply-now">Get Pre-Approved</Link>
              </Button>
            </div>
          </motion.div>
        </div>
      </section>

    </div>
  );
}
