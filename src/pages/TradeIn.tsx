import React, { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  CheckCircle2,
  Loader2,
  TrendingUp,
  ShieldCheck,
  Sparkles,
  ArrowRight,
  Info,
  Clock
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { canadianMakes, canadianVehicleMakesAndModels } from '@/data/canadianVehicles';

import { getStoredUtms } from '@/lib/utms';

type EstimateResult =
  | { status: 'estimate'; low: number; high: number; comps: number; source: string }
  | { status: 'manual' };

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: CURRENT_YEAR - 1990 + 1 }, (_, i) => String(CURRENT_YEAR - i));

const CONDITIONS = [
  { value: 'excellent', label: 'Excellent' },
  { value: 'good', label: 'Good' },
  { value: 'fair', label: 'Fair' },
  { value: 'needs_work', label: 'Needs work' },
];

const selectClass =
  'w-full h-14 rounded-2xl border border-slate-200 bg-white px-4 text-lg text-slate-900 focus:border-[#7380FF] focus:outline-none focus:ring-2 focus:ring-[#7380FF]/10 disabled:bg-slate-50 disabled:text-slate-400';

export default function TradeIn() {
  const navigate = useNavigate();
  const location = useLocation();
  const [step, setStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<EstimateResult | null>(null);
  const [formData, setFormData] = useState({
    year: '',
    make: '',
    model: '',
    trim: '',
    mileage: '',
    condition: 'good',
    vin: '',
    name: '',
    email: '',
    phone: ''
  });

  React.useEffect(() => {
    if (location.pathname.endsWith('/success')) {
      setStep(4);
    }
  }, [location.pathname]);

  React.useEffect(() => {
    // Scroll to top when step changes for better mobile UX
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [step]);

  const modelsForMake = formData.make
    ? canadianVehicleMakesAndModels[formData.make] || []
    : [];

  const getEstimate = async () => {
    if (!formData.year || !formData.make || !formData.model || !formData.mileage) {
      toast.error('Please fill in all vehicle details');
      return;
    }
    setIsSubmitting(true);
    try {
      const resp = await fetch('/api/trade-in/estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          year: parseInt(formData.year, 10),
          make: formData.make,
          model: formData.model,
          trim: formData.trim || undefined,
          mileageKm: parseInt(formData.mileage.replace(/\D/g, ''), 10) || 0,
          condition: formData.condition,
          vin: formData.vin || undefined,
        }),
      });
      const data = resp.ok ? await resp.json() : { status: 'manual' };
      setResult(data.status === 'estimate' ? data : { status: 'manual' });
    } catch {
      setResult({ status: 'manual' });
    } finally {
      setIsSubmitting(false);
      setStep(2);
    }
  };

  const formatPhone = (value: string) => {
    const cleaned = value.replace(/\D/g, "");
    if (cleaned.length === 0) return "";

    let formatted = "";
    if (cleaned.length <= 3) {
      formatted = `(${cleaned}`;
    } else if (cleaned.length <= 6) {
      formatted = `(${cleaned.slice(0, 3)}) ${cleaned.slice(3)}`;
    } else {
      formatted = `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6, 10)}`;
    }
    return formatted;
  };

  const finalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (formData.phone.replace(/\D/g, "").length < 10) {
      toast.error("Please enter a valid 10-digit phone number");
      return;
    }

    setIsSubmitting(true);
    try {
      const estimateLine =
        result?.status === 'estimate'
          ? `Instant Estimate: $${result.low.toLocaleString()} - $${result.high.toLocaleString()} (${result.comps} comps, ${result.source})`
          : 'Manual appraisal required (no instant estimate shown)';

      const response = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...getStoredUtms(),
          title: `Trade-In: ${formData.name}`,
          name: formData.name,
          email: formData.email,
          phone: formData.phone,
          isTradeIn: true,
          notes: `Vehicle: ${formData.year} ${formData.make} ${formData.model} ${formData.trim}\nMileage: ${formData.mileage}km\nCondition: ${formData.condition}\n${formData.vin ? `VIN: ${formData.vin}\n` : ''}${estimateLine}`
        })
      });

      if (response.ok) {
        setStep(4);
        if (!location.pathname.endsWith('/success')) {
          navigate('/trade-in/success', { replace: true });
        }
      } else {
        throw new Error("Failed to send lead");
      }
    } catch (err) {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 pt-24 pb-20">
      <div className="max-w-4xl mx-auto px-4">
        {/* Header */}
        <div className="text-center mb-12">
          <Badge className="bg-indigo-50 text-indigo-600 border-indigo-100 mb-6 px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider">
            Modern Trade-In Experience
          </Badge>
          <h1 className="text-4xl md:text-5xl lg:text-7xl font-display font-black text-brand-primary leading-[1.1] mb-8 tracking-tighter">
            Get your <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#7380FF] to-indigo-600">instant</span> appraisal.
          </h1>
          <p className="text-lg md:text-xl text-slate-500 max-w-2xl mx-auto leading-relaxed">
            Stop guessing your car's value. We compare live vehicle listings across Canada to give you a real market-based estimate in seconds.
          </p>
        </div>

        <div className="bg-white rounded-[2.5rem] shadow-[0_20px_60px_-15px_rgba(0,0,0,0.08)] border border-slate-100 overflow-hidden">
          {/* Progress Indicator */}
          <div className="flex border-b border-slate-50">
            {[1, 2, 3].map((s) => (
              <div
                key={s}
                className={cn(
                  "flex-1 h-1 transition-all duration-500",
                  step >= s ? "bg-[#7380FF]" : "bg-slate-100"
                )}
              />
            ))}
          </div>

          <div className="p-8 md:p-12">
            <AnimatePresence mode="wait">
              {step === 1 && (
                <motion.div
                  key="step1"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="space-y-8"
                >
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <Label className="text-xs font-bold uppercase tracking-widest text-slate-400">Year</Label>
                      <select
                        value={formData.year}
                        onChange={(e) => setFormData({ ...formData, year: e.target.value })}
                        className={selectClass}
                      >
                        <option value="">Select year</option>
                        {YEARS.map((y) => (
                          <option key={y} value={y}>{y}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs font-bold uppercase tracking-widest text-slate-400">Make</Label>
                      <select
                        value={formData.make}
                        onChange={(e) => setFormData({ ...formData, make: e.target.value, model: '' })}
                        className={selectClass}
                      >
                        <option value="">Select make</option>
                        {canadianMakes.map((m) => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs font-bold uppercase tracking-widest text-slate-400">Model</Label>
                      <select
                        value={formData.model}
                        onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                        disabled={!formData.make}
                        className={selectClass}
                      >
                        <option value="">{formData.make ? 'Select model' : 'Select make first'}</option>
                        {modelsForMake.map((m) => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs font-bold uppercase tracking-widest text-slate-400">Trim / Edition (Optional)</Label>
                      <Input
                        placeholder="e.g. Touring / Si"
                        value={formData.trim}
                        onChange={(e) => setFormData({...formData, trim: e.target.value})}
                        className="h-14 rounded-2xl border-slate-200 focus:border-[#7380FF] focus:ring-[#7380FF]/10 text-lg"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs font-bold uppercase tracking-widest text-slate-400">Mileage (KM)</Label>
                      <Input
                        placeholder="e.g. 85000"
                        inputMode="numeric"
                        value={formData.mileage}
                        onChange={(e) => setFormData({...formData, mileage: e.target.value})}
                        className="h-14 rounded-2xl border-slate-200 focus:border-[#7380FF] focus:ring-[#7380FF]/10 text-lg"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs font-bold uppercase tracking-widest text-slate-400">Condition</Label>
                      <select
                        value={formData.condition}
                        onChange={(e) => setFormData({ ...formData, condition: e.target.value })}
                        className={selectClass}
                      >
                        {CONDITIONS.map((c) => (
                          <option key={c.value} value={c.value}>{c.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <Label className="text-xs font-bold uppercase tracking-widest text-slate-400">VIN (Optional — for the most accurate offer)</Label>
                      <Input
                        placeholder="e.g. 2HGFC2F59KH000000"
                        value={formData.vin}
                        onChange={(e) => setFormData({...formData, vin: e.target.value.toUpperCase()})}
                        className="h-14 rounded-2xl border-slate-200 focus:border-[#7380FF] focus:ring-[#7380FF]/10 text-lg"
                      />
                    </div>
                  </div>

                  <div className="pt-4">
                    <Button
                      onClick={getEstimate}
                      disabled={isSubmitting}
                      className="w-full h-16 rounded-2xl bg-slate-900 text-white font-bold text-lg hover:bg-slate-800 transition-all flex items-center justify-center gap-3 shadow-xl"
                    >
                      {isSubmitting ? (
                        <>
                          <Loader2 className="h-6 w-6 animate-spin" />
                          Analyzing Market Data...
                        </>
                      ) : (
                        <>
                          <Sparkles className="h-6 w-6" />
                          Generate My Instant Estimate
                        </>
                      )}
                    </Button>
                  </div>

                  <div className="flex items-center justify-center gap-8 pt-8 opacity-40">
                    <div className="flex items-center gap-2">
                      <TrendingUp className="h-4 w-4" />
                      <span className="text-[10px] uppercase font-bold tracking-widest">Live Market Pulse</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="h-4 w-4" />
                      <span className="text-[10px] uppercase font-bold tracking-widest">Safe & Secured</span>
                    </div>
                  </div>
                </motion.div>
              )}

              {step === 2 && result?.status === 'estimate' && (
                <motion.div
                  key="step2"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-8 text-center"
                >
                  <div className="inline-flex items-center gap-2 px-4 py-2 bg-green-50 rounded-full text-green-600 border border-green-100">
                    <CheckCircle2 className="h-4 w-4" />
                    <span className="text-xs font-bold uppercase tracking-wider">Analysis Complete</span>
                  </div>

                  <div className="space-y-2">
                    <p className="text-slate-400 text-sm font-medium">Estimated Trade-In Range for your {formData.year} {formData.make}:</p>
                    <div className="text-6xl md:text-7xl font-display font-bold text-slate-900 tracking-tighter">
                      ${result.low.toLocaleString()} - ${result.high.toLocaleString()}
                    </div>
                    <p className="text-slate-400 text-xs italic">*Conditional offer based on {result.comps} comparable Canadian listings — confirmed at inspection or doorstep pickup.</p>
                  </div>

                  <div className="bg-slate-50 rounded-3xl p-8 border border-slate-100 flex flex-col md:flex-row items-center gap-6 text-left">
                    <div className="h-16 w-16 bg-white rounded-2xl flex items-center justify-center shadow-sm shrink-0">
                      <TrendingUp className="h-8 w-8 text-[#7380FF]" />
                    </div>
                    <div>
                      <h4 className="font-bold text-slate-900 mb-1">Make this a Guaranteed Offer</h4>
                      <p className="text-sm text-slate-500 leading-relaxed">Provide your last few details so we can confirm this offer and schedule your doorstep pickup.</p>
                    </div>
                    <Button
                      onClick={() => setStep(3)}
                      className="shrink-0 h-14 px-8 rounded-xl bg-[#7380FF] hover:bg-[#5e41cc] text-white font-bold"
                    >
                      Get Confirmed Offer
                    </Button>
                  </div>
                </motion.div>
              )}

              {step === 2 && result?.status === 'manual' && (
                <motion.div
                  key="step2manual"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-8 text-center"
                >
                  <div className="inline-flex items-center gap-2 px-4 py-2 bg-amber-50 rounded-full text-amber-600 border border-amber-100">
                    <Clock className="h-4 w-4" />
                    <span className="text-xs font-bold uppercase tracking-wider">Personalized Appraisal</span>
                  </div>

                  <div className="space-y-3 max-w-lg mx-auto">
                    <h3 className="text-3xl font-display font-bold text-slate-900">Your vehicle deserves a closer look.</h3>
                    <p className="text-slate-500 leading-relaxed">We couldn't find enough comparable listings to give your {formData.year} {formData.make} {formData.model} an instant number — so our buyer will prepare a personalized appraisal and send it to you within 24 hours.</p>
                  </div>

                  <div className="bg-slate-50 rounded-3xl p-8 border border-slate-100 flex flex-col md:flex-row items-center gap-6 text-left">
                    <div className="h-16 w-16 bg-white rounded-2xl flex items-center justify-center shadow-sm shrink-0">
                      <ShieldCheck className="h-8 w-8 text-[#7380FF]" />
                    </div>
                    <div>
                      <h4 className="font-bold text-slate-900 mb-1">Get Your Personalized Appraisal</h4>
                      <p className="text-sm text-slate-500 leading-relaxed">Leave your contact details and our team will get to work on your offer right away.</p>
                    </div>
                    <Button
                      onClick={() => setStep(3)}
                      className="shrink-0 h-14 px-8 rounded-xl bg-[#7380FF] hover:bg-[#5e41cc] text-white font-bold"
                    >
                      Continue
                    </Button>
                  </div>
                </motion.div>
              )}

              {step === 3 && (
                <motion.div
                  key="step3"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="space-y-6"
                >
                  <div className="space-y-2 mb-8">
                    <h3 className="text-2xl font-display font-bold text-slate-900">Final Step</h3>
                    <p className="text-slate-500">Provide your contact details to receive your official appraisal and connect with our team.</p>
                  </div>

                  <form onSubmit={finalSubmit} className="space-y-6">
                    <div className="space-y-2">
                      <Label className="text-xs font-bold uppercase tracking-widest text-slate-400">Full Name</Label>
                      <Input
                        required
                        placeholder="John Doe"
                        value={formData.name}
                        onChange={(e) => setFormData({...formData, name: e.target.value})}
                        className="h-14 rounded-2xl border-slate-200"
                      />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <Label className="text-xs font-bold uppercase tracking-widest text-slate-400">Email</Label>
                        <Input
                          type="email"
                          required
                          placeholder="john@example.com"
                          value={formData.email}
                          onChange={(e) => setFormData({...formData, email: e.target.value})}
                          className="h-14 rounded-2xl border-slate-200"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs font-bold uppercase tracking-widest text-slate-400">Phone</Label>
                        <Input
                          required
                          type="tel"
                          placeholder="(902) 000-0000"
                          value={formData.phone}
                          onChange={(e) => setFormData({...formData, phone: formatPhone(e.target.value)})}
                          className="h-14 rounded-2xl border-slate-200"
                        />
                      </div>
                    </div>
                    <Button
                      type="submit"
                      disabled={isSubmitting}
                      className="w-full h-16 rounded-2xl bg-[#7380FF] text-white font-bold text-lg hover:bg-[#5e41cc] shadow-xl shadow-[#7380FF]/20"
                    >
                      {isSubmitting ? <Loader2 className="h-6 w-6 animate-spin" /> : "Request Official Offer"}
                    </Button>
                  </form>
                </motion.div>
              )}

              {step === 4 && (
                <motion.div
                  key="step4"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="text-center py-12 space-y-6"
                >
                  <div className="h-20 w-20 bg-green-50 rounded-full flex items-center justify-center mx-auto">
                    <CheckCircle2 className="h-10 w-10 text-green-500" />
                  </div>
                  <div className="space-y-2">
                    <h2 className="text-3xl font-display font-bold text-slate-900">Offer Requested!</h2>
                    <p className="text-slate-500 max-w-sm mx-auto">Our appraisers are reviewing your data. A specialist will follow up shortly to finalize your guaranteed trade-in offer.</p>
                  </div>
                  <Button asChild variant="outline" className="h-14 px-8 rounded-xl border-slate-200">
                    <Link to="/inventory" className="flex items-center gap-2">
                       Browse Inventory <ArrowRight className="h-4 w-4" />
                    </Link>
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Benefits Section */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-20">
          <div className="p-6 bg-white rounded-[2rem] border border-slate-100 shadow-sm relative group overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:scale-110 transition-transform">
              <Sparkles className="h-24 w-24" />
            </div>
            <div className="h-12 w-12 bg-indigo-50 rounded-xl flex items-center justify-center mb-6">
              <TrendingUp className="h-6 w-6 text-[#7380FF]" />
            </div>
            <h4 className="font-bold text-slate-900 mb-2">Live Market Data</h4>
            <p className="text-sm text-slate-500 leading-relaxed">We compare active listings across Canada to ensure you get more for your car.</p>
          </div>

          <div className="p-6 bg-white rounded-[2rem] border border-slate-100 shadow-sm relative group overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:scale-110 transition-transform">
              <ShieldCheck className="h-24 w-24" />
            </div>
            <div className="h-12 w-12 bg-green-50 rounded-xl flex items-center justify-center mb-6">
              <ShieldCheck className="h-6 w-6 text-green-500" />
            </div>
            <h4 className="font-bold text-slate-900 mb-2">No Low-Ball Offers</h4>
            <p className="text-sm text-slate-500 leading-relaxed">Our process is transparent. We show you exactly what the market is doing so you can trade with confidence.</p>
          </div>

          <div className="p-6 bg-white rounded-[2rem] border border-slate-100 shadow-sm relative group overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:scale-110 transition-transform">
              <ArrowRight className="h-24 w-24" />
            </div>
            <div className="h-12 w-12 bg-amber-50 rounded-xl flex items-center justify-center mb-6">
              <Info className="h-6 w-6 text-amber-500" />
            </div>
            <h4 className="font-bold text-slate-900 mb-2">Doorstep Pickup</h4>
            <p className="text-sm text-slate-500 leading-relaxed">When you buy your new car, we'll swap it for your trade-in right at your doorstep. Zero friction.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
