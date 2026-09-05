import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate, useLocation } from 'react-router-dom';
import { getStoredUtms } from '@/lib/utms';
import { 
  db, 
  doc, 
  getDoc, 
  handleFirestoreError, 
  OperationType,
  assignLeadRoundRobin, 
  addDoc, 
  collection, 
  Timestamp,
  serverTimestamp
} from '@/lib/firebase';
import { Car } from '@/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { calculateBiWeeklyPayment, cn, maxFinancingTerm } from '@/lib/utils';
import { 
  ArrowLeft, 
  ChevronRight, 
  ChevronLeft,
  Fuel, 
  Gauge, 
  Settings2, 
  ShieldCheck, 
  Truck, 
  RotateCcw, 
  Calendar,
  Palette,
  CheckCircle2,
  Loader2,
  ArrowRight,
  Mail,
  Phone,
  MessageSquare,
  Send,
  FileText,
  TrendingDown,
  TrendingUp,
  X,
  Maximize2,
  RotateCw,
  Image as ImageIcon,
  Eye,
  Zap,
  Map,
  Compass,
  Bluetooth,
  Smartphone,
  Video,
  Sun,
  Wind,
  Music,
  Users,
  Key,
  Armchair,
  Thermometer,
  CloudRain,
  Navigation,
  Lock,
  Battery,
  ZapOff,
  CloudLightning,
  Headphones,
  Car as CarIcon,
  Search,
  Info,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Share2,
  Heart,
  Timer,
  Wifi,
  Usb,
  Monitor,
  Radio,
  Mic,
  BatteryCharging,
  Radar,
  Route,
  Disc,
  Disc3,
  ShieldAlert,
  Lightbulb,
  Snowflake,
  LifeBuoy
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { LeadForm } from '@/components/LeadForm';
import { toast } from 'sonner';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger,
  DialogClose
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import CarLoanCalculator from '@/components/calculator/CarLoanCalculator';
import VirtualTourWidget from '@/components/widgets/VirtualTourWidget';

// Shared phone mask — same live "(902) 555-0199" formatting as the application forms.
const formatPhoneShared = (value: string) => {
  if (!value) return value;
  const digits = value.replace(/[^\d]/g, '');
  if (digits.length < 4) return digits;
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
};

function CheckAvailabilityDialog({ car }: { car: Car }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    message: '',
  });

  useEffect(() => {
    if (location.pathname.endsWith('/success')) {
      setIsSuccess(true);
    }
  }, [location.pathname]);

  const formatPhoneNumber = (value: string) => {
    if (!value) return value;
    const phoneNumber = value.replace(/[^\d]/g, '');
    const phoneNumberLength = phoneNumber.length;
    if (phoneNumberLength < 4) return phoneNumber;
    if (phoneNumberLength < 7) {
      return `(${phoneNumber.slice(0, 3)}) ${phoneNumber.slice(3)}`;
    }
    return `(${phoneNumber.slice(0, 3)}) ${phoneNumber.slice(3, 6)}-${phoneNumber.slice(6, 10)}`;
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatPhoneNumber(e.target.value);
    setFormData({ ...formData, phone: formatted });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const response = await fetch('/api/check-availability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          ...getStoredUtms(),
          ...formData,
          vehicleId: car.id,
          vehicleName: `${car.year} ${car.make} ${car.model}`,
          vehicleUrl: window.location.href
        })
      });

      clearTimeout(timeoutId);
      if (!response.ok) throw new Error('Failed to send lead');
      setIsSuccess(true);
      // Navigate to success URL
      const currentPath = location.pathname;
      if (!currentPath.endsWith('/success')) {
        navigate(`${currentPath}/success`, { replace: true });
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.error("Check availability timed out");
        toast.error('Request timed out. Please try again.');
      } else {
        console.error(error);
        toast.error('Failed to send request. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button 
          className="w-full h-14 text-[16px] font-bold bg-slate-900 hover:bg-slate-800 text-white shadow-lg shadow-slate-900/10 transition-all flex items-center justify-center rounded-xl active:scale-[0.98]"
        >
          <Calendar className="mr-2 h-5 w-5" strokeWidth={2} />
          Check Availability
        </Button>
      </DialogTrigger>
      <DialogContent 
        showCloseButton={false} 
        overlayClassName="backdrop-blur-md bg-slate-900/40"
        className="max-w-xl rounded-2xl p-0 overflow-hidden border border-slate-200 shadow-2xl bg-white fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-2rem)] md:w-full animate-in fade-in zoom-in-95 duration-200"
      >
        <div className="flex flex-col">
          {isSuccess ? (
            <div className="p-12 text-center space-y-6 flex-1 flex flex-col justify-center bg-white">
              <div className="h-20 w-20 bg-green-50 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle2 className="h-10 w-10 text-green-500" />
              </div>
              <h2 className="text-3xl font-bold text-slate-900">Thank you!</h2>
              <p className="text-slate-500 leading-relaxed">
                A specialist will contact you shortly.
              </p>
              <DialogClose asChild>
                <Button className="w-full h-14 rounded-xl bg-[#7380FF] text-white font-bold hover:brightness-110 transition-all duration-300">Close</Button>
              </DialogClose>
            </div>
          ) : (
            <div className="bg-white">
              <div className="px-8 pt-8 pb-4 relative">
                <DialogHeader>
                  <DialogTitle className="text-xl font-bold text-slate-900">Check Availability</DialogTitle>
                  <DialogDescription className="text-sm text-slate-500 mt-1">
                    Enter your details and our team will reach out shortly.
                  </DialogDescription>
                </DialogHeader>
                <DialogClose className="absolute top-6 right-6 text-slate-400 hover:text-slate-900 transition-colors">
                  <X className="h-6 w-6" />
                </DialogClose>
              </div>

              <form onSubmit={handleSubmit} className="px-8 pb-8 space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="name" className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Full Name</Label>
                  <Input 
                    id="name" 
                    required 
                    placeholder="John Doe"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="h-12 rounded-lg bg-white border-slate-200 text-slate-900 focus:border-[#7380FF] focus:ring-4 focus:ring-[#7380FF]/10 transition-all" 
                  />
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="email" className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Email Address</Label>
                    <Input 
                      id="email" 
                      type="email" 
                      required 
                      placeholder="john@example.com"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      className="h-12 rounded-lg bg-white border-slate-200 text-slate-900 focus:border-[#7380FF] focus:ring-4 focus:ring-[#7380FF]/10 transition-all" 
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="phone" className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Phone Number</Label>
                    <Input 
                      id="phone" 
                      required 
                      placeholder="(555) 000-0000"
                      value={formData.phone}
                      onChange={handlePhoneChange}
                      className="h-12 rounded-lg bg-white border-slate-200 text-slate-900 focus:border-[#7380FF] focus:ring-4 focus:ring-[#7380FF]/10 transition-all" 
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="message" className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">MESSAGE (OPTIONAL)</Label>
                  <Textarea 
                    id="message" 
                    rows={2}
                    placeholder="I'm interested in this vehicle..."
                    value={formData.message}
                    onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                    className="rounded-lg bg-white border-slate-200 text-slate-900 focus:border-[#7380FF] focus:ring-4 focus:ring-[#7380FF]/10 transition-all resize-none" 
                  />
                </div>

                <Button 
                  type="submit" 
                  disabled={isSubmitting}
                  className="w-full h-14 rounded-xl bg-[#7380FF] text-white font-bold hover:bg-[#5e41cc] transition-all shadow-lg shadow-[#7380FF]/20 mt-4 h-14"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    "Send Inquiry"
                  )}
                </Button>
                
                <p className="text-[10px] text-slate-400 text-center leading-relaxed">
                  By clicking "Send Inquiry", you agree to our <a href="/terms" className="text-[#7380FF] hover:underline">Terms</a> and <a href="/privacy" className="text-[#7380FF] hover:underline">Privacy Policy</a>.
                </p>
              </form>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// CarDetails component start
const getFeatureIcon = (feature: string) => {
  const f = feature.toLowerCase();

  // --- Technology & media ---
  if (f.includes('apple carplay') || f.includes('android auto') || f.includes('phone integration') || (f.includes('phone') && !f.includes('microphone'))) return Smartphone;
  if (f.includes('bluetooth')) return Bluetooth;
  if (f.includes('wi-fi') || f.includes('wifi') || f.includes('hotspot')) return Wifi;
  if (f.includes('usb') || f.includes('aux')) return Usb;
  if (f.includes('touch screen') || f.includes('touchscreen') || f.includes('screen') || f.includes('display') || f.includes('infotainment')) return Monitor;
  if (f.includes('navigation') || f.includes('gps')) return Map;
  if (f.includes('satellite') || f.includes('radio')) return Radio;
  if (f.includes('speaker') || f.includes('sound') || f.includes('audio') || f.includes('bose') || f.includes('premium sound')) return Music;
  if (f.includes('voice')) return Mic;

  // --- Safety & driver assist ---
  if (f.includes('blind spot')) return Eye;
  if (f.includes('camera') || f.includes('surround')) return Video;
  if (f.includes('cross traffic') || f.includes('collision') || f.includes('adaptive cruise') || f.includes('cruise control') || f.includes('radar') || f.includes('autonomous')) return Radar;
  if (f.includes('lane')) return Route;
  if (f.includes('brake') || f.includes('abs')) return Disc;
  if (f.includes('parking') || f.includes('distance') || f.includes('sensor')) return Radar;
  if (f.includes('airbag')) return ShieldAlert;
  if (f.includes('fog') || f.includes('headlight') || f.includes('led') || f.includes('light')) return Lightbulb;
  if (f.includes('emergency') || f.includes('assist') || f.includes('safety') || f.includes('security') || f.includes('anti') || f.includes('stability') || f.includes('traction')) return ShieldCheck;

  // --- Comfort & interior ---
  if (f.includes('sunroof') || f.includes('moonroof')) return Sun;
  if (f.includes('cooled') || f.includes('ventilated')) return Snowflake;
  if (f.includes('heated') || f.includes('mirror')) return Thermometer;
  if (f.includes('climate') || f.includes('a/c') || f.includes('air condition') || f.includes('temperature')) return Wind;
  if (f.includes('leather') || f.includes('seat') || f.includes('upholstery') || f.includes('lumbar') || f.includes('bucket')) return Armchair;
  if (f.includes('steering')) return LifeBuoy;
  if (f.includes('keyless') || f.includes('remote') || f.includes('smart key') || f.includes('smart card') || f.includes('push') || f.includes('start')) return Key;
  if (f.includes('charging')) return BatteryCharging;
  if (f.includes('rain')) return CloudRain;

  // --- Wheels & mechanical ---
  if (f.includes('wheel') || f.includes('tire') || f.includes('alloy') || f.includes('rim')) return Disc3;
  if (f.includes('awd') || f.includes('4wd') || f.includes('4x4') || f.includes('drivetrain')) return Compass;
  if (f.includes('tow') || f.includes('trailer') || f.includes('liftgate') || f.includes('roof rail') || f.includes('cargo')) return Truck;

  return CheckCircle2;
};

function CarfaxBadge({ vin }: { vin: string }) {
  const [reportUrl, setReportUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchCarfax() {
      try {
        const response = await fetch(`/api/carfax/report/${vin}`);
        if (response.ok) {
          const data = await response.json();
          // The carfax.ca API report-info endpoint usually returns linkInfo with a reportUrl
          const url = data.linkInfo?.reportUrl || data.reportUrl || data.url;
          if (url) {
            setReportUrl(url);
          }
        }
      } catch (err) {
        console.error("Carfax check failed", err);
      } finally {
        setLoading(false);
      }
    }
    if (vin) fetchCarfax();
  }, [vin]);

  if (loading || !reportUrl) return null;

  return (
    <a 
      href={reportUrl} 
      target="_blank" 
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 bg-white border border-slate-200 rounded-full px-3 py-1 hover:bg-slate-50 transition-all shadow-sm hover:shadow active:scale-[0.98] group"
    >
      <div className="flex items-center">
        <span className="text-[10px] font-black text-[#003888] tracking-tight">CAR</span>
        <span className="text-[10px] font-black text-[#E31837] tracking-tight">FAX</span>
        <span className="text-[10px] font-bold text-slate-400 ml-1">Canada</span>
      </div>
      <div className="h-3 w-[1px] bg-slate-200 mx-0.5" />
      <span className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">Report</span>
      <ExternalLink className="h-3 w-3 text-slate-400 group-hover:text-slate-600 transition-colors" />
    </a>
  );
}

export default function CarDetails() {
  const { id: routeId, slugWithId } = useParams<{ id?: string; slugWithId?: string }>();
  const id = React.useMemo(() => {
    if (routeId) return routeId;
    if (slugWithId) {
      const parts = slugWithId.split('-');
      return parts[parts.length - 1];
    }
    return undefined;
  }, [routeId, slugWithId]);

    const navigate = useNavigate();
    const location = useLocation();
  const [car, setCar] = useState<Car | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeImage, setActiveImage] = useState(0);
  const [viewMode, setViewMode] = useState<'exterior' | 'interior'>('exterior');
  const [scriptsReady, setScriptsReady] = useState(false);
  const [isGalleryOpen, setIsGalleryOpen] = useState(false);
  const [isLeadDialogOpen, setIsLeadDialogOpen] = useState(false);
  const [isFullWindowOpen, setIsFullWindowOpen] = useState(false);
  const [fullWindowView, setFullWindowView] = useState<'exterior' | 'interior'>('exterior');
  const carTitle = car ? `${car.year} ${car.make} ${car.model}` : 'Vehicle';
  const [isDesktopLightboxOpen, setIsDesktopLightboxOpen] = useState(false);
  const [showExtrasAll, setShowExtrasAll] = useState(false);
  const [lightboxActiveImage, setLightboxActiveImage] = useState(0);
  // "Request More Photos" — captures a lead into the CRM Inbox.
  const [photoReqOpen, setPhotoReqOpen] = useState(false);
  const [photoReqName, setPhotoReqName] = useState('');
  const [photoReqPhone, setPhotoReqPhone] = useState('');
  const [photoReqState, setPhotoReqState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const submitPhotoRequest = async () => {
    if (!photoReqName.trim() || photoReqPhone.replace(/\D/g, '').length < 10) { setPhotoReqState('error'); return; }
    setPhotoReqState('sending');
    try {
      const res = await fetch('/api/photo-request', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: photoReqName.trim(), phone: photoReqPhone.trim(), vehicle: carTitle, link: window.location.href }),
      });
      if (!res.ok) throw new Error();
      setPhotoReqState('sent');
    } catch { setPhotoReqState('error'); }
  };
  // Keyboard navigation while the desktop lightbox is open: ← → to browse, Esc to close.
  useEffect(() => {
    if (!isDesktopLightboxOpen) return;
    const n = car?.images?.length || 0;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' && n) setLightboxActiveImage((i) => (i + 1) % n);
      else if (e.key === 'ArrowLeft' && n) setLightboxActiveImage((i) => (i - 1 + n) % n);
      else if (e.key === 'Escape') setIsDesktopLightboxOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isDesktopLightboxOpen, car?.images?.length]);
  const [showMobileFooter, setShowMobileFooter] = useState(false);
  const carouselRef = React.useRef<HTMLDivElement>(null);
  const navRef = React.useRef<HTMLDivElement>(null);
  const overviewRef = React.useRef<HTMLDivElement>(null);
  const specsRef = React.useRef<HTMLDivElement>(null);
  const featuresRef = React.useRef<HTMLDivElement>(null);
  const paymentRef = React.useRef<HTMLDivElement>(null);
  const pannellumViewer = React.useRef<any>(null);
  const [activeSection, setActiveSection] = useState('overview');
  const [isDown, setIsDown] = useState(false);
  const [startX, setStartX] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [features, setFeatures] = useState<string[]>([]);
  const [loadingFeatures, setLoadingFeatures] = useState(false);
  const [categorizedFeatures, setCategorizedFeatures] = useState<{
    comfortAndConvenience: string[];
    entertainmentAndMedia: string[];
    safetyAndSecurity: string[];
    extrasAndPackages: string[];
  } | null>(null);

  const hasAnyFeatures = !!(
    categorizedFeatures && (
      categorizedFeatures.comfortAndConvenience.length > 0 ||
      categorizedFeatures.entertainmentAndMedia.length > 0 ||
      categorizedFeatures.safetyAndSecurity.length > 0 ||
      categorizedFeatures.extrasAndPackages.length > 0
    )
  );

  useEffect(() => {
    const fetchFeatures = async () => {
      // Prefer the categorized MarketCheck feature buckets stored on the car
      // (populated whenever a vehicle is saved in admin, and by the backfill).
      // These are the rich, curated features — use them before anything else.
      // Strip vague/noise entries MarketCheck sometimes returns so only real,
      // recognizable features show as tiles.
      const FEATURE_JUNK = /upgraded (tire type|wheel size|aux jack input|usb connection|reverse light)|^(automatic|cvt|manual) transmission$|compact suv|upper medium|mid-size|autonomous drive|driver bucket seat/i;
      const clean = (arr?: string[]) => (arr || []).filter((x) => x && !FEATURE_JUNK.test(x));
      const storedBuckets = {
        comfortAndConvenience: clean(car?.comfortAndConvenience),
        entertainmentAndMedia: clean(car?.entertainmentAndMedia),
        safetyAndSecurity: clean(car?.safetyAndSecurity),
        extrasAndPackages: clean(car?.extrasAndPackages),
      };
      const bucketTotal =
        storedBuckets.comfortAndConvenience.length +
        storedBuckets.entertainmentAndMedia.length +
        storedBuckets.safetyAndSecurity.length +
        storedBuckets.extrasAndPackages.length;
      if (bucketTotal >= 4) {
        setCategorizedFeatures(storedBuckets);
        setLoadingFeatures(false);
        return;
      }

      // If manual features are provided, use them and categorize them simply
      if (car?.features && car.features.length > 0) {
        console.log(`[Features] Using manual features:`, car.features);
        
        // Define category mappings based on the new master list
        const categories = {
          safety: [
            'Adaptive Cruise Control', 'Automatic Emergency Braking (AEB)', 'Blind Spot Monitoring',
            'Lane Keeping Assist', 'Rear Cross-Traffic Alert', '360-Degree Surround Camera',
            'Heads-Up Display (HUD)', 'Driver Attention/Drowsiness Alert', 'Blind Spot Monitor',
            'Backup Camera', 'Parking Sensors', 'Adaptive Cruise', 'Lane Departure Warning'
          ],
          comfort: [
            'Heated Front Seats', 'Heated Rear Seats', 'Ventilated/Cooled Front Seats',
            'Massaging Front Seats', 'Power-Adjustable Driver Seat (with Memory)',
            'Heated Steering Wheel', 'Dual-Zone Automatic Climate Control',
            'Leather / Premium Synthetic Upholstery', 'Leather Seats', 'A/C', 'Climate Control',
            'Power Windows', 'Power Locks', 'Keyless Entry', 'Remote Start', 'Third Row Seating',
            'Power-Adjustable Driver Seat', 'Sunroof', 'Panoramic Sunroof'
          ],
          technology: [
            'Wireless Apple CarPlay', 'Wireless Android Auto', 'Navigation System',
            'Premium Sound System', 'Wireless Smartphone Charging', 'Built-in Wi-Fi Hotspot',
            'AI Voice Assistant Integration', 'Bluetooth', 'Apple CarPlay', 'Android Auto',
            'Navigation', 'Infotainment', 'Premium Audio', 'Satellite Radio'
          ],
          mechanical: [
            'AWD', '4WD', 'Alloy Wheels', 'Turbo', 'Tow Package', 'Roof Rails',
            'DC Fast Charging Capability', 'One-Pedal Driving Mode',
            'V2L (Vehicle-to-Load) Power Outlets', 'Regenerative Braking Adjustment'
          ]
        };

        const categorized: Record<string, string[]> = {
          safety: [],
          comfort: [],
          technology: [],
          mechanical: []
        };

        // Sort items into standardized categories
        const allFeatures = [...new Set([...(car.features || []), ...(car.extrasAndPackages || [])])];
        
        allFeatures.forEach(feature => {
          if (categories.safety.includes(feature)) {
            categorized.safety.push(feature);
          } else if (categories.comfort.includes(feature)) {
            categorized.comfort.push(feature);
          } else if (categories.technology.includes(feature)) {
            categorized.technology.push(feature);
          } else if (categories.mechanical.includes(feature)) {
            categorized.mechanical.push(feature);
          } else {
            // Smart fallback based on keywords
            const f = feature.toLowerCase();
            if (f.includes('safety') || f.includes('assist') || f.includes('brake') || f.includes('camera')) categorized.safety.push(feature);
            else if (f.includes('seat') || f.includes('adjust') || f.includes('climate') || f.includes('comfort')) categorized.comfort.push(feature);
            else if (f.includes('audio') || f.includes('screen') || f.includes('connect') || f.includes('apple') || f.includes('android')) categorized.technology.push(feature);
            else categorized.mechanical.push(feature);
          }
        });

        setCategorizedFeatures({
          comfortAndConvenience: categorized.comfort,
          entertainmentAndMedia: categorized.technology,
          safetyAndSecurity: categorized.safety,
          extrasAndPackages: categorized.mechanical,
        });
        setLoadingFeatures(false);
        return;
      }

      if (!car?.vin) return;
      
      setLoadingFeatures(true);
      console.log(`[Features] Fetching for VIN: ${car.vin}`);
      try {
        // Fetch detailed categorized features from Marketcheck
        const mcResponse = await fetch(`/api/decode-vin/${car.vin}`);
        if (mcResponse.ok) {
          const mcResult = await mcResponse.json();
          console.log(`[Features] Received response from: ${mcResult.source}`, mcResult);
          if (mcResult.source === 'marketcheck-merged' || mcResult.source === 'marketcheck') {
            setCategorizedFeatures({
              comfortAndConvenience: mcResult.data.comfortAndConvenience || [],
              entertainmentAndMedia: mcResult.data.entertainmentAndMedia || [],
              safetyAndSecurity: mcResult.data.safetyAndSecurity || [],
              extrasAndPackages: mcResult.data.extrasAndPackages || [],
            });
            return; // Use Marketcheck if available
          }
        }

        // Fallback to existing features API
        const response = await fetch(`/api/vehicle-features/${car.vin}`);
        if (!response.ok) throw new Error('Failed to fetch features');
        const data = await response.json();
        const nhtsaFeatures: string[] = data.features || [];
        
        console.log(`[Features] Fallback to NHTSA, found ${nhtsaFeatures.length} features`);

        if (nhtsaFeatures.length > 0) {
          setCategorizedFeatures({
            comfortAndConvenience: [],
            entertainmentAndMedia: [],
            safetyAndSecurity: [],
            extrasAndPackages: nhtsaFeatures, // Put all in extras if not categorized
          });
        } else {
          // If no features at all, ensure we don't stay in infinite loading
          setCategorizedFeatures({
            comfortAndConvenience: [],
            entertainmentAndMedia: [],
            safetyAndSecurity: [],
            extrasAndPackages: [],
          });
        }
        setFeatures(nhtsaFeatures);
      } catch (err) {
        console.error('Error fetching features:', err);
      } finally {
        setLoadingFeatures(false);
      }
    };

    fetchFeatures();
  }, [car?.vin]);

  const scrollToSection = (sectionId: string, ref: React.RefObject<HTMLDivElement>) => {
    setActiveSection(sectionId);
    ref.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id);
          }
        });
      },
      { 
        rootMargin: '-100px 0px -40% 0px',
        threshold: 0
      }
    );

    const refs = [
      { id: 'overview', ref: overviewRef },
      { id: 'specifications', ref: specsRef },
      { id: 'features', ref: featuresRef },
      { id: 'payment', ref: paymentRef }
    ];

    refs.forEach(({ ref }) => {
      if (ref.current) observer.observe(ref.current);
    });

    return () => observer.disconnect();
  }, [loading, loadingFeatures, hasAnyFeatures]);

  // Lock body scroll when gallery is open
  useEffect(() => {
    if (isGalleryOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => { document.body.style.overflow = 'unset'; };
  }, [isGalleryOpen]);

  useEffect(() => {
    if (navRef.current) {
      navRef.current.scrollLeft = 0;
    }
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      const scrollY = window.scrollY;
      setShowMobileFooter(scrollY > 50); // Show almost immediately when scrolling starts
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    const carousel = carouselRef.current;
    if (!carousel) return;
    const handleScroll = () => {
      setScrollLeft(carousel.scrollLeft);
    };
    carousel.addEventListener('scroll', handleScroll);
    return () => carousel.removeEventListener('scroll', handleScroll);
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDown(true);
    setStartX(e.pageX - (carouselRef.current?.offsetLeft || 0));
    setScrollLeft(carouselRef.current?.scrollLeft || 0);
  };

  const handleMouseLeave = () => setIsDown(false);
  const handleMouseUp = () => setIsDown(false);
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDown) return;
    e.preventDefault();
    const x = e.pageX - (carouselRef.current?.offsetLeft || 0);
    const walk = (x - startX) * 2;
    if (carouselRef.current) {
      carouselRef.current.scrollLeft = scrollLeft - walk;
      setScrollLeft(carouselRef.current.scrollLeft);
    }
  };

  useEffect(() => {
    // Check if scripts are already loaded from index.html
    const checkScripts = () => {
      if ((window as any).pannellum && (window as any).Sirv) {
        setScriptsReady(true);
      } else {
        // Fallback check in case they are still loading
        const interval = setInterval(() => {
          if ((window as any).pannellum && (window as any).Sirv) {
            setScriptsReady(true);
            clearInterval(interval);
          }
        }, 500);
        return () => clearInterval(interval);
      }
    };
    
    return checkScripts();
  }, []);

  useEffect(() => {
    const rawInteriorPhoto = car?.interior360Photo || car?.interior360Url;
    
    let interiorPhoto = rawInteriorPhoto;
    if (rawInteriorPhoto && rawInteriorPhoto.includes('sirv.com')) {
      try {
        const url = new URL(rawInteriorPhoto);
        url.searchParams.set('q', '100');
        url.searchParams.set('w', '4096');
        interiorPhoto = url.toString();
      } catch (e) {
        console.error("Invalid interior photo URL", e);
      }
    }

    // Handle Viewers
    if (scriptsReady && (window as any).pannellum && (window as any).Sirv) {
      // Cleanup previous Pannellum instance
      if (pannellumViewer.current) {
        try {
          pannellumViewer.current.destroy();
        } catch (e) {
          console.warn("Error destroying Pannellum viewer", e);
        }
        pannellumViewer.current = null;
      }

      if (isFullWindowOpen) {
        // Full Window Mode
        if (fullWindowView === 'interior' && interiorPhoto) {
          setTimeout(() => {
            pannellumViewer.current = (window as any).pannellum.viewer('full-panorama', {
              "type": "equirectangular",
              "panorama": interiorPhoto,
              "autoLoad": true,
              "autoRotate": -2,
              "showControls": true,
              "mouseZoom": true,
              "hfov": 110,
              "minHfov": 50,
              "maxHfov": 120,
              "orientationOnDevices": false,
              "crossOrigin": "anonymous"
            });
            setTimeout(() => window.dispatchEvent(new Event('resize')), 100);
          }, 100);
        } else if (fullWindowView === 'exterior') {
          setTimeout(() => {
            const sirvEl = document.getElementById('sirv-full');
            if (sirvEl && (window as any).Sirv) {
              (window as any).Sirv.start(sirvEl);
              setTimeout(() => window.dispatchEvent(new Event('resize')), 300);
            }
          }, 300);
        }
      } else {
        // VDP Mode
        if (viewMode === 'interior' && interiorPhoto) {
          setTimeout(() => {
            pannellumViewer.current = (window as any).pannellum.viewer('panorama', {
              "type": "equirectangular",
              "panorama": interiorPhoto,
              "autoLoad": true,
              "autoRotate": -2,
              "showControls": true,
              "mouseZoom": true,
              "hfov": 110,
              "minHfov": 50,
              "maxHfov": 120,
              "orientationOnDevices": false,
              "crossOrigin": "anonymous"
            });
            setTimeout(() => window.dispatchEvent(new Event('resize')), 200);
          }, 200);
        } else if (viewMode === 'exterior' && (window as any).Sirv) {
          setTimeout(() => {
            const sirvEl = document.getElementById('sirv-vdp');
            if (sirvEl) {
              (window as any).Sirv.start(sirvEl);
              setTimeout(() => window.dispatchEvent(new Event('resize')), 300);
            }
          }, 300);
        }
      }
    }

    return () => {
      if (pannellumViewer.current) {
        try {
          pannellumViewer.current.destroy();
        } catch (e) {
          // Ignore
        }
        pannellumViewer.current = null;
      }
      if ((window as any).Sirv) {
        try {
          (window as any).Sirv.stop();
        } catch (e) {
          // Ignore
        }
      }
    };
  }, [viewMode, car?.interior360Photo, car?.interior360Url, scriptsReady, isFullWindowOpen, fullWindowView]);

  useEffect(() => {
    if (isFullWindowOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isFullWindowOpen]);

  useEffect(() => {
    if (!id) return;

    const fetchCar = async () => {
      try {
        const carDoc = await getDoc(doc(db, 'inventory', id));
        if (carDoc.exists()) {
          const data = carDoc.data();
          setCar({ 
            id: carDoc.id, 
            ...data,
            price: data.price === 0 ? 19995 : data.price
          } as Car);
        } else {
          setError('Vehicle not found.');
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, `inventory/${id}`);
        setError('Error loading vehicle details.');
      } finally {
        setLoading(false);
      }
    };

    fetchCar();
  }, [id]);

  const isNewlyAdded = React.useMemo(() => {
    if (!car?.createdAt || car?.status === 'Sold') return false;
    try {
      const createdDate = car.createdAt.toDate ? car.createdAt.toDate() : new Date(car.createdAt);
      if (isNaN(createdDate.getTime())) return false;
      
      const now = new Date();
      const diffInDays = (now.getTime() - createdDate.getTime()) / (1000 * 3600 * 24);
      return diffInDays <= 4;
    } catch (e) {
      return false;
    }
  }, [car?.createdAt, car?.status]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="h-12 w-12 text-brand-primary animate-spin" />
      </div>
    );
  }

  if (error || !car) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="text-center max-w-md">
          <h2 className="text-3xl font-display font-bold text-brand-primary mb-4">Vehicle Not Found</h2>
          <p className="text-gray-500 mb-8">The vehicle you are looking for may have been sold or removed from our inventory.</p>
          <Button asChild className="bg-brand-primary hover:bg-brand-secondary">
            <Link to="/inventory">Back to Inventory</Link>
          </Button>
        </div>
      </div>
    );
  }

  const financeTerm = maxFinancingTerm(Number(car.year), Number(car.mileage));
  const biWeekly = financeTerm ? calculateBiWeeklyPayment(Number(car.price), 6.99, financeTerm) : 0;

  const formatSoldDate = (soldAt: any) => {
    if (!soldAt) return '';
    try {
      const d = soldAt.toDate ? soldAt.toDate() : new Date(soldAt);
      return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    } catch (e) {
      return '';
    }
  };
  
  const soldDateStr = car.status === 'Sold' ? formatSoldDate(car.soldAt) : '';

  const VehicleInfo = (
    <div className="space-y-4">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2 mb-1">
          {isNewlyAdded && (
            <div className="bg-emerald-500 text-white rounded-lg px-2.5 py-1 shadow-md text-[10px] font-black uppercase tracking-wider flex items-center gap-1 animate-pulse">
              <div className="h-1.5 w-1.5 rounded-full bg-white" />
              Newly Added
            </div>
          )}
          {car.marketPriceRating && car.marketPriceRating !== 'High Price' && (
            <div className={cn(
              "rounded-lg px-2.5 py-1 shadow-md text-[10px] font-black uppercase tracking-wider flex items-center gap-1",
              car.marketPriceRating.includes('Great') || car.marketPriceRating.includes('Good')
                ? "bg-blue-600 text-white"
                : "bg-slate-100 text-slate-600"
            )}>
              <TrendingDown className="h-3 w-3" />
              {car.marketPriceRating}
              {typeof car.marketPriceDifference === 'number' && car.marketPriceDifference > 0 && (
                <span className="font-bold">· ${car.marketPriceDifference.toLocaleString()} below market</span>
              )}
            </div>
          )}
          {car.marketPriceRating && car.marketPriceRating !== 'High Price' && car.marketSampleSize ? (
            <p className="w-full text-[11px] text-slate-400 -mt-0.5">
              Based on {car.marketSampleSize} similar listings across Canada
            </p>
          ) : null}
          <h1 className="text-[22px] font-bold tracking-tight text-slate-900">
            {car.year} {car.make} {car.model}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <p className="text-[15px] font-medium text-slate-500">{car.trim}</p>
          {car.mileage && (
            <>
              <span className="text-slate-300">•</span>
              <p className="text-[15px] font-medium text-slate-500">
                {Number(car.mileage).toLocaleString()} km
              </p>
            </>
          )}
        </div>

        <div className="flex flex-wrap gap-2 mt-2">
          {car.accidents === 0 && (
            <div className="flex items-center gap-1 bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border border-emerald-100">
              <ShieldCheck className="h-3 w-3" />
              Accident Free
            </div>
          )}
          {car.vin && <CarfaxBadge vin={car.vin} />}
          {car.status && car.status !== 'For Sale' && (
            <div className={cn(
              "border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.2em] rounded-sm",
              car.status === 'Sold' ? "border-red-100 text-red-500 bg-red-50" : "border-amber-100 text-amber-500 bg-amber-50"
            )}>
              {car.status} {car.status === 'Sold' && soldDateStr ? `on ${soldDateStr}` : ''}
            </div>
          )}
          {car.status === 'In Recon' && (
            <p className="basis-full text-[13px] text-slate-500 leading-snug mt-1">
              Just arrived — every VAC vehicle completes a full MVI and reconditioning before
              delivery. Full photos coming after detailing; message us anytime for current
              photos, or reserve it now and it&rsquo;s yours the day it&rsquo;s ready.
            </p>
          )}
        </div>
        
        <div className="mt-4 space-y-3 hidden md:block">
          {car.status === 'Sold' ? (
            <div className="flex flex-col gap-1 border-b border-gray-100 pb-4">
              <span className="text-4xl font-black text-red-500 tracking-widest uppercase">
                SOLD
              </span>
              {soldDateStr && (
                <span className="text-sm font-bold text-red-400 opacity-80 mt-1">
                  Sold on {soldDateStr}
                </span>
              )}
            </div>
          ) : car.status === 'Pending Sale' ? (
            <div className="flex flex-col gap-1 border-b border-gray-100 pb-4">
              <span className="text-4xl font-black text-amber-500 tracking-widest uppercase">
                PENDING SALE
              </span>
            </div>
          ) : (
            <div className="flex flex-col gap-1 border-b border-gray-100 pb-4">
              {financeTerm ? (
                <div className="flex items-baseline gap-1.5">
                  <span className="text-4xl font-black text-slate-900 tracking-tight">
                    ${Math.round(biWeekly).toLocaleString()}
                  </span>
                  <span className="text-lg font-bold text-slate-400">/bi-weekly</span>
                </div>
              ) : (
                <span className="text-lg font-bold text-slate-500">Contact us for financing options</span>
              )}
              <div className="flex items-center gap-1.5">
                <span className="text-sm text-slate-500 font-bold">
                  Cash Price: ${(car.price || 0).toLocaleString()}
                </span>
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <div className="inline-flex items-center gap-1.5 bg-slate-50 border border-slate-100 rounded-full px-3 py-1">
              <Truck strokeWidth={1.5} className="h-3 w-3 text-slate-500" />
              <span className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">Doorstep Delivery Available</span>
            </div>
          </div>
          
          <p className="text-xs text-gray-400 italic">{financeTerm ? `Estimated at 6.99% over ${financeTerm} months O.A.C.` : 'Financing terms vary for this vehicle — contact us.'}</p>
        </div>
      </div>
    </div>
  );

  return (
    <Dialog open={isLeadDialogOpen} onOpenChange={setIsLeadDialogOpen}>
      <div className="min-h-screen bg-white pt-16 md:pt-20 pb-24">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
          {/* Breadcrumbs */}
          <nav className="hidden lg:flex items-center space-x-2 text-sm text-gray-400 lg:mb-8">
            <Link to="/" className="hover:text-brand-primary transition-colors">Home</Link>
          <ChevronRight className="h-4 w-4" />
          <Link to="/inventory" className="hover:text-brand-primary transition-colors">Inventory</Link>
          <ChevronRight className="h-4 w-4" />
          <span className="text-brand-primary font-bold">{car.make} {car.model}</span>
        </nav>

        <div className="md:grid md:grid-cols-12 md:gap-12 items-start mt-0 md:mt-0">
          {/* Left Column (Viewer + Gallery) */}
          <div className="md:col-span-8 flex flex-col gap-4 md:gap-6">
            {/* 360 Viewer / Main Image */}
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="relative -mx-3 md:mx-0 w-[calc(100%+24px)] md:w-full aspect-[4/3] overflow-hidden bg-white group border-b border-slate-100 rounded-none md:rounded-2xl"
            >
              {!isFullWindowOpen ? (
                <>
                  {viewMode === 'interior' ? (
                    <div key="vdp-interior" className="absolute inset-0 w-full h-full bg-gray-900 overflow-hidden">
                      <div id="panorama" className="w-full h-full force-fill"></div>
                    </div>
                  ) : car.sirvUrl ? (
                    <div key="vdp-exterior" className="absolute inset-0 w-full h-full overflow-hidden bg-white">
                      <div id="sirv-vdp" className="Sirv !w-full !h-full" data-src={car.sirvUrl} data-options="fit:cover; autostart:false; margin:0; fullscreen.enable:false; zoom.enable:false; scrollbox.hide:true;"></div>
                    </div>
                  ) : (
                    <div key="vdp-static" className="absolute inset-0 w-full h-full bg-white flex justify-center items-center">
                      <img 
                        src={car.images?.[activeImage] || 'https://picsum.photos/seed/car/800/600'} 
                        alt={`${car.year} ${car.make} ${car.model}`}
                        className="w-full h-full object-contain"
                        referrerPolicy="no-referrer"
                      />
                    </div>
                  )}
                </>
              ) : (
                <div className="absolute inset-0 bg-gray-100 flex items-center justify-center">
                  <Loader2 className="h-8 w-8 text-brand-primary animate-spin" />
                </div>
              )}

              {/* Full Screen Button moved to bottom right */}
              <button 
                onClick={() => {
                  setFullWindowView(viewMode);
                  setIsFullWindowOpen(true);
                }}
                className="absolute bottom-4 right-4 z-30 p-2.5 bg-black/40 hover:bg-black/60 backdrop-blur-md rounded-full text-white transition-all shadow-lg border border-white/10"
                title="Full Screen"
              >
                <Maximize2 strokeWidth={1.5} className="h-4 w-4" />
              </button>

              {/* Exterior / Interior toggle — top-center so it doesn't cover the vehicle */}
              <div
                className="absolute top-4 z-30 flex items-center bg-white/85 backdrop-blur-md p-1 rounded-full shadow-md border border-white/60"
                style={{ left: '50%', transform: 'translateX(-50%)' }}
              >
                <button
                  onClick={() => setViewMode('exterior')}
                  className={`px-5 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-wider transition-all ${viewMode === 'exterior' ? 'bg-brand-primary text-white shadow-sm' : 'text-brand-primary/60 hover:text-brand-primary'}`}
                >
                  Exterior
                </button>
                {(car?.interior360Photo || car?.interior360Url) && (
                  <button
                    onClick={() => setViewMode('interior')}
                    className={`px-5 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-wider transition-all ${viewMode === 'interior' ? 'bg-brand-primary text-white shadow-sm' : 'text-brand-primary/60 hover:text-brand-primary'}`}
                  >
                    Interior
                  </button>
                )}
              </div>
            </motion.div>

            {/* Request More Photos — always available on thin galleries, even 1-photo cars */}
            {(car.images?.length || 0) <= 3 && car.status !== 'Sold' && (
              <div className="pt-4 px-3 md:px-0">
                <button onClick={() => setPhotoReqOpen(true)}
                  className="text-[13px] font-bold text-brand-accent border border-brand-accent/30 rounded-full px-4 py-2 hover:bg-brand-accent/5 transition">
                  📸 Request More Photos
                </button>
              </div>
            )}

            {/* Carousel Gallery - Full Bleed on Mobile (pointless with a single photo) */}
            {car.images && car.images.length > 1 && (
              <div className="space-y-3 px-0 md:px-0 pt-4 pb-0 -mx-3 md:mx-0">
                <h3 className="hidden md:block text-[18px] font-bold text-slate-800 px-3 md:px-0">Vehicle Gallery</h3>
                <div className="relative group">
                  <div 
                    ref={carouselRef}
                    onMouseDown={handleMouseDown}
                    onMouseLeave={handleMouseLeave}
                    onMouseUp={handleMouseUp}
                    onMouseMove={handleMouseMove}
                    className="flex overflow-x-auto snap-x snap-mandatory gap-1 md:gap-4 pb-1 [&::-webkit-scrollbar]:hidden cursor-grab active:cursor-grabbing select-none px-3 md:px-0"
                  >
                    {car.images.map((img, index) => (
                      <button 
                        key={index}
                        style={{ transform: 'translateZ(0)', backfaceVisibility: 'hidden', willChange: 'transform, opacity' }}
                        onClick={() => {
                          setActiveImage(index);
                          setViewMode('exterior');
                          if (window.innerWidth < 1024) {
                            setIsGalleryOpen(true);
                          } else {
                            setLightboxActiveImage(index);
                            setIsDesktopLightboxOpen(true);
                          }
                        }}
                        className={`flex-shrink-0 w-[140px] sm:w-[150px] aspect-[4/3] overflow-hidden border transition-all duration-400 ease-in-out snap-center rounded-none relative flex justify-center items-center bg-gray-50 ${activeImage === index && viewMode === 'exterior' ? 'border-brand-primary z-10 scale-100 shadow-lg' : 'border-transparent opacity-60 hover:opacity-100'}`}
                      >
                        <img src={img || null} alt="" className="w-full h-full object-contain" referrerPolicy="no-referrer" />
                      </button>
                    ))}
                  </div>
                  
                  {/* Desktop Arrows */}
                  <button 
                    onClick={() => carouselRef.current?.scrollBy({ left: -300, behavior: 'smooth' })}
                    className="hidden lg:flex absolute left-2 top-1/2 -translate-y-1/2 p-3 bg-white/40 backdrop-blur-md rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <ChevronLeft strokeWidth={1.5} className="h-6 w-6 text-brand-primary" />
                  </button>
                  <button 
                    onClick={() => carouselRef.current?.scrollBy({ left: 300, behavior: 'smooth' })}
                    className="hidden lg:flex absolute right-2 top-1/2 -translate-y-1/2 p-3 bg-white/40 backdrop-blur-md rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <ChevronRight strokeWidth={1.5} className="h-6 w-6 text-brand-primary" />
                  </button>
                </div>
                
                
                {/* Progress Bar */}

                <div className="hidden lg:block h-1 w-full bg-gray-200 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-brand-primary transition-all duration-300"
                    style={{ width: `${(scrollLeft / ((carouselRef.current?.scrollWidth || 1) - (carouselRef.current?.clientWidth || 1))) * 100}%` }}
                  />
                </div>
              </div>
            )}

            {/* Mobile: Vehicle Details Order Cleanup */}
            <div className="md:hidden">
              {/* Trust Bar - Moved above title for Clutch layout */}
              <div className="px-5 pt-3 pb-1 flex flex-wrap gap-2 bg-white">
                {car.status !== 'In Recon' && (
                  <>
                    <div className="rounded-full border border-slate-100 px-3 py-1 text-[10px] font-bold text-slate-600 uppercase tracking-widest bg-white">
                      150-Point Inspected
                    </div>
                    <div className="rounded-full border border-slate-100 px-3 py-1 text-[10px] font-bold text-emerald-600 uppercase tracking-widest bg-white">
                      360° Verified
                    </div>
                  </>
                )}
                {car.accidents === 0 && (
                  <div className="rounded-full border border-slate-100 px-3 py-1 text-[10px] font-bold text-slate-600 uppercase tracking-widest bg-white">
                    Accident Free
                  </div>
                )}
                {car.vin && <CarfaxBadge vin={car.vin} />}
                {car.owners === 1 && (
                  <div className="rounded-full border border-slate-100 px-3 py-1 text-[10px] font-bold text-slate-600 uppercase tracking-widest bg-white">
                    One Owner
                  </div>
                )}
              </div>

              {/* Title Info */}
              <div className="px-5 pt-1 pb-2 bg-white">
                {VehicleInfo}
              </div>
            </div>

            {/* Mobile: Check Availability Action removed from here and moved below Features */}
          
            {/* Details Sections */}
            <div className="flex flex-col gap-0">
              {/* Overview Section */}
              <div 
                ref={overviewRef} 
                id="overview" 
                className="scroll-mt-32"
              >
                {/* (Removed the old hard-coded highlights bar — it duplicated the
                    Features & Equipment grid and showed generic features that
                    weren't always on the actual vehicle.) */}
              </div>

              {/* Pill Navigation */}
              <div className="hidden lg:block sticky top-20 z-40 w-full pointer-events-none mb-12">
                <div ref={navRef} className="flex justify-start overflow-x-auto [&::-webkit-scrollbar]:hidden pointer-events-auto py-4 ps-4">
                  <div className="flex flex-nowrap gap-2 bg-white/90 backdrop-blur-md p-1 rounded-full border border-slate-100 w-fit">
                    {['overview', 'specifications', ...((hasAnyFeatures || loadingFeatures) ? ['features'] : []), 'payment'].map((section) => (
                      <button
                        key={section}
                        onClick={() => {
                          if (section === 'overview') scrollToSection('overview', overviewRef);
                          else if (section === 'specifications') scrollToSection('specifications', specsRef);
                          else if (section === 'features') scrollToSection('features', featuresRef);
                          else if (section === 'payment') scrollToSection('payment', paymentRef);
                        }}
                        className={`px-6 py-2 rounded-full text-[13px] font-semibold transition-all whitespace-nowrap flex-shrink-0 ${activeSection === section ? 'bg-brand-primary text-white shadow-md' : 'text-gray-500 hover:text-[#41456B]'}`}
                      >
                        {section.charAt(0).toUpperCase() + section.slice(1).replace('-', ' ')}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Quick spec strip — at-a-glance key specs with icons */}
              <div className="mb-10">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  {[
                    { icon: Gauge, label: 'Kilometres', value: car.mileage ? `${Number(car.mileage).toLocaleString()} km` : '—' },
                    { icon: Compass, label: 'Drivetrain', value: car.drivetrain || '—' },
                    { icon: Settings2, label: 'Transmission', value: car.transmission || '—' },
                    { icon: Zap, label: 'Engine', value: car.engine || (car.engineSize ? `${car.engineSize}L` : '—') },
                    { icon: Fuel, label: 'Fuel', value: car.fuelType || '—' },
                    { icon: Armchair, label: 'Seats', value: car.seats ? `${car.seats}` : '—' },
                  ].map((s, i) => (
                    <div key={i} className="bg-white border border-slate-100 rounded-2xl px-4 py-3.5 flex items-center gap-3 shadow-sm">
                      <div className="w-9 h-9 rounded-xl bg-violet-100 text-violet-600 flex items-center justify-center flex-shrink-0">
                        <s.icon className="w-[18px] h-[18px]" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-[15px] font-bold text-slate-900 tracking-tight truncate">{s.value}</div>
                        <div className="text-[11px] text-slate-400 font-semibold">{s.label}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Detailed Specifications Card */}
              <div ref={specsRef} id="specifications" className="scroll-mt-32 mb-12">
                <div className="bg-white p-5 md:p-6 rounded-3xl border border-slate-100 shadow-sm">
                  <h2 className="text-[13px] font-bold text-slate-500 uppercase tracking-[0.14em] mb-4">Vehicle Details</h2>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-x-8 gap-y-1">
                    {[
                      { label: 'Stock #', value: car.stockNumber || (car as any).stockId || car.id.split('-').pop()?.toUpperCase() || car.id.slice(-6).toUpperCase() },
                      { label: 'VIN', value: car.vin },
                      { label: 'Body Type', value: car.bodyStyle },
                      { label: 'Exterior Color', value: car.exteriorColor, isColor: true },
                    ].map((spec, idx) => (
                      <div key={idx} className="py-2.5 border-b border-slate-50 last:border-0 md:border-0">
                        <span className="block text-[11px] text-slate-400 font-bold uppercase tracking-wider mb-0.5">{spec.label}</span>
                        <div className="flex items-center gap-2">
                          {spec.isColor && (
                            <div
                              className="h-3 w-3 rounded-full border border-slate-200 flex-shrink-0"
                              style={{ backgroundColor: spec.value?.toLowerCase() || 'transparent' }}
                            />
                          )}
                          <span className="text-[14px] font-bold text-slate-900 tracking-tight break-all" title={spec.value || '-'}>
                            {spec.value || '-'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Categorized Features & Equipment Section */}
              {(categorizedFeatures !== null || loadingFeatures) && (
                <div ref={featuresRef} id="features" className="scroll-mt-32 mb-12">
                  <div className="bg-white p-6 md:p-10 rounded-[3rem] border border-slate-100 shadow-sm min-h-[200px]">
                    <div className="flex justify-between items-center mb-10">
                      <div>
                        <h2 className="text-[24px] md:text-[32px] font-bold text-slate-900 font-display tracking-tight">Features & Equipment</h2>
                        <p className="text-slate-400 text-sm mt-1">Everything this vehicle comes equipped with</p>
                      </div>
                      {loadingFeatures && <Loader2 className="w-5 h-5 animate-spin text-brand-primary" />}
                    </div>
                    
                    {hasAnyFeatures ? (
                     <div className="space-y-9">
                      {/* Safety & Driver Assist */}
                      {categorizedFeatures?.safetyAndSecurity && categorizedFeatures.safetyAndSecurity.length > 0 && (
                        <div className="group">
                          <h3 className="text-[12px] font-bold text-slate-500 uppercase tracking-[0.14em] mb-4 flex items-center gap-2.5">
                            <div className="p-2 bg-blue-50 rounded-xl group-hover:bg-blue-100 transition-colors">
                              <ShieldCheck className="w-4 h-4 text-blue-600" />
                            </div>
                            Safety & Driver Assist
                          </h3>
                          <div className="grid grid-cols-2 lg:grid-cols-3 gap-2.5">
                            {categorizedFeatures.safetyAndSecurity.map((feature, i) => {
                              const Icon = getFeatureIcon(feature);
                              return (
                                <div key={i} className="flex items-center gap-3 p-3 border border-slate-100 rounded-xl bg-white hover:shadow-md hover:border-slate-200 transition-all">
                                  <div className="w-8 h-8 rounded-lg bg-violet-100 flex items-center justify-center flex-shrink-0">
                                    <Icon className="w-[18px] h-[18px] text-violet-600" />
                                  </div>
                                  <span className="text-[13px] font-semibold text-slate-700 leading-tight">{feature}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Comfort & Interior */}
                      {categorizedFeatures?.comfortAndConvenience && categorizedFeatures.comfortAndConvenience.length > 0 && (
                        <div className="group">
                          <h3 className="text-[12px] font-bold text-slate-500 uppercase tracking-[0.14em] mb-4 flex items-center gap-2.5">
                            <div className="p-2 bg-indigo-50 rounded-xl group-hover:bg-indigo-100 transition-colors">
                              <Armchair className="w-4 h-4 text-indigo-600" />
                            </div>
                            Comfort & Interior
                          </h3>
                          <div className="grid grid-cols-2 lg:grid-cols-3 gap-2.5">
                            {categorizedFeatures.comfortAndConvenience.map((feature, i) => {
                              const Icon = getFeatureIcon(feature);
                              return (
                                <div key={i} className="flex items-center gap-3 p-3 border border-slate-100 rounded-xl bg-white hover:shadow-md hover:border-slate-200 transition-all">
                                  <div className="w-8 h-8 rounded-lg bg-violet-100 flex items-center justify-center flex-shrink-0">
                                    <Icon className="w-[18px] h-[18px] text-violet-600" />
                                  </div>
                                  <span className="text-[13px] font-semibold text-slate-700 leading-tight">{feature}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Tech & Infotainment */}
                      {categorizedFeatures?.entertainmentAndMedia && categorizedFeatures.entertainmentAndMedia.length > 0 && (
                        <div className="group">
                          <h3 className="text-[12px] font-bold text-slate-500 uppercase tracking-[0.14em] mb-4 flex items-center gap-2.5">
                            <div className="p-2 bg-purple-50 rounded-xl group-hover:bg-purple-100 transition-colors">
                              <Smartphone className="w-4 h-4 text-purple-600" />
                            </div>
                            Tech & Infotainment
                          </h3>
                          <div className="grid grid-cols-2 lg:grid-cols-3 gap-2.5">
                            {categorizedFeatures.entertainmentAndMedia.map((feature, i) => {
                              const Icon = getFeatureIcon(feature);
                              return (
                                <div key={i} className="flex items-center gap-3 p-3 border border-slate-100 rounded-xl bg-white hover:shadow-md hover:border-slate-200 transition-all">
                                  <div className="w-8 h-8 rounded-lg bg-violet-100 flex items-center justify-center flex-shrink-0">
                                    <Icon className="w-[18px] h-[18px] text-violet-600" />
                                  </div>
                                  <span className="text-[13px] font-semibold text-slate-700 leading-tight">{feature}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Performance & Mechanical */}
                      {categorizedFeatures?.extrasAndPackages && categorizedFeatures.extrasAndPackages.length > 0 && (
                        <div className="group">
                          <h3 className="text-[12px] font-bold text-slate-500 uppercase tracking-[0.14em] mb-4 flex items-center gap-2.5">
                            <div className="p-2 bg-slate-100 rounded-xl group-hover:bg-slate-200 transition-colors">
                              <Settings2 className="w-4 h-4 text-slate-600" />
                            </div>
                            Additional Features
                          </h3>
                          <div className="grid grid-cols-2 lg:grid-cols-3 gap-2.5">
                            {categorizedFeatures.extrasAndPackages.map((feature, i) => {
                              const Icon = getFeatureIcon(feature);
                              return (
                                <div key={i} className="flex items-center gap-3 p-3 border border-slate-100 rounded-xl bg-white hover:shadow-md hover:border-slate-200 transition-all">
                                  <div className="w-8 h-8 rounded-lg bg-violet-100 flex items-center justify-center flex-shrink-0">
                                    <Icon className="w-[18px] h-[18px] text-violet-600" />
                                  </div>
                                  <span className="text-[13px] font-semibold text-slate-700 leading-tight">{feature}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                    ) : loadingFeatures ? (
                      <div className="flex flex-col items-center justify-center py-24 bg-slate-50/30 rounded-[2rem] border border-dashed border-slate-100">
                        <Loader2 className="w-12 h-12 animate-spin text-brand-primary/40 mb-6" />
                        <p className="text-slate-400 font-bold uppercase tracking-widest text-xs animate-pulse">Scanning vehicle specifications...</p>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center py-16 bg-slate-50/30 rounded-[2rem] border border-dashed border-slate-100">
                        <p className="text-slate-400 font-medium italic">Standard equipment list for this model year and trim.</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="mt-16 border-t border-slate-100 pt-12">
                <section className="bg-white p-5 md:p-0 rounded-2xl md:rounded-none max-w-4xl">
                  <h2 className="text-[20px] md:text-[28px] font-bold text-slate-900 mb-6 font-display tracking-tight">Vehicle Description</h2>
                  <div className="prose prose-slate max-w-none">
                    <p className="text-[16px] md:text-[18px] text-slate-600 leading-[1.8] whitespace-pre-wrap font-medium">
                      {car.description}
                    </p>
                  </div>
                </section>
              </div>
              
              {/* Mobile: Check Availability Action - Moved lower down the page */}
              {car.status === 'For Sale' && (
                <div className="lg:hidden mt-12 mb-6">
                  <div className="bg-white p-6 rounded-2xl border border-dashed border-slate-100">
                    <h4 className="text-sm font-bold text-slate-700 mb-3 text-center">Have questions about this vehicle?</h4>
                    <CheckAvailabilityDialog car={car} />
                  </div>
                </div>
              )}
              
              {car.status === 'For Sale' && (
                <div ref={paymentRef} id="payment" className="scroll-mt-32 py-8 md:py-12 border-t border-slate-100">
                  <div className="bg-white p-5 md:p-0 rounded-2xl md:rounded-none text-brand-primary">
                    <CarLoanCalculator car={car} initialPrice={car.price} />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right Column (Sticky Sidebar) */}
          <div className="md:col-span-4 hidden md:block sticky top-24 self-start">
            <div className="bg-white p-8 rounded-[2rem] shadow-xl shadow-slate-200/50 border border-slate-100 overflow-hidden">
              {VehicleInfo}
              <div className="mt-8 pt-8 border-t border-slate-100 space-y-4">
                {car.status === 'For Sale' && (
                  <>
                    <Button 
                      asChild
                      className="w-full h-14 rounded-xl bg-[#7380FF] hover:bg-[#5e41cc] text-white font-bold text-[18px] shadow-lg shadow-[#7380FF]/20 transition-all active:scale-[0.98]"
                    >
                      <Link to={`/apply-now?vehicleId=${car.id}&make=${car.make}&model=${car.model}&year=${car.year}`}>
                        Get Pre-Approved
                      </Link>
                    </Button>
                    <CheckAvailabilityDialog car={car} />
                  </>
                )}
                {car.status === 'Sold' && (
                  <Button 
                    disabled
                    className="w-full h-14 rounded-xl bg-slate-100 text-slate-400 font-bold text-[18px]"
                  >
                    Sold
                  </Button>
                )}
                {car.status === 'Pending Sale' && (
                  <Button 
                    disabled
                    className="w-full h-14 rounded-xl bg-amber-50 text-amber-500 font-bold text-[18px] border border-amber-100"
                  >
                    Pending Sale
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
      <AnimatePresence>
        {photoReqOpen && (
          <div className="fixed inset-0 z-[110] bg-black/50 flex items-center justify-center p-4" onClick={() => setPhotoReqOpen(false)}>
            <div className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-2xl" onClick={(e) => e.stopPropagation()}>
              {photoReqState === 'sent' ? (
                <div className="text-center py-4">
                  <p className="text-2xl mb-2">📸</p>
                  <h4 className="text-lg font-bold text-slate-800">You&rsquo;re on the list</h4>
                  <p className="text-sm text-slate-500 mt-1">We&rsquo;ll text you photos of the {carTitle} shortly.</p>
                  <button onClick={() => setPhotoReqOpen(false)} className="mt-4 h-10 px-6 rounded-xl bg-brand-primary text-white text-sm font-bold">Done</button>
                </div>
              ) : (
                <>
                  <h4 className="text-lg font-bold text-slate-800">Get more photos</h4>
                  <p className="text-sm text-slate-500 mt-1 mb-4">Tell us where to text them — we&rsquo;ll send current photos of the {carTitle}.</p>
                  <input value={photoReqName} onChange={(e) => setPhotoReqName(e.target.value)} placeholder="Your name"
                    className="w-full h-11 rounded-xl border border-slate-200 px-3.5 text-sm mb-2 outline-none focus:border-brand-accent" />
                  <input value={photoReqPhone} onChange={(e) => setPhotoReqPhone(formatPhoneShared(e.target.value))} placeholder="(902) 555-0199" type="tel"
                    className="w-full h-11 rounded-xl border border-slate-200 px-3.5 text-sm mb-3 outline-none focus:border-brand-accent" />
                  {photoReqState === 'error' && <p className="text-xs text-red-500 mb-2">Please enter your name and a valid phone number.</p>}
                  <button onClick={submitPhotoRequest} disabled={photoReqState === 'sending'}
                    className="w-full h-11 rounded-xl bg-brand-accent text-white text-sm font-bold disabled:opacity-60">
                    {photoReqState === 'sending' ? 'Sending…' : 'Text me the photos'}
                  </button>
                </>
              )}
            </div>
          </div>
        )}
        {isDesktopLightboxOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/90 flex flex-col p-4"
          >
            <button 
              onClick={() => setIsDesktopLightboxOpen(false)}
              className="absolute top-4 right-4 p-2 bg-white/10 rounded-full text-white hover:bg-white/20"
            >
              <X className="h-6 w-6" />
            </button>
            <div className="flex-1 flex items-center justify-center relative">
              {/* Prev / Next — click zones + arrows */}
              <button
                onClick={() => setLightboxActiveImage((i) => (i - 1 + (car.images?.length || 1)) % (car.images?.length || 1))}
                className="absolute left-0 top-0 bottom-0 w-24 flex items-center justify-start pl-4 text-white/70 hover:text-white z-10"
                aria-label="Previous photo"
              >
                <span className="p-3 bg-white/10 rounded-full hover:bg-white/25 transition"><ChevronLeft className="h-8 w-8" /></span>
              </button>
              <img
                src={car.images?.[lightboxActiveImage]}
                alt=""
                className="max-h-[80vh] max-w-full object-contain"
                referrerPolicy="no-referrer"
              />
              <button
                onClick={() => setLightboxActiveImage((i) => (i + 1) % (car.images?.length || 1))}
                className="absolute right-0 top-0 bottom-0 w-24 flex items-center justify-end pr-4 text-white/70 hover:text-white z-10"
                aria-label="Next photo"
              >
                <span className="p-3 bg-white/10 rounded-full hover:bg-white/25 transition"><ChevronRight className="h-8 w-8" /></span>
              </button>
              <span className="absolute bottom-2 left-1/2 -translate-x-1/2 text-white/70 text-sm font-semibold">
                {lightboxActiveImage + 1} / {car.images?.length || 0}
              </span>
            </div>
            <div className="flex gap-2 overflow-x-auto p-4">
              {car.images?.map((img, index) => (
                <button
                  key={index}
                  ref={(el) => { if (el && lightboxActiveImage === index) el.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' }); }}
                  onClick={() => setLightboxActiveImage(index)}
                  className={`w-20 h-20 flex-shrink-0 rounded-lg overflow-hidden border-2 ${lightboxActiveImage === index ? 'border-white' : 'border-transparent opacity-60 hover:opacity-100'}`}
                >
                  <img src={img || null} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {isGalleryOpen && (
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            className="fixed bottom-0 left-0 right-0 h-[75vh] md:inset-0 z-[100] bg-white flex flex-col rounded-t-3xl md:rounded-none"
          >
            <motion.div 
              className="sticky top-0 z-10 backdrop-blur-md bg-white/70 border-b border-gray-200 p-4 flex items-center justify-between cursor-grab active:cursor-grabbing"
              drag="y"
              dragConstraints={{ top: 0, bottom: 0 }}
              onDragEnd={(_, info) => {
                if (info.offset.y > 100) setIsGalleryOpen(false);
              }}
            >
              <h2 className="text-xl font-bold text-brand-primary">Gallery</h2>
              <Button variant="ghost" size="icon" onClick={() => setIsGalleryOpen(false)} className="text-brand-primary">
                <X className="h-6 w-6" />
              </Button>
            </motion.div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {car.images?.map((img, index) => (
                <img 
                  key={index}
                  src={img} 
                  alt={`${car.year} ${car.make} ${car.model} - ${index + 1}`}
                  className="w-full rounded-2xl"
                  loading="lazy"
                  referrerPolicy="no-referrer"
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showMobileFooter && (
          <motion.div
            initial={{ y: 100 }}
            animate={{ y: 0 }}
            exit={{ y: 100 }}
            className="fixed bottom-0 left-0 right-0 z-50 lg:hidden bg-white border-t border-slate-100 px-4 pt-4 pb-8 flex flex-col shadow-[0_-8px_30px_rgba(0,0,0,0.04)]"
          >
            {/* Row 1: Dual-Pricing Options */}
            {car.status === 'Sold' ? (
              <div className="flex flex-col items-center justify-center w-full bg-red-50 text-red-600 rounded-xl py-3 border border-red-100 mb-3">
                <span className="text-xl font-black uppercase tracking-widest leading-none">Sold</span>
                {soldDateStr ? (
                  <span className="text-[10px] uppercase font-bold mt-1 text-red-400">Sold on {soldDateStr}</span>
                ) : (
                  <span className="text-[10px] uppercase font-bold mt-1 text-red-400">Not Available</span>
                )}
              </div>
            ) : car.status === 'Pending Sale' ? (
              <div className="flex flex-col items-center justify-center w-full bg-amber-50 text-amber-600 rounded-xl py-3 border border-amber-100 mb-3">
                <span className="text-xl font-black uppercase tracking-widest leading-none">Pending Sale</span>
                <span className="text-[10px] uppercase font-bold mt-1 text-amber-400">Reservation in progress</span>
              </div>
            ) : (
              <div className="flex justify-between items-center w-full mb-3 px-2">
                {/* Left Column: Payment */}
                <div className="flex-1 text-center">
                  <span className="block text-[10px] uppercase tracking-wider text-slate-400 font-bold mb-0.5">Bi-Weekly</span>
                  <div className="flex justify-center items-baseline gap-0.5">
                    <span className="text-lg font-bold text-slate-900">{financeTerm ? `$${Math.round(biWeekly).toLocaleString()}` : '—'}</span>
                    <span className="text-[10px] uppercase font-bold text-slate-400">/bw</span>
                  </div>
                </div>

                {/* Middle Divider */}
                <div className="w-[1px] h-8 bg-slate-200 mx-2" />

                {/* Right Column: Full Price */}
                <div className="flex-1 text-center">
                  <span className="block text-[10px] uppercase tracking-wider text-slate-400 font-bold mb-0.5">Full Price</span>
                  <span className="block text-lg font-bold text-slate-900 leading-none">
                    ${(car.price || 0).toLocaleString()}
                  </span>
                </div>
              </div>
            )}

            {/* Row 2: Action Button */}
            <Button 
              asChild
              disabled={car.status !== 'For Sale'}
              className={cn(
                "w-full h-14 text-base font-bold rounded-xl shadow-lg transition-all active:scale-[0.98] tracking-tight",
                car.status === 'For Sale' ? "bg-[#7380FF] hover:bg-[#41456B] text-white shadow-[#7380FF]/20" : "bg-slate-100 text-slate-400 shadow-none cursor-not-allowed"
              )}
            >
              <Link to={car.status === 'For Sale' ? `/apply-now?vehicleId=${car.id}&make=${car.make}&model=${car.model}&year=${car.year}` : "#"}>
                {car.status === 'Sold' ? 'Sold' : car.status === 'Pending Sale' ? 'Pending Sale' : 'Get Approved'}
              </Link>
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
      </div>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Inquire about {carTitle}</DialogTitle>
          <DialogDescription>Fill out the form below to get started.</DialogDescription>
        </DialogHeader>
        <LeadForm 
          carId={car.id} 
          carTitle={carTitle} 
          onSuccess={() => {
            setIsLeadDialogOpen(false);
            const currentPath = location.pathname;
            if (!currentPath.endsWith('/success')) {
              navigate(`${currentPath}/success`, { replace: true });
            }
          }} 
        />
      </DialogContent>

      {/* Full Window Viewer Overlay - Moved to root for correct positioning */}
      <AnimatePresence>
        {isFullWindowOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9999] bg-black flex flex-col"
          >
            {/* Header */}
            <div className="absolute top-0 left-0 right-0 p-4 flex justify-between items-center z-[110] bg-gradient-to-b from-black/50 to-transparent">
              <div className="text-white">
                <h2 className="font-bold text-lg">{car.year} {car.make} {car.model}</h2>
                <p className="text-xs text-white/70">{fullWindowView === 'interior' ? '360° Interior Tour' : '360° Exterior Spin'}</p>
              </div>
              <button 
                onClick={() => setIsFullWindowOpen(false)}
                className="p-2 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors"
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            {/* Viewer Content */}
            <div className="flex-grow relative overflow-hidden bg-black">
              {fullWindowView === 'interior' ? (
                <div key="full-interior-container" className="w-full h-full">
                  <div id="full-panorama" className="w-full h-full"></div>
                </div>
              ) : (
                <div key="full-exterior-container" className="absolute inset-0 flex items-center justify-center bg-white">
                  <div id="sirv-full" className="Sirv !w-full !h-full" data-src={car.sirvUrl} data-options="fit:contain; autostart:false; margin:0; fullscreen.enable:false; zoom.enable:false;"></div>
                </div>
              )}
            </div>

            {/* Footer Toggle */}
            <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center bg-white/10 backdrop-blur-md p-1 rounded-full shadow-2xl border border-white/10 z-[110]">
              <button 
                onClick={() => setFullWindowView('exterior')}
                className={`px-6 py-2 rounded-full text-xs font-bold transition-all ${fullWindowView === 'exterior' ? 'bg-[#7380FF] text-white' : 'text-white/70 hover:text-white'}`}
              >
                Exterior
              </button>
              {(car?.interior360Photo || car?.interior360Url) && (
                <button 
                  onClick={() => setFullWindowView('interior')}
                  className={`px-6 py-2 rounded-full text-xs font-bold transition-all ${fullWindowView === 'interior' ? 'bg-[#7380FF] text-white' : 'text-white/70 hover:text-white'}`}
                >
                  Interior
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Dialog>
  );
}
