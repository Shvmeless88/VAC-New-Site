import React, { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Car, 
  Search, 
  ChevronRight, 
  CheckCircle2, 
  Loader2, 
  TrendingUp, 
  ShieldCheck, 
  Sparkles,
  ArrowRight,
  Info
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { GoogleGenAI } from "@google/genai";

import { getStoredUtms } from '@/lib/utms';

export default function TradeIn() {
  const navigate = useNavigate();
  const location = useLocation();
  const [step, setStep] = useState(1);
  const [mode, setMode] = useState<'sell' | 'trade'>('sell');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [estimate, setEstimate] = useState<{ low: number, high: number } | null>(null);
  const [formData, setFormData] = useState({
    year: '',
    make: '',
    model: '',
    trim: '',
    mileage: '',
    condition: 'good',
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

  const getEstimate = async () => {
    if (!formData.year || !formData.make || !formData.model || !formData.mileage) {
      toast.error("Please fill in all vehicle details");
      return;
    }
    
    setIsSubmitting(true);
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) throw new Error("GEMINI_API_KEY is not available");

      const ai = new GoogleGenAI({ apiKey });
      const cleanMileage = formData.mileage.replace(/\D/g, "");
      
      const prompt = `What is the estimated trade-in value (low and high range) for a ${formData.year} ${formData.make} ${formData.model} ${formData.trim || ""} with ${cleanMileage}km in "${formData.condition || "Good"}" condition in Atlantic Canada? 
      
      CRITICAL INSTRUCTIONS:
      1. Return ONLY a valid JSON object.
      2. The object must contain keys "low" and "high".
      3. The values for "low" and "high" must be integers representing CAD.
      4. Do not include currency symbols, commas, or any other formatting in the numbers.
      
      Example valid response: {"low": 15000, "high": 18000}`;

      const result = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          responseMimeType: "application/json"
        }
      });

      const responseText = result.text || (result as any).response?.text?.() || "";
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON object found in AI response");
      }

      const data = JSON.parse(jsonMatch[0]);
      
      const cleanValue = (val: any) => {
        if (typeof val === 'number') return Math.round(val);
        if (typeof val === 'string') {
          return parseInt(val.replace(/[^\d]/g, ""), 10);
        }
        return null;
      };

      const low = cleanValue(data.low);
      const high = cleanValue(data.high);

      if (low !== null && high !== null && !isNaN(low) && !isNaN(high)) {
        setEstimate({ low, high });
        setStep(2);
      } else {
        throw new Error("Invalid response format from AI");
      }
    } catch (err: any) {
      console.error("Appraisal request failed:", err);
      // Fallback calculation logic similar to server
      try {
        const currentYear = new Date().getFullYear();
        const age = currentYear - parseInt(formData.year, 10);
        let baseValue = 40000 * Math.pow(0.85, Math.max(0, age));
        
        const conditionMap: Record<string, number> = {
          "excellent": 1.1,
          "good": 1.0,
          "fair": 0.8,
          "poor": 0.6
        };
        const multiplier = conditionMap[formData.condition] || 1.0;
        const mileageVal = parseInt(formData.mileage.replace(/\D/g, ""), 10) || 0;
        let estimateVal = (baseValue * multiplier) - (mileageVal * 0.10);
        estimateVal = Math.max(500, estimateVal);
        
        const low = Math.round(estimateVal * 0.9);
        const high = Math.round(estimateVal * 1.1);
        
        setEstimate({ low, high });
        setStep(2);
      } catch (fallbackErr) {
        toast.error(`Could not generate estimate. Please continue for a manual appraisal.`);
        setStep(3);
      }
    } finally {
      setIsSubmitting(false);
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
      // Here you would normally send to your lead API (Pipedrive/Firebase)
      const response = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...getStoredUtms(),
          title: `${mode === 'sell' ? 'Sell' : 'Trade-In'}: ${formData.name}`,
          name: formData.name,
          email: formData.email,
          phone: formData.phone,
          isTradeIn: true,
          intent: mode === 'sell' ? 'sell' : 'trade',
          notes: `Intent: ${mode === 'sell' ? 'Sell for cash' : 'Trade toward a purchase'}\nVehicle: ${formData.year} ${formData.make} ${formData.model} ${formData.trim}\nMileage: ${formData.mileage}km\nCondition: ${formData.condition}\nAI Estimate: $${estimate?.low?.toLocaleString()} - $${estimate?.high?.toLocaleString()}`
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
            Instant Offer • 100% Online
          </Badge>
          <h1 className="text-4xl md:text-5xl lg:text-7xl font-display font-black text-brand-primary leading-[1.1] mb-8 tracking-tighter">
            {mode === 'sell' ? (
              <>Sell your car for <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#7380FF] to-indigo-600">cash</span>.</>
            ) : (
              <>Trade in. <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#7380FF] to-indigo-600">Upgrade</span> easy.</>
            )}
          </h1>
          <p className="text-lg md:text-xl text-slate-500 max-w-2xl mx-auto leading-relaxed">
            {mode === 'sell'
              ? "Get a real offer for your vehicle in seconds — no obligation to buy. We handle the paperwork and pick it up at your door across Atlantic Canada."
              : "Roll your current car's value into your next one. Get an instant estimate, then we swap it at your doorstep when we deliver."}
          </p>

          {step === 1 && (
            <div className="inline-flex items-center gap-1 mt-8 p-1.5 bg-white rounded-full border border-slate-100 shadow-sm">
              <button
                type="button"
                onClick={() => setMode('sell')}
                className={cn(
                  "px-6 py-2.5 rounded-full text-sm font-bold transition-all",
                  mode === 'sell' ? "bg-[#7380FF] text-white shadow-md" : "text-slate-500 hover:text-slate-800"
                )}
              >
                Sell for cash
              </button>
              <button
                type="button"
                onClick={() => setMode('trade')}
                className={cn(
                  "px-6 py-2.5 rounded-full text-sm font-bold transition-all",
                  mode === 'trade' ? "bg-[#7380FF] text-white shadow-md" : "text-slate-500 hover:text-slate-800"
                )}
              >
                Trade toward a purchase
              </button>
            </div>
          )}
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
                      <Input 
                        placeholder="e.g. 2018"
                        value={formData.year}
                        onChange={(e) => setFormData({...formData, year: e.target.value})}
                        className="h-14 rounded-2xl border-slate-200 focus:border-[#7380FF] focus:ring-[#7380FF]/10 text-lg"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs font-bold uppercase tracking-widest text-slate-400">Make</Label>
                      <Input 
                        placeholder="e.g. Honda"
                        value={formData.make}
                        onChange={(e) => setFormData({...formData, make: e.target.value})}
                        className="h-14 rounded-2xl border-slate-200 focus:border-[#7380FF] focus:ring-[#7380FF]/10 text-lg"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs font-bold uppercase tracking-widest text-slate-400">Model</Label>
                      <Input 
                        placeholder="e.g. Civic"
                        value={formData.model}
                        onChange={(e) => setFormData({...formData, model: e.target.value})}
                        className="h-14 rounded-2xl border-slate-200 focus:border-[#7380FF] focus:ring-[#7380FF]/10 text-lg"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs font-bold uppercase tracking-widest text-slate-400">Trim / Edition</Label>
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
                        value={formData.mileage}
                        onChange={(e) => setFormData({...formData, mileage: e.target.value})}
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

              {step === 2 && estimate && (
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
                      ${estimate.low.toLocaleString()} - ${estimate.high.toLocaleString()}
                    </div>
                    <p className="text-slate-400 text-xs italic">*Estimated based on current market conditions in Atlantic Canada.</p>
                  </div>

                  <div className="bg-slate-50 rounded-3xl p-8 border border-slate-100 flex flex-col md:flex-row items-center gap-6 text-left">
                    <div className="h-16 w-16 bg-white rounded-2xl flex items-center justify-center shadow-sm shrink-0">
                      <TrendingUp className="h-8 w-8 text-[#7380FF]" />
                    </div>
                    <div>
                      <h4 className="font-bold text-slate-900 mb-1">Make this a guaranteed offer</h4>
                      <p className="text-sm text-slate-500 leading-relaxed">Provide your last few details so we can confirm this offer and {mode === 'sell' ? 'arrange payment and doorstep pickup' : 'schedule your doorstep swap'}.</p>
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
            <p className="text-sm text-slate-500 leading-relaxed">We sync with active auction and retail data across Canada to ensure you get more for your car.</p>
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
            <p className="text-sm text-slate-500 leading-relaxed">{mode === 'sell' ? "We come to you anywhere in Atlantic Canada, hand you payment, and drive it away. Zero friction." : "When we deliver your new car, we swap it for your trade-in right at your doorstep. Zero friction."}</p>
          </div>
        </div>

        {/* How It Works */}
        <div className="mt-24">
          <h2 className="text-3xl md:text-4xl font-display font-bold text-brand-primary text-center mb-4 tracking-tight">How it works</h2>
          <p className="text-slate-500 text-center max-w-xl mx-auto mb-14">Three simple steps from your driveway to done.</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              { n: '1', t: 'Tell us about your car', d: 'Enter your year, make, model and mileage. Takes about 60 seconds.' },
              { n: '2', t: 'Get your instant offer', d: 'Our AI checks live Atlantic Canada market data and gives you a real value range on the spot.' },
              { n: '3', t: mode === 'sell' ? 'Get paid at your door' : 'Swap it on delivery', d: mode === 'sell' ? 'Accept the offer and we come to you, hand over payment, and drive it away.' : 'We apply the value to your new car and swap vehicles when we deliver.' },
            ].map((s) => (
              <div key={s.n} className="relative">
                <div className="h-12 w-12 rounded-2xl bg-[#7380FF] text-white font-display font-bold text-xl flex items-center justify-center mb-5 shadow-lg shadow-[#7380FF]/20">{s.n}</div>
                <h4 className="font-bold text-slate-900 text-lg mb-2">{s.t}</h4>
                <p className="text-sm text-slate-500 leading-relaxed">{s.d}</p>
              </div>
            ))}
          </div>
        </div>

        {/* FAQ */}
        <div className="mt-24 max-w-3xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-display font-bold text-brand-primary text-center mb-14 tracking-tight">Frequently asked questions</h2>
          <div className="space-y-4">
            {[
              { q: 'Is the offer really instant?', a: 'Yes. You get an estimated value range immediately from live market data. A specialist then confirms your final, guaranteed offer.' },
              { q: 'Do I have to buy a car to sell you mine?', a: 'No. You can sell us your vehicle for cash with no obligation to purchase. If you are buying, you can trade it in and roll the value into your next car.' },
              { q: 'What if my car is financed or leased?', a: 'That is common and not a problem. Let us know during the process and our team handles the payout details with your lender or lessor.' },
              { q: 'Where do you operate?', a: 'We serve all of Atlantic Canada and pick up your vehicle right at your door.' },
              { q: 'How do I get paid?', a: 'Once you accept the final offer, we arrange payment at pickup — fast, secure, and paperwork handled for you.' },
            ].map((f, i) => (
              <details key={i} className="group bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                <summary className="flex items-center justify-between gap-4 cursor-pointer list-none p-6 font-bold text-slate-900">
                  {f.q}
                  <ChevronRight className="h-5 w-5 text-[#7380FF] shrink-0 transition-transform group-open:rotate-90" />
                </summary>
                <p className="px-6 pb-6 text-sm text-slate-500 leading-relaxed">{f.a}</p>
              </details>
            ))}
          </div>
        </div>

        {/* Bottom CTA */}
        <div className="mt-20 text-center">
          <Button
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            className="h-14 px-10 rounded-2xl bg-[#7380FF] hover:bg-[#5e41cc] text-white font-bold text-lg shadow-xl shadow-[#7380FF]/20"
          >
            Get my instant offer
          </Button>
        </div>
      </div>
    </div>
  );
}
