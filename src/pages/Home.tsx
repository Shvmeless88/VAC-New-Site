import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useInventory } from '@/hooks/useInventory';
import { useSoldStories } from '@/hooks/useSoldStories';
import CarCard from '@/components/inventory/CarCard';
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

            {/* Social proof, right next to the CTA */}
            <div className="flex items-center gap-2 mb-6 text-sm text-slate-500">
              <span className="text-amber-400 tracking-wide text-base">★★★★<span className="text-slate-300">★</span></span>
              <span className="font-bold text-brand-primary">4.5</span>
              <span>from 416 Google reviews</span>
            </div>

            {/* Trust chips */}
            <div className="flex flex-wrap gap-2 mb-4 md:mb-12">
              {['Rates from 6.99% O.A.C.', 'Every credit situation', 'No obligation', '150-point inspected'].map((t) => (
                <span key={t} className="inline-flex items-center gap-1.5 text-xs text-slate-600 bg-slate-50 border border-slate-100 px-3 py-1.5 rounded-lg">
                  <CheckCircle className="h-3.5 w-3.5 text-green-500" />
                  {t}
                </span>
              ))}
            </div>
          </motion.div>
        </div>
        {/* Right Column - Image with Grounding Shadow */}
        <div className="flex-1 relative flex items-center justify-end p-0 overflow-visible">
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
            {/* Grounding Shadow Ellipse */}
            <motion.div 
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: heroImageUrl ? 1 : 0, scale: heroImageUrl ? 1 : 0.8 }}
              transition={{ duration: 1, delay: 0.4 }}
              className="absolute bottom-[12%] right-0 w-[85%] h-[8%] bg-gray-900/20 blur-3xl rounded-[100%] z-0"
            />
            {/* Tight Contact Shadow */}
            <motion.div 
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: heroImageUrl ? 1 : 0, scale: heroImageUrl ? 1 : 0.8 }}
              transition={{ duration: 1, delay: 0.4 }}
              className="absolute bottom-[14%] right-[5%] w-[75%] h-[2%] bg-gray-900/40 blur-xl rounded-[100%] z-0"
            />
          </div>
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
                  Fresh Off the Truck
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
              {justLanded.map((car) => (
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

      {/* Popular Inventory */}
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
                Popular Inventory
              </h2>
              <p className="text-gray-500 text-base md:text-lg">
                Premium vehicles ready for doorstep delivery across Atlantic Canada.
              </p>
            </div>
            <Button asChild variant="outline" className="hidden border-brand-accent text-brand-accent hover:bg-brand-accent hover:text-white font-bold md:flex text-base p-6 transition-colors rounded-xl">
              <Link to="/inventory">
                View Full Inventory <ChevronRight className="ml-2 h-5 w-5" />
              </Link>
            </Button>
          </div>

          {loading ? (
            <div className="py-20 flex flex-col items-center justify-center">
              <Loader2 className="h-12 w-12 text-brand-primary animate-spin mb-4" />
              <p className="text-gray-500 font-medium">Loading featured vehicles...</p>
            </div>
          ) : featuredCars.length > 0 ? (
            <>
              <div 
                ref={carouselRef}
                className="flex md:grid md:grid-cols-3 gap-4 md:gap-8 overflow-x-auto snap-x snap-mandatory [&::-webkit-scrollbar]:hidden pb-8 px-4 md:px-0"
              >
                {featuredCars.map((car, index) => (
                  <motion.div 
                    initial={{ opacity: 0, y: 30 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, margin: "-50px" }}
                    transition={{ duration: 0.6, delay: index * 0.1, ease: "easeOut" }}
                    key={car.id} 
                    ref={(el) => { cardRefs.current[index] = el; }}
                    data-index={index}
                    className="w-[calc(100vw-56px)] md:w-full flex-shrink-0 snap-center px-1"
                  >
                    <CarCard car={car} />
                  </motion.div>
                ))}
              </div>
              <div className="flex flex-col items-center gap-6 md:hidden">
                <div className="flex justify-center gap-2">
                  {featuredCars.map((_, index) => (
                    <div 
                      key={index}
                      className={cn(
                        "h-2 rounded-full transition-all duration-300",
                        index === activeSlide ? "w-6 bg-brand-primary" : "w-2 bg-gray-300"
                      )}
                    />
                  ))}
                </div>
                <Button asChild variant="outline" className="w-full mt-6 h-12 md:h-14 font-bold border-brand-primary/20 text-brand-primary hover:bg-brand-primary/5 hover:text-brand-primary transition-all">
                  <Link to="/inventory" className="flex items-center justify-center">
                    View Full Inventory
                  </Link>
                </Button>
              </div>
            </>
          ) : (
            <div className="py-20 text-center">
              <p className="text-brand-primary text-xl font-bold mb-4 tracking-tight">Don't see what you're looking for?</p>
              <p className="text-slate-600 text-lg mb-8 max-w-2xl mx-auto">
                Our scouts have access to thousands of off-market vehicles across Atlantic Canada. Tell us your dream car, and we'll find it.
              </p>
              <Button asChild variant="brand" size="lg" className="rounded-xl">
                <Link to="/apply-now">Get Pre-Approved</Link>
              </Button>
            </div>
          )}
        </div>
      </motion.section>

      {/* Trade-In Appraisal Section hidden for now */}

      {/* Trust Bar - Premium Checklist Bridge */}
      <section className="py-8 md:py-16 bg-white relative z-10">
        <div className="max-w-[95%] lg:max-w-7xl mx-auto relative overflow-hidden rounded-[2rem] lg:rounded-[3rem] bg-brand-primary shadow-2xl py-8 md:py-16 px-4 md:px-6 scale-[0.98] transform-gpu hover:scale-100 transition-transform duration-700">
          {/* Abstract Glow Effects */}
          <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-brand-secondary/20 blur-[130px] rounded-full pointer-events-none translate-x-1/2 -translate-y-1/2" />
          <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-brand-secondary/10 blur-[150px] rounded-full pointer-events-none -translate-x-1/3 translate-y-1/3" />
          <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px]" />
          <div className="absolute left-0 right-0 top-0 -z-10 m-auto h-[310px] w-[310px] rounded-full bg-brand-secondary opacity-20 blur-[100px]" />

          <div className="max-w-6xl mx-auto relative z-10">
            <div className="grid grid-cols-3 gap-2 md:gap-8 divide-x divide-white/5">
              <div
                className="flex flex-col items-center text-center px-2 md:px-4 group"
              >
                <div className="h-10 w-10 md:h-12 md:w-12 mb-3 md:mb-6 rounded-[0.8rem] md:rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center group-hover:scale-110 group-hover:bg-brand-secondary/20 group-hover:border-brand-secondary/30 transition-all duration-500 shadow-2xl shadow-brand-secondary/10 backdrop-blur-sm">
                  <Star className="h-5 w-5 md:h-6 md:w-6 text-brand-secondary fill-brand-secondary group-hover:drop-shadow-[0_0_15px_rgba(115,128,255,0.5)] transition-all" />
                </div>
                <p className="font-display font-bold text-white text-[13px] md:text-xl lg:text-3xl mb-1 md:mb-3 tracking-tight leading-none">4.5/5 Rating</p>
                <p className="text-[8px] md:text-xs text-brand-secondary/80 font-bold uppercase tracking-[0.1em] md:tracking-[0.25em] max-w-[200px] leading-relaxed">Google Reviews</p>
              </div>

              <div
                className="flex flex-col items-center text-center px-2 md:px-4 group"
              >
                <div className="h-10 w-10 md:h-12 md:w-12 mb-3 md:mb-6 rounded-[0.8rem] md:rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center group-hover:scale-110 group-hover:bg-brand-secondary/20 group-hover:border-brand-secondary/30 transition-all duration-500 shadow-2xl shadow-brand-secondary/10 backdrop-blur-sm">
                  <Truck className="h-5 w-5 md:h-6 md:w-6 text-brand-secondary group-hover:drop-shadow-[0_0_15px_rgba(115,128,255,0.5)] transition-all" />
                </div>
                <p className="font-display font-bold text-white text-[13px] md:text-xl lg:text-3xl mb-1 md:mb-3 tracking-tight leading-none">Fast Delivery</p>
                <p className="text-[8px] md:text-xs text-brand-secondary/80 font-bold uppercase tracking-[0.1em] md:tracking-[0.25em] max-w-[200px] leading-relaxed">Atlantic Canada</p>
              </div>

              <div
                className="flex flex-col items-center text-center px-2 md:px-4 group"
              >
                <div className="h-10 w-10 md:h-12 md:w-12 mb-3 md:mb-6 rounded-[0.8rem] md:rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center group-hover:scale-110 group-hover:bg-brand-secondary/20 group-hover:border-brand-secondary/30 transition-all duration-500 shadow-2xl shadow-brand-secondary/10 backdrop-blur-sm">
                  <ShieldCheck className="h-5 w-5 md:h-6 md:w-6 text-brand-secondary group-hover:drop-shadow-[0_0_15px_rgba(115,128,255,0.5)] transition-all" />
                </div>
                <p className="font-display font-bold text-white text-[13px] md:text-xl lg:text-3xl mb-1 md:mb-3 tracking-tight leading-none">Protected</p>
                <p className="text-[8px] md:text-xs text-brand-secondary/80 font-bold uppercase tracking-[0.1em] md:tracking-[0.25em] max-w-[200px] leading-relaxed">150-Point Check</p>
              </div>
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
            <div className="text-center mb-10 md:mb-16">
              <div className="flex justify-center text-[#7380FF] mb-4 space-x-1">
                {[1, 2, 3, 4].map((i) => <Star key={i} className="h-5 w-5 md:h-6 md:w-6 fill-current" />)}
                <StarHalf className="h-5 w-5 md:h-6 md:w-6 fill-current" />
              </div>
              <p className="text-gray-400 font-bold uppercase tracking-[0.2em] text-xs">Rated 4.5/5 · 416 Google reviews</p>
            </div>

            <div
              ref={testimonialsCarouselRef}
              className="flex md:grid md:grid-cols-3 gap-4 md:gap-10 overflow-x-auto snap-x snap-mandatory [&::-webkit-scrollbar]:hidden pb-8 px-4 md:px-0"
            >
              {[
                {
                  name: "Jennifer L.",
                  location: "Halifax, NS",
                  text: "The best car buying experience I've ever had. No pressure, completely online, and they delivered my new SUV right to my door. Highly recommend VAC!",
                },
                {
                  name: "Mark T.",
                  location: "Moncton, NB",
                  text: "I was worried about my credit, but VAC got me approved in minutes. The process was transparent and the car is in perfect condition.",
                },
                {
                  name: "Robert S.",
                  location: "St. John's, NL",
                  text: "Incredible service. I did everything from my phone. The VAC warranty gave me the confidence to buy without seeing it in person first.",
                },
              ].map((review, i) => (
                <motion.div
                  key={i}
                  ref={(el) => { testimonialsCardRefs.current[i] = el; }}
                  data-index={i}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: i * 0.1 }}
                  className="w-[calc(100vw-56px)] md:w-full flex-shrink-0 snap-center p-8 md:p-12 rounded-[2.5rem] bg-white border border-gray-100 shadow-sm hover:shadow-xl transition-all duration-500"
                >
                  <p className="text-gray-500 italic mb-10 leading-relaxed text-lg">"{review.text}"</p>
                  <div>
                    <p className="font-bold text-brand-primary uppercase tracking-widest text-sm mb-1">{review.name}</p>
                    <p className="text-xs text-gray-400 font-bold uppercase tracking-widest">{review.location}</p>
                  </div>
                </motion.div>
              ))}
            </div>
            <div className="flex justify-center gap-2 md:hidden">
              {[0, 1, 2].map((index) => (
                <div
                  key={index}
                  className={cn(
                    "h-2 rounded-full transition-all duration-300",
                    index === activeTestimonialSlide ? "w-6 bg-brand-primary" : "w-2 bg-gray-300"
                  )}
                />
              ))}
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
          <div className="text-center mb-12 md:mb-24">
            <h2 className="text-4xl md:text-6xl font-display font-bold text-brand-primary mb-6">How It Works</h2>
            <p className="text-gray-500 text-xl max-w-2xl mx-auto">
              Shop first or Apply first. We've reimagined the car buying experience to be completely online and transparent.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-16 relative">
            {steps.map((step, index) => (
              <motion.div
                key={step.title}
                initial={{ opacity: 0, scale: 0.9 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true, margin: "-100px" }}
                transition={{ duration: 0.7, delay: index * 0.2, ease: "easeOut" }}
                className="flex flex-col items-center text-center group"
              >
                <div className="h-24 w-24 rounded-[2rem] bg-brand-primary text-white flex items-center justify-center mb-10 shadow-2xl shadow-brand-primary/20 group-hover:bg-[#7380FF] group-hover:rotate-6 transition-all duration-500">
                  <step.icon className="h-10 w-10" />
                </div>
                <div className="flex items-center justify-center mb-6">
                  <span className="text-xs font-bold text-[#7380FF] uppercase tracking-[0.2em] bg-[#7380FF]/5 px-5 py-2 rounded-full">Step 0{index + 1}</span>
                </div>
                <h3 className="text-2xl font-display font-bold text-brand-primary mb-5">{step.title}</h3>
                <p className="text-lg text-gray-500 leading-relaxed max-w-sm">{step.description}</p>
              </motion.div>
            ))}
          </div>

          <div className="mt-16 text-center">
            <Button asChild size="lg" className="bg-[#7380FF] hover:bg-[#7380FF]/90 text-white px-12 py-8 text-xl font-bold rounded-xl">
              <Link to="/apply-now">Get Pre-Approved</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Peace of Mind Section */}
      <motion.section 
        initial={{ opacity: 0, y: 40 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className="py-14 md:py-24 bg-white"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-4xl md:text-6xl font-display font-bold text-brand-primary text-center mb-20">
            Peace of Mind, Guaranteed
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
            <div className="bg-white p-10 rounded-[2.5rem] shadow-sm border border-gray-100 hover:shadow-xl transition-all duration-500 group">
              <div className="h-16 w-16 bg-[#7380FF]/5 rounded-2xl flex items-center justify-center mb-8 group-hover:bg-[#7380FF] group-hover:text-white transition-all duration-500">
                <ShieldCheck className="h-8 w-8 text-[#7380FF] group-hover:text-white" />
              </div>
              <h3 className="text-2xl font-bold text-brand-primary mb-4">VAC Warranty Included</h3>
              <p className="text-gray-500 text-lg leading-relaxed">Every vehicle is backed by a comprehensive warranty — drive off with total confidence, not fingers crossed.</p>
            </div>
            <div className="bg-white p-10 rounded-[2.5rem] shadow-sm border border-gray-100 hover:shadow-xl transition-all duration-500 group">
              <div className="h-16 w-16 bg-[#7380FF]/5 rounded-2xl flex items-center justify-center mb-8 group-hover:bg-[#7380FF] group-hover:text-white transition-all duration-500">
                <Truck className="h-8 w-8 text-[#7380FF] group-hover:text-white" />
              </div>
              <h3 className="text-2xl font-bold text-brand-primary mb-4">Delivered to Your Door</h3>
              <p className="text-gray-500 text-lg leading-relaxed">We bring your vehicle to you anywhere in Nova Scotia, New Brunswick, PEI, and Newfoundland — no dealership visit required.</p>
            </div>
            <div className="bg-white p-10 rounded-[2.5rem] shadow-sm border border-gray-100 hover:shadow-xl transition-all duration-500 group">
              <div className="h-16 w-16 bg-[#7380FF]/5 rounded-2xl flex items-center justify-center mb-8 group-hover:bg-[#7380FF] group-hover:text-white transition-all duration-500">
                <TrendingUp className="h-8 w-8 text-[#7380FF] group-hover:text-white" />
              </div>
              <h3 className="text-2xl font-bold text-brand-primary mb-4">Transparent Pricing</h3>
              <p className="text-gray-500 text-lg leading-relaxed">Real market-checked prices and clear bi-weekly payments up front. No haggling, no surprise fees at the finish line.</p>
            </div>
          </div>
        </div>
      </motion.section>

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
