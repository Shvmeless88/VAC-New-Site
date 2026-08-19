import { useState, useEffect, useRef, ChangeEvent } from 'react';
import { useSearchParams, Link, useNavigate, useLocation } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import Logo from '@/components/layout/Logo';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { cn, slugify, cleanAndFormatPhone } from '@/lib/utils';
import { 
  CheckCircle2, 
  ShieldCheck, 
  CreditCard, 
  Landmark, 
  ArrowRight, 
  ArrowLeft, 
  Loader2, 
  Clock, 
  Phone, 
  Lock, 
  Check, 
  Star,
  StarHalf,
  Zap,
  MapPin,
  AlertTriangle,
  Car as CarIcon,
  Truck as TruckIcon,
  Bus as VanIcon,
  CarFront as SuvIcon
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Car } from '@/types';

import { useDeliveries } from '@/hooks/useDeliveries';
import { useInventory } from '@/hooks/useInventory';
import { db, collection, addDoc, Timestamp, handleFirestoreError, OperationType, assignLeadRoundRobin, getDoc, doc, query, orderBy, limit, onSnapshot } from '@/lib/firebase';

const formSchema = z.object({
  firstName: z.string().min(2, 'First name is required'),
  lastName: z.string().min(2, 'Last name is required'),
  dob: z.string()
    .regex(/^\d{2}\/\d{2}\/\d{4}$/, 'Invalid date format (MM/DD/YYYY)'),
  email: z.string().email('Invalid email address'),
  phone: z.string().min(14, 'Phone number must be 10 digits'), // (XXX) XXX-XXXX is 14 chars
  annualIncome: z.string().min(1, 'Monthly income is required'),
  monthlyHousing: z.string().min(1, 'Monthly housing payment is required'),
  streetAddress: z.string().min(5, 'Street address is required'),
  suite: z.string().optional(),
  city: z.string().min(2, 'City is required'),
  province: z.string().min(2, 'Province is required'),
  postalCode: z.string().regex(/^[A-Za-z]\d[A-Za-z] ?\d[A-Za-z]\d$/, 'Invalid postal code (e.g., A1B2C3 or A1B 2C3)'),
  vehicleType: z.string().optional(),
  price: z.string().optional(),
  downPayment: z.string().optional(),
});

type FormData = z.infer<typeof formSchema>;

import { ErrorBoundary } from '@/components/ErrorBoundary';

export default function FinancingWrapper() {
  return (
    <ErrorBoundary>
      <Financing />
    </ErrorBoundary>
  );
}

import { getStoredUtms } from '@/lib/utms';

function Financing() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const vehicleId = searchParams.get('vehicleId');
  const stockNo = searchParams.get('stock_no');
  const make = searchParams.get('make');
  const model = searchParams.get('model');
  const year = searchParams.get('year');
  const price = searchParams.get('price');
  const typeParam = searchParams.get('type') || searchParams.get('vehicleType');
  const stepParam = searchParams.get('step');
  const downPayment = searchParams.get('downPayment');
  const rep = searchParams.get('rep');
  const [car, setCar] = useState<Car | null>(null);
  const { deliveries, loading: storiesLoading } = useDeliveries();
  const { inventory, loading: inventoryLoading } = useInventory();
  
  useEffect(() => {
    if (location.pathname.endsWith('/success')) {
      setIsSuccess(true);
    }
  }, [location.pathname]);

  const [step, setStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Synchronize step with search params
  useEffect(() => {
    const currentStepParam = searchParams.get('step');
    
    // If step param exists and is different from current state, update state
    if (currentStepParam) {
      if (currentStepParam === 'vehicle_selection') {
        if (step !== 0) setStep(0);
      } else {
        const s = parseInt(currentStepParam);
        if (!isNaN(s) && s >= 0 && s <= 4) {
          if (step !== s) setStep(s);
        }
      }
    } else if (step === 0 && (vehicleId || make || typeParam)) {
      // Auto-advance to step 1 ONLY on initial entry if vehicle context provided
      setStep(1);
    }
  }, [searchParams, vehicleId, make, typeParam]); // Run when search params change

  // Update URL whenever step changes
  useEffect(() => {
    const currentStepParam = searchParams.get('step');
    const targetStep = step.toString();
    
    if (currentStepParam !== targetStep && !isSuccess) {
      const newParams = new URLSearchParams(searchParams);
      newParams.set('step', targetStep);
      setSearchParams(newParams, { replace: true });
    }
  }, [step, isSuccess, searchParams, setSearchParams]);
  const [isGoogleLoaded, setIsGoogleLoaded] = useState(!!(window as any).google?.maps?.places);
  const autocompleteRef = useRef<any>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const pipedrivePersonIdRef = useRef<number | null>(null);
  const pipedriveLeadIdRef = useRef<string | null>(null);
  const isSyncingRef = useRef<boolean>(false);

  useEffect(() => {
    // Only auto-scroll on mobile
    if (window.innerWidth < 768 && step > 0) {
      const cardElement = cardRef.current;
      if (cardElement) {
        // Use a small delay to ensure the DOM has updated and AnimatePresence has started
        setTimeout(() => {
          const rect = cardElement.getBoundingClientRect();
          const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
          const targetY = rect.top + scrollTop - 20; // 20px offset from top
          
          window.scrollTo({
            top: targetY,
            behavior: 'smooth'
          });
        }, 100);
      }
    }
  }, [step]);

  const SoldVehicleGrid = () => {
    if (inventoryLoading || soldVehicles.length === 0) return null;
    
    return (
      <div className="mb-16">
        <div className="flex flex-col items-center mb-8">
          <Badge className="bg-brand-accent/10 text-brand-accent border-brand-accent/20 mb-4 px-4 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest">
            Recently Sold
          </Badge>
          <h4 className="text-[#41456B] font-bold text-sm md:text-lg">Fresh Inventory. Fast Approvals.</h4>
        </div>
        
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 px-2 md:px-0">
          {soldVehicles.map((v) => (
            <div key={v.id} className="group relative bg-white rounded-2xl overflow-hidden border border-gray-100 shadow-sm transition-all hover:shadow-md">
              <div className="aspect-[4/3] overflow-hidden relative">
                <img 
                  src={v.images?.[0]} 
                  alt={v.model} 
                  className="w-full h-full object-cover grayscale opacity-80 group-hover:grayscale-0 group-hover:opacity-100 transition-all duration-700" 
                  referrerPolicy="no-referrer"
                />
                <div className="absolute top-2 left-2">
                  <span className="bg-red-500 text-white text-[8px] font-black uppercase tracking-widest px-2 py-1 rounded shadow-lg">
                    SOLD
                  </span>
                </div>
              </div>
              <div className="p-3 text-left">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-0.5">{v.year}</p>
                <h5 className="text-[11px] font-bold text-brand-primary truncate">{v.make} {v.model}</h5>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const DeliveriesCarousel = () => {
    if (storiesLoading) {
      return (
        <div className="flex gap-4 overflow-hidden px-4 md:px-0">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="w-[160px] md:w-[220px] flex-shrink-0">
              <div className="aspect-square rounded-2xl bg-slate-100 animate-pulse border border-gray-100 shadow-sm" />
            </div>
          ))}
        </div>
      );
    }

    return (
      <div className="overflow-hidden whitespace-nowrap relative py-4 -mx-4 px-4 md:mx-0 md:px-0 [mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)]">
        <div className="flex gap-4 min-w-max w-fit px-4 animate-scroll-carousel will-change-transform [backface-visibility:hidden]">
          {[...deliveries.slice(0, 8), ...deliveries.slice(0, 8)].map((story: any, index) => (
            <div key={`${story.id}-${index}`} className="w-[160px] md:w-[220px] flex-shrink-0 group">
              <div className="aspect-square rounded-2xl overflow-hidden border border-gray-100 shadow-sm bg-white relative">
                <img 
                  src={story.photoUrl} 
                  alt="Happy Customer" 
                  className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                  referrerPolicy="no-referrer"
                  loading="lazy"
                />
                <div className="absolute bottom-2 left-2 right-2">
                  <div className="bg-white/90 backdrop-blur-sm px-2 py-1 rounded-lg border border-white/20 shadow-sm inline-flex items-center gap-1.5">
                    <MapPin className="h-2.5 w-2.5 text-[#7380FF]" />
                    <span className="text-[8px] font-bold text-[#41456B] uppercase tracking-wider">
                      {story.city ? `${story.city}, ${story.province}` : 'Atlantic Canada'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const { register, handleSubmit, formState: { errors }, trigger, watch, setValue } = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      firstName: '',
      lastName: '',
      dob: '',
      email: '',
      phone: '',
      annualIncome: '',
      monthlyHousing: '',
      streetAddress: '',
      suite: '',
      city: '',
      province: '',
      postalCode: '',
      vehicleType: '',
      price: price || '',
      downPayment: downPayment || '',
    }
  });

  const soldVehicles = inventory
    .filter(v => v.status === 'Sold')
    .slice(0, 4);

  // Track initial view
  useEffect(() => {
    // If vehicle context exists, ensure vehicleType is set in form
    if (typeParam) {
      setValue('vehicleType', typeParam);
    }
  }, [typeParam, setValue]);

  useEffect(() => {
    if (vehicleId) {
      const fetchCar = async () => {
        try {
          const carDoc = await getDoc(doc(db, 'inventory', vehicleId));
          if (carDoc.exists()) {
            const carData = carDoc.data();
            setCar({ id: carDoc.id, ...carData } as Car);
            // Also set vehicleType in form if not already set
            if (carData.type) {
              setValue('vehicleType', carData.type);
            }
          }
        } catch (err) {
          console.error("Error fetching car details:", err);
        }
      };
      fetchCar();
    }
  }, [vehicleId, setValue]);

  // Callback ref for the address input
  const setAddressInputRef = (element: HTMLInputElement | null) => {
    if (!element) return;
    
    const google = (window as any).google;
    if (google?.maps?.places && !autocompleteRef.current) {

      const autocomplete = new google.maps.places.Autocomplete(element, {
        componentRestrictions: { country: "ca" },
        fields: ["address_components", "formatted_address"],
        types: ['address'],
      });

      autocomplete.addListener("place_changed", () => {
        const place = autocomplete.getPlace();

        if (!place.address_components) {
          console.warn("No address components found for the selected place.");
          return;
        }

        let streetNumber = "";
        let route = "";
        let city = "";
        let province = "";
        let postalCode = "";

        for (const component of place.address_components) {
          const types = component.types;
          if (types.includes("street_number")) streetNumber = component.long_name;
          if (types.includes("route")) route = component.long_name;
          if (types.includes("locality")) city = component.long_name;
          if (types.includes("administrative_area_level_1")) province = component.short_name;
          if (types.includes("postal_code")) postalCode = component.long_name;
        }

        setValue("streetAddress", `${streetNumber} ${route}`.trim(), { shouldValidate: true });
        setValue("city", city, { shouldValidate: true });
        setValue("province", province, { shouldValidate: true });
        setValue("postalCode", postalCode, { shouldValidate: true });
      });
      
      autocompleteRef.current = autocomplete;
    }
  };

  // Safety effect to re-initialize if script loads after component mounts
  useEffect(() => {
    if (isGoogleLoaded && step === 3) {
      const el = document.getElementById('streetAddress') as HTMLInputElement;
      if (el) setAddressInputRef(el);
    }
  }, [isGoogleLoaded, step]);

  const dob = watch('dob');
  const [isUnderage, setIsUnderage] = useState(false);

  useEffect(() => {
    if (dob && /^\d{2}\/\d{2}\/\d{4}$/.test(dob)) {
      const [mm, dd, yyyy] = dob.split('/').map(Number);
      const birthDate = new Date(yyyy, mm - 1, dd);
      const today = new Date();
      let age = today.getFullYear() - birthDate.getFullYear();
      const m = today.getMonth() - birthDate.getMonth();
      if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
        age--;
      }
      setIsUnderage(age < 19);
    } else {
      setIsUnderage(false);
    }
  }, [dob]);

  // No explicit registration needed for standard inputs
  useEffect(() => {
    const apiKey = (import.meta as any).env.VITE_GOOGLE_MAPS_API_KEY;
    
    // Check if script is already loaded
    if ((window as any).google?.maps?.places) {
      setIsGoogleLoaded(true);
      return;
    }

    // Load script dynamically if not present
    if (apiKey && !document.getElementById('google-maps-script')) {

      const script = document.createElement('script');
      script.id = 'google-maps-script';
      script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
      script.async = true;
      script.defer = true;
      script.onload = () => {

        setIsGoogleLoaded(true);
      };
      script.onerror = () => {
        console.error("Failed to load Google Maps script. Check your API key.");
      };
      document.head.appendChild(script);
    }
  }, []);

  const formatDOB = (e: ChangeEvent<HTMLInputElement>) => {
    let value = e.target.value.replace(/\D/g, "");
    if (value.length > 8) value = value.slice(0, 8);
    
    let formatted = "";
    if (value.length > 0) {
      formatted = value.slice(0, 2);
      if (value.length > 2) {
        formatted += "/" + value.slice(2, 4);
        if (value.length > 4) {
          formatted += "/" + value.slice(4, 8);
        }
      }
    }
    setValue("dob", formatted, { shouldValidate: true });
  };

  const formatPhone = (e: ChangeEvent<HTMLInputElement>) => {
    const formatted = cleanAndFormatPhone(e.target.value);
    setValue("phone", formatted, { shouldValidate: true });
  };

  const formatNumeric = (fieldName: keyof FormData) => (e: ChangeEvent<HTMLInputElement>) => {
    // Allow only numbers and a single decimal point
    let value = e.target.value.replace(/[^0-9.]/g, "");
    
    // Ensure only one decimal point
    const parts = value.split('.');
    if (parts.length > 2) {
      value = parts[0] + '.' + parts.slice(1).join('');
    }
    
    setValue(fieldName, value, { shouldValidate: true });
  };

  const formatPostalCode = (e: ChangeEvent<HTMLInputElement>) => {
    // Allow both letters and numbers, auto-uppercase Any letters
    let value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    
    // Limit to 6 characters
    if (value.length > 6) value = value.slice(0, 6);
    
    // Add space after first 3 characters (e.g., B3J 2K9)
    let formatted = value;
    if (value.length > 3) {
      formatted = `${value.slice(0, 3)} ${value.slice(3)}`;
    }
    
    setValue("postalCode", formatted, { shouldValidate: true });
  };

  const syncPartialToPipedrive = async () => {
    if (isSyncingRef.current) return;
    
    const data = watch();
    // Safety check: Don't sync if phone or email are missing or invalid
    if (!data.email || !data.phone || data.phone.length < 14) {
      return;
    }

    isSyncingRef.current = true;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const response = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          ...getStoredUtms(),
          lead_id: pipedriveLeadIdRef.current || undefined,
          person_id: pipedrivePersonIdRef.current || undefined,
          title: `${data.firstName} ${data.lastName}`,
          name: `${data.firstName} ${data.lastName}`,
          firstName: data.firstName,
          lastName: data.lastName,
          email: data.email,
          phone: data.phone,
          dateOfBirth: data.dob,
          vehicleType: data.vehicleType,
          rep: rep || undefined,
          vehicleName: car ? `${car.year} ${car.make} ${car.model}` : (year && make && model ? `${year} ${make} ${model}` : undefined),
          vehicleUrl: (() => {
            if (!vehicleId) return undefined;
            const titleParts = car ? [car.year, car.make, car.model] : [year, make, model];
            const title = titleParts.filter(Boolean).join(' ');
            if (title) {
              return `${window.location.origin}/inventory/${slugify(title)}-${vehicleId}`;
            }
            return `${window.location.origin}/inventory/${vehicleId}`;
          })(),
          // Financials
          annualIncome: data.annualIncome,
          monthlyHousing: data.monthlyHousing,
          // Address
          postalCode: data.postalCode,
          streetAddress: data.streetAddress,
          suite: data.suite,
          city: data.city,
          province: data.province,
          price: data.price,
          downPayment: data.downPayment,
          fullAddress: data.streetAddress ? `${data.streetAddress}, ${data.suite ? data.suite + ', ' : ''}${data.city}, ${data.province}` : undefined
        })
      });
      clearTimeout(timeoutId);

      if (response.ok) {
        const result = await response.json();
        if (result.personId) pipedrivePersonIdRef.current = result.personId;
        if (result.leadId) pipedriveLeadIdRef.current = result.leadId;
      }
    } catch (err) {
      console.error("Partial sync failed:", err);
    } finally {
      isSyncingRef.current = false;
    }
  };

  const nextStep = async () => {
    if (isUnderage) return;
    let fields: string[] = [];
    if (step === 0) fields = ['vehicleType'];
    else if (step === 1) fields = ['firstName', 'lastName', 'dob'];
    else if (step === 2) fields = ['email', 'phone'];
    else if (step === 3) fields = ['annualIncome', 'monthlyHousing'];
    else fields = ['streetAddress', 'city', 'province', 'postalCode'];
    
    const isValid = await trigger(fields as any);
    if (isValid) {
      if (step >= 2) {
        syncPartialToPipedrive();
      }
      setStep(step + 1);
    }
  };

  const prevStep = () => setStep(step - 1);

  const onSubmit = async (data: FormData) => {
    if (isUnderage) return;

    setIsSubmitting(true);
    setError(null);
    const path = 'leads';
    try {
      // Assign lead using round robin
      const assignedTo = await assignLeadRoundRobin();
      
      const leadData = {
        ...data,
        type: 'financing',
        status: 'new',
        vehicleType: data.vehicleType || null,
        vehicleId: vehicleId || null,
        rep: rep || null,
        assignedTo,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        monthlyBudget: sessionStorage.getItem('inventory_selectedBudget') || null,
        mileageRange: sessionStorage.getItem('inventory_mileageRange') ? JSON.parse(sessionStorage.getItem('inventory_mileageRange')!) : null,
        // Individual fields
        dateOfBirth: data.dob,
        annualIncome: data.annualIncome,
        monthlyHousing: data.monthlyHousing,
        postalCode: data.postalCode,
        fullAddress: `${data.streetAddress}, ${data.suite ? data.suite + ', ' : ''}${data.city}, ${data.province}`,
        // Clean notes
        notes: `Customer is looking for a ${data.vehicleType || 'vehicle'}.`
      };

      // Remove any undefined fields to prevent Firestore errors
      Object.keys(leadData).forEach(key => (leadData as any)[key] === undefined && delete (leadData as any)[key]);
      


      // Submit to Pipedrive first to ensure lead capture even if Firestore is offline
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 20000); // 20 second timeout

        const response = await fetch('/api/leads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            ...getStoredUtms(),
            lead_id: pipedriveLeadIdRef.current || undefined,
            person_id: pipedrivePersonIdRef.current || undefined,
            title: `${data.firstName} ${data.lastName}`,
            name: `${data.firstName} ${data.lastName}`,
            firstName: data.firstName,
            lastName: data.lastName,
            email: data.email,
            phone: data.phone,
            dateOfBirth: data.dob,
            annualIncome: data.annualIncome,
            monthlyHousing: data.monthlyHousing,
            postalCode: data.postalCode,
            streetAddress: data.streetAddress,
            suite: data.suite,
            city: data.city,
            province: data.province,
            price: data.price,
            downPayment: data.downPayment,
            vehicleType: data.vehicleType,
            rep: rep || undefined,
            vehicleName: car ? `${car.year} ${car.make} ${car.model}` : (year && make && model ? `${year} ${make} ${model}` : undefined),
            vehicleUrl: (() => {
              if (!vehicleId) return undefined;
              const titleParts = car ? [car.year, car.make, car.model] : [year, make, model];
              const title = titleParts.filter(Boolean).join(' ');
              if (title) {
                return `${window.location.origin}/inventory/${slugify(title)}-${vehicleId}`;
              }
              return `${window.location.origin}/inventory/${vehicleId}`;
            })(),
            fullAddress: `${data.streetAddress}, ${data.suite ? data.suite + ', ' : ''}${data.city}, ${data.province}`,
            isFinal: true
          })
        });
        
        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorData = await response.json();
          console.error("Backend error details:", errorData);
          throw new Error(errorData.error || 'Failed to submit lead to Pipedrive');
        }
      } catch (err: any) {
        if (err.name === 'AbortError') {
          console.error("Pipedrive submission timed out");
        } else {
          console.error("Pipedrive submission error:", err);
        }
        // We continue to save to Firestore even if Pipedrive fails/times out
      }

      const leadRef = await addDoc(collection(db, path), leadData);

      // Create internal notification for the assigned rep
      if (assignedTo) {
        await addDoc(collection(db, 'notifications'), {
          userId: assignedTo,
          title: 'New Financing Application',
          message: `${data.firstName} ${data.lastName} submitted a financing application.`,
          type: 'new_lead',
          leadId: leadRef.id,
          isRead: false,
          createdAt: Timestamp.now()
        });
      }

      setIsSuccess(true);
      // Navigate to success URL
      const currentPath = location.pathname;
      if (!currentPath.endsWith('/success')) {
        navigate(`${currentPath}/success`, { replace: true });
      }
      
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      console.error("Submission error:", error);
      setError("An unexpected error occurred. Please try again.");
      handleFirestoreError(error, OperationType.CREATE, path);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isSuccess) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center px-4 overflow-y-auto pt-20 pb-12">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full mx-auto bg-white rounded-[2.5rem] shadow-xl shadow-gray-200/40 p-8 md:p-12 text-center border border-gray-100 mb-12"
        >
          <div className="bg-green-50 h-20 w-20 rounded-full flex items-center justify-center mx-auto mb-6 shadow-[0_10px_40px_rgba(34,197,94,0.15)] border border-green-100">
            <CheckCircle2 className="h-10 w-10 text-green-500" />
          </div>
          
          <h2 className="mb-2">You're All Set!</h2>
          <p className="text-gray-500 text-base mb-8">
            Thank you, {watch('firstName')}! Your application is now being processed.
          </p>

          <div className="bg-slate-50 rounded-2xl p-6 mb-6 text-left space-y-4 border border-gray-50">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">What's Next?</p>
            <div className="flex items-start gap-3">
              <div className="h-9 w-9 rounded-full bg-[#7380FF] flex items-center justify-center shrink-0 mt-0.5 shadow-sm">
                <span className="text-white text-base font-bold">1</span>
              </div>
              <div>
                <h4 className="text-lg font-bold text-[#41456B]">We’re on it!</h4>
                <p className="text-base text-gray-500 leading-relaxed">Our team is reviewing your application right now to find the best options for your budget.</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="h-9 w-9 rounded-full bg-[#7380FF] flex items-center justify-center shrink-0 mt-0.5 shadow-sm">
                <span className="text-white text-base font-bold">2</span>
              </div>
              <div>
                <h4 className="text-lg font-bold text-[#41456B]">Let’s chat.</h4>
                <p className="text-base text-gray-500 leading-relaxed">A VAC specialist will give you a quick shout shortly to go over your approval and next steps.</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="h-9 w-9 rounded-full bg-[#7380FF] flex items-center justify-center shrink-0 mt-0.5 shadow-sm">
                <span className="text-white text-base font-bold">3</span>
              </div>
              <div>
                <h4 className="text-lg font-bold text-[#41456B]">Pick your ride.</h4>
                <p className="text-base text-gray-500 leading-relaxed">Once we’ve got the green light, we’ll help you pick out your vehicle and get you on the road.</p>
              </div>
            </div>
          </div>

          <Button asChild className="w-full bg-[#7380FF] hover:brightness-110 h-12 md:h-14 font-bold rounded-xl shadow-md uppercase tracking-widest text-[11px] transition-all">
            <Link to="/">RETURN HOME</Link>
          </Button>
        </motion.div>

        {/* Trust Footer for Success Page */}
        <div className="w-full max-w-4xl mx-auto pb-20">
          <div className="text-center">
            {SoldVehicleGrid()}
            <h4 className="text-[#41456B] font-bold text-sm md:text-lg mb-8">Join 5,000+ happy drivers in Atlantic Canada.</h4>
            
            {DeliveriesCarousel()}

            <div className="inline-flex items-center gap-2 bg-white px-5 py-2.5 h-12 rounded-full border border-gray-100 shadow-sm mb-10 mt-8">
              <div className="flex gap-1">
                {[1, 2, 3, 4].map((i) => (
                  <Star key={i} className="h-4 w-4 text-brand-accent fill-brand-accent" />
                ))}
                <StarHalf className="h-4 w-4 text-brand-accent fill-brand-accent" />
              </div>
              <span className="text-xs font-bold text-brand-primary uppercase tracking-wider">Google 4.5/5 Rating</span>
            </div>

            <div className="flex flex-col items-center gap-2">
              <div className="flex items-center gap-1.5 text-gray-400">
                <Lock className="h-4 w-4" />
                <p className="text-xs font-bold uppercase tracking-widest">100% Secure & Encrypted</p>
              </div>
              <p className="text-xs text-gray-400 font-medium max-w-[240px] md:max-w-md mx-auto leading-relaxed">
                Your data is protected with 256-bit encryption and handled according to our Privacy Policy.
              </p>
              <div className="flex justify-center gap-4 mt-6">
                <Link to="/privacy" className="text-[10px] text-gray-400 hover:text-brand-primary font-bold uppercase tracking-widest border-b border-gray-200">
                  Privacy Policy
                </Link>
                <Link to="/terms" className="text-[10px] text-gray-400 hover:text-brand-primary font-bold uppercase tracking-widest border-b border-gray-200">
                  Terms of Service
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col overflow-y-auto md:overflow-auto">
      <div className="flex-grow flex flex-col px-4 pt-20 md:pt-32 pb-2 md:pb-10 lg:pt-40">
        <div className="max-w-3xl w-full mx-auto">
          {/* Desktop Secure Badge - Hidden on Mobile */}
          <div className="hidden md:flex justify-center mb-8">
            <motion.div 
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="inline-flex items-center space-x-2 bg-white/50 backdrop-blur-sm px-4 py-2 rounded-full border border-gray-100 shadow-sm"
            >
              <Lock className="h-3 w-3 text-[#7380FF]" />
              <span className="text-xs font-bold text-[#41456B] uppercase tracking-wider">Secure 256-bit SSL Encryption</span>
            </motion.div>
          </div>

          {/* Vehicle Banner - Compressed for Mobile */}
          {(car || (year && make && model)) && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-3 md:mb-8 p-2.5 md:p-6 rounded-xl md:rounded-[2rem] bg-white border border-gray-100 flex items-center gap-3 md:gap-6 shadow-sm"
            >
              {car?.images?.[0] ? (
                <img src={car.images[0]} alt={car.model} className="h-10 w-10 md:h-20 md:w-20 object-cover rounded-lg md:rounded-2xl shadow-md" referrerPolicy="no-referrer" />
              ) : (
                <div className="h-10 w-10 md:h-20 md:w-20 bg-gray-50 rounded-lg md:rounded-2xl flex items-center justify-center">
                  <CarIcon className="h-5 w-5 md:h-10 md:w-10 text-gray-300" />
                </div>
              )}
              <div>
                <p className="text-xs font-bold text-[#7380FF] uppercase tracking-widest mb-0">Applying for</p>
                <h3 className="text-xs md:text-2xl font-display font-bold text-[#41456B]">
                  {car ? `${car.year} ${car.make} ${car.model}` : `${year} ${make} ${model}`}
                </h3>
              </div>
            </motion.div>
          )}

          <div className="text-center mb-6 md:mb-8">
            {rep && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-accent/10 border border-brand-accent/20 text-brand-accent text-xs font-bold uppercase tracking-widest mb-1 md:mb-6"
              >
                <Star className="h-2 w-2 fill-current" />
                You are working with {rep}
              </motion.div>
            )}
            <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-7xl font-display font-black text-brand-primary leading-[1.1] mb-4 tracking-tighter">
              Get Pre-Approved <span className="text-[#7380FF]">in Minutes</span>
            </h1>

            <motion.p 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="text-gray-500 text-sm md:text-lg max-w-xl mx-auto"
            >
              The easiest way to buy a vehicle in Atlantic Canada. Delivered right to your door.
            </motion.p>
          </div>

            <Card ref={cardRef} className="shadow-xl shadow-gray-200/40 border border-gray-100 rounded-[1.5rem] md:rounded-3xl bg-white mt-2 md:mt-0 overflow-hidden">
              {/* Unified Progress Header */}
              <div className="bg-slate-50 px-4 md:px-8 py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-[12px] md:text-[13px] font-bold uppercase tracking-widest text-[#41456B]">Step {step + 1} of 5</span>
                  <div className="h-3 w-px bg-slate-200" />
                  <div className="flex items-center space-x-1.5 text-brand-accent font-bold text-[10px] md:text-[11px] uppercase tracking-widest">
                    <Zap className="h-3.5 w-3.5 fill-current" />
                    <span>Instant</span>
                  </div>
                </div>
              </div>
              
              {/* Slim Progress Bar */}
              <div className="h-1 bg-slate-100 w-full relative z-10">
                <motion.div 
                  className="h-full bg-brand-accent absolute left-0 top-0"
                  initial={{ width: '0%' }}
                  animate={{ width: `${((step + 1) / 5) * 100}%` }}
                  transition={{ duration: 0.5, ease: "easeInOut" }}
                />
              </div>
              
              <CardHeader className="p-4 md:p-8 pb-4 md:pb-8 relative">
                {/* Headline - Global 24px-30px Standard */}
                <div className="w-full">
                  <CardTitle className="text-[24px] md:text-[30px] font-bold text-brand-primary tracking-tight leading-tight">
                    {step === 0 && "What are you looking to drive?"}
                    {step === 1 && "Identity Verification"}
                    {step === 2 && "Contact Information"}
                    {step === 3 && "Financial Information"}
                    {step === 4 && "Residential Address"}
                  </CardTitle>
                </div>
              </CardHeader>
            <CardContent className="p-4 md:p-8 pt-2 md:pt-6 pb-10 md:pb-12">
              <form onSubmit={handleSubmit(
                (data) => {
                  onSubmit(data);
                },

              )} className="space-y-4 md:space-y-8">
              <AnimatePresence mode="wait">
                {step === 0 && (
                  <motion.div
                    key="step0"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    className="space-y-4"
                  >
                    <div className="grid grid-cols-2 gap-3 md:gap-6">
                      {[
                        { id: 'Truck', image: 'https://firebasestorage.googleapis.com/v0/b/gen-lang-client-0753805028.firebasestorage.app/o/vehicle%20cards%20for%20selection%2Ftruck_500px.webp?alt=media', label: 'Truck' },
                        { id: 'SUV', image: 'https://firebasestorage.googleapis.com/v0/b/gen-lang-client-0753805028.firebasestorage.app/o/vehicle%20cards%20for%20selection%2Fsuv_500px.webp?alt=media', label: 'SUV' },
                        { id: 'Sedan', image: 'https://firebasestorage.googleapis.com/v0/b/gen-lang-client-0753805028.firebasestorage.app/o/vehicle%20cards%20for%20selection%2Fsedan_500px.webp?alt=media', label: 'Sedan' },
                        { id: 'Van', image: 'https://firebasestorage.googleapis.com/v0/b/gen-lang-client-0753805028.firebasestorage.app/o/vehicle%20cards%20for%20selection%2Fminivan_500px.webp?alt=media', label: 'Van' },
                      ].map((type) => (
                        <button
                          key={type.id}
                          type="button"
                          onClick={() => {
                            setValue('vehicleType', type.id);
                            setStep(1);
                          }}
                          className={cn(
                            "flex flex-col items-center justify-center p-2 md:p-8 rounded-2xl md:rounded-3xl border-2 transition-all duration-500 group relative overflow-hidden",
                            watch('vehicleType') === type.id
                              ? "border-brand-accent bg-white shadow-[0_0_20px_rgba(115,128,255,0.15)]"
                              : "border-gray-100 bg-white hover:border-brand-accent/50 hover:shadow-xl"
                          )}
                        >
                          <div className="relative w-full h-16 md:h-32 mb-2 md:mb-4 flex items-center justify-center bg-gray-50/50 rounded-xl md:rounded-2xl overflow-hidden">
                            <img 
                              src={type.image} 
                              alt={type.label}
                              className={cn(
                                "w-auto h-full max-h-[80%] object-contain transition-transform duration-500 ease-out group-hover:scale-110",
                                watch('vehicleType') === type.id ? "scale-105" : "scale-100"
                              )}
                              onError={(e) => {
                                // Fallback to icon if image fails
                                e.currentTarget.style.display = 'none';
                                const icon = e.currentTarget.nextElementSibling as HTMLElement;
                                if (icon) icon.style.display = 'block';
                              }}
                              referrerPolicy="no-referrer"
                            />
                            <div className="hidden">
                              {type.id === 'Truck' && <TruckIcon className="h-8 w-8 md:h-12 md:w-12 text-gray-300" />}
                              {type.id === 'SUV' && <SuvIcon className="h-8 w-8 md:h-12 md:w-12 text-gray-300" />}
                              {type.id === 'Sedan' && <CarIcon className="h-8 w-8 md:h-12 md:w-12 text-gray-300" />}
                              {type.id === 'Van' && <VanIcon className="h-8 w-8 md:h-12 md:w-12 text-gray-300" />}
                            </div>
                          </div>
                          <span className={cn(
                            "text-xs md:text-sm font-bold uppercase tracking-[0.2em] transition-colors duration-300",
                            watch('vehicleType') === type.id ? "text-brand-accent" : "text-brand-primary"
                          )}>
                            {type.label}
                          </span>
                        </button>
                      ))}
                    </div>
                  </motion.div>
                )}

                {step === 1 && (
                  <motion.div
                    key="step1"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    className="space-y-4 md:space-y-6"
                  >
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
                      <div className="space-y-1 md:space-y-2">
                        <Label htmlFor="firstName" className="text-sm md:text-base font-bold text-brand-primary uppercase tracking-widest">First Name</Label>
                        <Input 
                          id="firstName" 
                          {...register('firstName')} 
                          onFocus={(e) => e.target.select()}
                          placeholder="John" 
                          className="w-full h-10 md:h-12 px-4 rounded-lg border border-gray-200 focus:border-brand-accent focus:ring-2 focus:ring-brand-accent/20 transition-all outline-none placeholder:text-gray-400" 
                        />
                        {errors.firstName && <p className="text-xs text-red-500 mt-0.5">{errors.firstName.message}</p>}
                      </div>
                      <div className="space-y-1 md:space-y-2">
                        <Label htmlFor="lastName" className="text-sm md:text-base font-bold text-brand-primary uppercase tracking-widest">Last Name</Label>
                        <Input 
                          id="lastName" 
                          {...register('lastName')} 
                          onFocus={(e) => e.target.select()}
                          placeholder="Doe" 
                          className="w-full h-10 md:h-12 px-4 rounded-lg border border-gray-200 focus:border-brand-accent focus:ring-2 focus:ring-brand-accent/20 transition-all outline-none placeholder:text-gray-400" 
                        />
                        {errors.lastName && <p className="text-xs text-red-500 mt-0.5">{errors.lastName.message}</p>}
                      </div>
                    </div>
                    <div className="space-y-1 md:space-y-2">
                      <Label htmlFor="dob" className="text-sm md:text-base font-bold text-[#41456B] uppercase tracking-widest">Date of Birth</Label>
                      <Input 
                        id="dob" 
                        {...register('dob')} 
                        onChange={formatDOB}
                        onFocus={(e) => e.target.select()}
                        inputMode="numeric"
                        placeholder="MM/DD/YYYY" 
                        className={`w-full h-10 md:h-12 px-4 rounded-lg border ${isUnderage ? 'border-red-500' : 'border-gray-200'} focus:border-brand-accent focus:ring-2 focus:ring-brand-accent/20 transition-all outline-none placeholder:text-gray-400`} 
                      />
                      {errors.dob && <p className="text-xs text-red-500 mt-0.5">{errors.dob.message}</p>}
                      {isUnderage && <p className="text-xs text-red-500 mt-0.5">You must be at least 19 years old.</p>}
                    </div>
                  </motion.div>
                )}

                {step === 2 && (
                  <motion.div
                    key="step2"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    className="space-y-4 md:space-y-6"
                  >
                    <div className="space-y-1 md:space-y-2">
                       <Label htmlFor="email" className="text-sm md:text-base font-bold text-brand-primary uppercase tracking-widest">Email Address</Label>
                       <Input 
                         id="email" 
                         type="email" 
                         {...register('email')} 
                         onFocus={(e) => e.target.select()}
                         onBlur={() => {
                           const email = watch('email');
                           if (email && email.includes('@') && email.includes('.')) {
                             syncPartialToPipedrive();
                           }
                         }}
                         placeholder="john@example.com" 
                         className="w-full h-10 md:h-12 px-4 rounded-lg border border-gray-200 focus:border-brand-accent focus:ring-2 focus:ring-brand-accent/20 transition-all outline-none placeholder:text-gray-400" 
                       />
                       {errors.email && <p className="text-xs text-red-500 mt-0.5">{errors.email.message}</p>}
                     </div>
                     <div className="space-y-1 md:space-y-2">
                       <Label htmlFor="phone" className="text-sm md:text-base font-bold text-brand-primary uppercase tracking-widest">Phone Number</Label>
                       <Input 
                         id="phone" 
                         type="tel"
                         {...register('phone')} 
                         onChange={formatPhone}
                         onFocus={(e) => e.target.select()}
                         onBlur={() => {
                           const phone = watch('phone');
                           if (phone && phone.replace(/\D/g, '').length >= 10) {
                             syncPartialToPipedrive();
                           }
                         }}
                         inputMode="numeric"
                         placeholder="(902) 000-0000" 
                         className="w-full h-10 md:h-12 px-4 rounded-lg border border-gray-200 focus:border-brand-accent focus:ring-2 focus:ring-brand-accent/20 transition-all outline-none placeholder:text-gray-400" 
                       />
                       {errors.phone && <p className="text-xs text-red-500 mt-0.5">{errors.phone.message}</p>}
                     </div>
                     <p className="text-[10px] text-gray-400 italic">
                       By providing your contact info, you agree to be contacted regarding your application.
                     </p>
                  </motion.div>
                )}

                {step === 3 && (
                  <motion.div
                    key="step3"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    className="space-y-4 md:space-y-6"
                  >
                    <div className="space-y-1 md:space-y-2">
                       <Label htmlFor="annualIncome" className="text-sm md:text-base font-bold text-brand-primary uppercase tracking-widest">Total Monthly Income (before tax deductions)</Label>
                       <div className="relative">
                         <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                         <Input 
                           id="annualIncome" 
                           {...register('annualIncome')} 
                           onChange={formatNumeric('annualIncome')}
                           onFocus={(e) => e.target.select()}
                           onBlur={() => {
                             if (watch('annualIncome')) syncPartialToPipedrive();
                           }}
                           inputMode="decimal"
                           placeholder="e.g. 5000" 
                           className="w-full h-10 md:h-12 pl-8 pr-4 rounded-lg border border-gray-200 focus:border-brand-accent focus:ring-2 focus:ring-brand-accent/20 transition-all outline-none placeholder:text-gray-400" 
                         />
                       </div>
                       {errors.annualIncome && <p className="text-xs text-red-500 mt-0.5">{errors.annualIncome.message}</p>}
                     </div>
 
                     <div className="space-y-1 md:space-y-2">
                       <Label htmlFor="monthlyHousing" className="text-sm md:text-base font-bold text-brand-primary uppercase tracking-widest">Monthly Rent or Mortgage</Label>
                       <div className="relative">
                         <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                         <Input 
                           id="monthlyHousing" 
                           {...register('monthlyHousing')} 
                           onChange={formatNumeric('monthlyHousing')}
                           onFocus={(e) => e.target.select()}
                           onBlur={() => {
                             if (watch('monthlyHousing')) syncPartialToPipedrive();
                           }}
                           inputMode="decimal"
                           placeholder="e.g. 1500" 
                           className="w-full h-10 md:h-12 pl-8 pr-4 rounded-lg border border-gray-200 focus:border-brand-accent focus:ring-2 focus:ring-brand-accent/20 transition-all outline-none placeholder:text-gray-400" 
                         />
                       </div>
                       {errors.monthlyHousing && <p className="text-xs text-red-500 mt-0.5">{errors.monthlyHousing.message}</p>}
                     </div>
                  </motion.div>
                )}

                {step === 4 && (
                  <motion.div
                    key="step4"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    className="space-y-4 md:space-y-6"
                  >
                    <div className="space-y-1 md:space-y-2">
                      <div className="flex justify-between items-center mb-1">
                        <Label htmlFor="streetAddress" className="text-sm md:text-base font-bold text-[#41456B] uppercase tracking-widest mb-0">Street address</Label>
                        {isGoogleLoaded && (
                          <span className="text-xs font-bold text-green-600 bg-green-50 px-2 py-0.5 rounded-full uppercase tracking-widest">
                            Active
                          </span>
                        )}
                      </div>
                      <Input 
                        id="streetAddress" 
                        {...register('streetAddress')} 
                        onFocus={(e) => e.target.select()}
                        ref={(e) => {
                          register('streetAddress').ref(e);
                          setAddressInputRef(e);
                        }}
                        placeholder="Start typing..." 
                        className="w-full h-10 md:h-12 px-4 rounded-lg border border-gray-200 focus:border-brand-accent focus:ring-2 focus:ring-brand-accent/20 transition-all outline-none placeholder:text-gray-400" 
                      />
                      {errors.streetAddress && <p className="text-xs text-red-500 mt-0.5">{errors.streetAddress.message}</p>}
                    </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-1 md:space-y-2">
                      <Label htmlFor="city" className="text-sm md:text-base font-bold text-brand-primary uppercase tracking-widest">City</Label>
                      <Input 
                        id="city" 
                        {...register('city')} 
                        onFocus={(e) => e.target.select()}
                        placeholder="City" 
                        className="w-full h-10 md:h-12 px-4 rounded-lg border border-gray-200 focus:border-brand-accent focus:ring-2 focus:ring-brand-accent/20 transition-all outline-none placeholder:text-gray-400" 
                      />
                    </div>
                    <div className="space-y-1 md:space-y-2">
                      <Label htmlFor="province" className="text-sm md:text-base font-bold text-brand-primary uppercase tracking-widest">Province</Label>
                      <Input 
                        id="province" 
                        {...register('province')} 
                        onFocus={(e) => e.target.select()}
                        placeholder="Prov" 
                        className="w-full h-10 md:h-12 px-4 rounded-lg border border-gray-200 focus:border-brand-accent focus:ring-2 focus:ring-brand-accent/20 transition-all outline-none placeholder:text-gray-400" 
                      />
                    </div>
                  </div>
                  <div className="space-y-1 md:space-y-2">
                    <Label htmlFor="postalCode" className="text-sm md:text-base font-bold text-brand-primary uppercase tracking-widest">Postal code</Label>
                    <Input 
                      id="postalCode" 
                      {...register('postalCode')} 
                      onChange={formatPostalCode}
                      onFocus={(e) => e.target.select()}
                      autoCapitalize="characters"
                      placeholder="A1B 2C3" 
                      className="w-full h-10 md:h-12 px-4 rounded-lg border border-gray-200 focus:border-brand-accent focus:ring-2 focus:ring-brand-accent/20 transition-all outline-none placeholder:text-gray-400" 
                    />
                      {errors.postalCode && <p className="text-xs text-red-500 mt-0.5">{errors.postalCode.message}</p>}
                    </div>

                    <div className="space-y-3 pt-4">
                      <p className="text-[10px] md:text-xs text-gray-400 text-center leading-relaxed">
                        By clicking "Submit Application", you confirm that the information provided is accurate and you agree to VAC's <a href="/terms" className="text-[#7380FF] hover:underline">Terms of Service</a> and <a href="/privacy" className="text-[#7380FF] hover:underline">Privacy Policy</a>.
                      </p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="flex flex-col gap-3 pt-4 md:pt-8">
                {error && (
                  <div className="p-3 bg-red-50 text-red-600 rounded-lg text-[10px] font-medium">
                    {error}
                  </div>
                )}
                <div className="flex gap-3 md:gap-4">
                  {step > 0 && (
                    <Button 
                      type="button" 
                      variant="outline" 
                      onClick={prevStep} 
                      className="h-12 md:h-14 px-5 md:px-10 border-slate-200 text-brand-primary hover:bg-slate-50 transition-all flex items-center justify-center rounded-xl md:rounded-2xl"
                    >
                      <ArrowLeft className="h-5 w-5" />
                      <span className="hidden md:inline ml-2">Back</span>
                    </Button>
                  )}
                  {step < 4 ? (
                    <div className="flex-1 flex flex-col gap-3">
                      {step === 0 ? (
                        // Hide continue button on step 0 as selecting a vehicle advances automatically
                        null
                      ) : (
                        <>
                          {isUnderage && (
                            <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg flex items-start gap-2">
                              <AlertTriangle className="h-4 w-4 shrink-0" />
                              <p className="text-[10px] font-medium leading-tight">
                                Must be 19+ to apply.
                              </p>
                            </div>
                          )}
                          <Button 
                            type="button" 
                            onClick={nextStep} 
                            disabled={isUnderage}
                            variant="brand"
                            className="w-full h-12 md:h-14 rounded-xl md:rounded-2xl shadow-md hover:brightness-110 transition-all font-bold uppercase tracking-widest text-[11px]"
                          >
                            <span>{isUnderage ? 'INELIGIBLE' : 'GET APPROVED'}</span>
                            <ArrowRight className="ml-2 h-4 w-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  ) : (
                    <div className="flex-1 flex flex-col gap-2">
                      <Button 
                        type="submit" 
                        disabled={isSubmitting || isUnderage} 
                        variant="brand"
                        className="w-full h-12 md:h-14 rounded-xl md:rounded-2xl shadow-md hover:brightness-110 transition-all font-bold uppercase tracking-widest text-[11px]"
                      >
                        {isSubmitting ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            <span>PROCESSING...</span>
                          </>
                        ) : (
                          <span>GET APPROVED</span>
                        )}
                      </Button>
                    </div>
                  )}
                </div>
                {step > 0 && step < 4 && (
                  <p className="text-center text-[9px] md:text-xs text-gray-400 font-medium">
                    Next: {step === 1 ? 'Contact details' : step === 2 ? 'Income & housing' : 'Final address verification'}
                  </p>
                )}
              </div>
            </form>
          </CardContent>
        </Card>
      </div>

      {/* Trust Footer - Now visible on both mobile and desktop */}
        <div className="mt-12 md:mt-24 pb-20 px-4">
          <div className="max-w-4xl mx-auto text-center">
            {SoldVehicleGrid()}
            <h4 className="text-[#41456B] font-bold text-sm md:text-lg mb-8">Join 5,000+ happy drivers in Atlantic Canada.</h4>
            
            {/* Horizontal Scroll of Deliveries */}
            {DeliveriesCarousel()}

            {/* Google Review Badge */}
            <div className="inline-flex items-center gap-2 bg-white px-5 py-2.5 h-12 rounded-full border border-gray-100 shadow-sm mb-10 mt-8">
              <div className="flex gap-0.5">
                {[1, 2, 3, 4].map((i) => (
                  <Star key={i} className="h-3.5 w-3.5 text-[#7380FF] fill-[#7380FF]" />
                ))}
                <StarHalf className="h-3.5 w-3.5 text-[#7380FF] fill-[#7380FF]" />
              </div>
              <span className="text-[10px] md:text-xs font-bold text-[#41456B] uppercase tracking-wider">Google 4.5/5 Rating</span>
            </div>

            {/* Privacy Micro-copy */}
            <div className="flex flex-col items-center gap-2">
              <div className="flex items-center gap-1.5 text-gray-400">
                <Lock className="h-3 w-3" />
                <p className="text-[10px] font-medium uppercase tracking-widest">100% Secure & Encrypted</p>
              </div>
              <p className="text-[10px] text-gray-400 font-medium max-w-[240px] md:max-w-md mx-auto leading-relaxed">
                Your data is protected with 256-bit encryption and handled according to our Privacy Policy.
              </p>
              <div className="flex justify-center gap-4 mt-6">
                <Link to="/privacy" className="text-[10px] text-gray-400 hover:text-brand-primary font-bold uppercase tracking-widest border-b border-gray-200">
                  Privacy Policy
                </Link>
                <Link to="/terms" className="text-[10px] text-gray-400 hover:text-brand-primary font-bold uppercase tracking-widest border-b border-gray-200">
                  Terms of Service
                </Link>
              </div>
            </div>
            
          </div>
        </div>
      </div>
    </div>
  );
}
