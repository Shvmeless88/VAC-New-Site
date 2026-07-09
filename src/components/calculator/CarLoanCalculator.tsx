import React, { useState, useEffect } from 'react';
import { motion, animate, AnimatePresence } from 'motion/react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import { calculateBiWeeklyPayment, cn } from '@/lib/utils';
import { Car } from '@/types';
import { Lock, ShieldCheck, RotateCw } from 'lucide-react';
import { NumericFormat } from 'react-number-format';

function FloatingLabelInput({ 
  label, 
  value, 
  onChange, 
  prefix, 
  suffix,
}: { 
  label: string; 
  value: number | string; 
  onChange: (val: string) => void;
  prefix?: string;
  suffix?: string;
}) {
  const [isFocused, setIsFocused] = useState(false);
  const isEmpty = value === '';

  return (
    <div className="relative group">
      <div 
        className={cn(
          "relative h-16 rounded-xl transition-all duration-300 border overflow-hidden",
          isFocused 
            ? "border-brand-secondary ring-2 ring-brand-secondary/20 bg-white" 
            : "border-slate-200 bg-slate-50 hover:bg-slate-100/50"
        )}
      >
        <label 
          className={cn(
            "absolute left-4 transition-all duration-300 pointer-events-none uppercase tracking-widest font-black",
            (isFocused || !isEmpty) 
              ? "top-2 text-[8px] text-brand-secondary opacity-100" 
              : "top-1/2 -translate-y-1/2 text-slate-400 opacity-60 text-[10px]"
          )}
        >
          {label}
        </label>
        
        <div className="flex items-center h-full pt-4 px-4">
          {prefix && (isFocused || !isEmpty) && (
            <span className="text-slate-400 mr-1 font-bold text-lg leading-none">$</span>
          )}
          <NumericFormat
            value={value}
            onValueChange={(values) => {
              onChange(values.value);
            }}
            thousandSeparator=","
            decimalScale={label.toLowerCase().includes('rate') ? 2 : 0}
            allowNegative={false}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            className="w-full bg-transparent border-none outline-none text-brand-primary font-bold text-lg p-0 h-8 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          {suffix && (isFocused || !isEmpty) && (
            <span className="text-slate-400 ml-1 font-bold text-lg leading-none">%</span>
          )}
        </div>
      </div>
    </div>
  );
}

function SegmentedTermSelector({ 
  value, 
  onChange, 
  options 
}: { 
  value: number; 
  onChange: (val: number) => void; 
  options: number[];
}) {
  return (
    <div className="relative bg-slate-50 p-1.5 rounded-2xl flex w-full border border-slate-200 overflow-hidden">
      {options.map((opt) => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          className={cn(
            "relative flex-1 py-3 text-[10px] font-black uppercase tracking-widest z-10 transition-colors duration-300",
            value === opt ? "text-white" : "text-slate-400 hover:text-brand-primary"
          )}
        >
          {opt}m
          {value === opt && (
            <motion.div
              layoutId="segmented-bg"
              className="absolute inset-0 bg-brand-secondary rounded-xl -z-10 shadow-lg shadow-brand-secondary/40"
              transition={{ type: "spring", bounce: 0.15, duration: 0.5 }}
            />
          )}
        </button>
      ))}
    </div>
  );
}

function AnimatedAmount({ value }: { value: number }) {
  const [displayValue, setDisplayValue] = useState(value);
  
  useEffect(() => {
    // Ensure displayValue is a valid number
    const startValue = isNaN(displayValue) ? 0 : displayValue;
    const endValue = isNaN(value) ? 0 : value;

    const controls = animate(startValue, endValue, {
      duration: 0.4,
      ease: "easeOut",
      onUpdate: (latest) => setDisplayValue(latest)
    });
    return () => controls.stop();
  }, [value]);

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency: 'CAD',
      maximumFractionDigits: 0,
    }).format(val);
  };

  return <>{formatCurrency(displayValue)}</>;
}

export default function CarLoanCalculator({ car, initialPrice = 24995 }: { car?: Car, initialPrice?: number }) {
  const [price, setPrice] = useState<number | string>(initialPrice);
  const [downPayment, setDownPayment] = useState<number | string>(0);
  const [tradeInValue, setTradeInValue] = useState<number | string>(0);
  const [interestRate, setInterestRate] = useState<number | string>(6.99);
  const [termMonths, setTermMonths] = useState<number>(84);
  
  const [biWeeklyPayment, setBiWeeklyPayment] = useState<number>(0);

  useEffect(() => {
    if (initialPrice) setPrice(initialPrice);
  }, [initialPrice]);

  useEffect(() => {
    const p = Number(price) || 0;
    const d = Number(downPayment) || 0;
    const t = Number(tradeInValue) || 0;
    const i = Number(interestRate) || 0;
    const term = termMonths;

    setBiWeeklyPayment(calculateBiWeeklyPayment(p, i, term, d, t));
  }, [price, downPayment, tradeInValue, interestRate, termMonths]);

  const getFinancingLink = () => {
    const params = new URLSearchParams({
      price: price.toString(),
      downPayment: downPayment.toString(),
      tradeIn: tradeInValue.toString(),
      rate: interestRate.toString(),
      term: termMonths.toString(),
    });
    if (car) {
      params.append('vehicleId', car.id);
      params.append('make', car.make);
      params.append('model', car.model);
      params.append('year', car.year.toString());
    }
    return `/financing?${params.toString()}`;
  };

  // Progress bar calculation
  const progress = Math.min((biWeeklyPayment / 800) * 100, 100);

  return (
    <div className="w-full max-w-6xl mx-auto py-16 px-4 sm:px-6 lg:px-8">
      <div className="flex flex-col lg:flex-row gap-12 items-start">
        {/* Left Column: Inputs */}
        <div className="flex-1 space-y-8 w-full">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-brand-secondary/10 rounded-full mb-4">
              <div className="h-1.5 w-1.5 rounded-full bg-brand-secondary" />
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-brand-secondary">Configure Your Plan</span>
            </div>
            <h2 className="text-4xl font-display font-black text-brand-primary tracking-tighter mb-4">Tailor Your Financing</h2>
            <p className="text-slate-500 font-medium text-lg leading-relaxed max-w-xl">Adjust the parameters below to see your estimated bi-weekly payment in real-time.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <FloatingLabelInput 
              label="Vehicle Price"
              value={price}
              onChange={(v) => setPrice(v === '' ? '' : Number(v))}
            />
            <FloatingLabelInput 
              label="Down Payment"
              value={downPayment}
              onChange={(v) => setDownPayment(v === '' ? '' : Number(v))}
            />
            <FloatingLabelInput 
              label="Trade-In Value"
              value={tradeInValue}
              onChange={(v) => setTradeInValue(v === '' ? '' : Number(v))}
            />
            <FloatingLabelInput 
              label="Interest Rate"
              value={interestRate}
              onChange={(v) => setInterestRate(v === '' ? '' : Number(v))}
            />
          </div>

          <div className="space-y-4">
            <div className="flex justify-between items-end">
              <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Loan Term (Months)</Label>
              <span className="text-xl font-display font-black text-brand-primary">{termMonths}<span className="text-xs text-slate-400 ml-1">mo</span></span>
            </div>
            <SegmentedTermSelector 
              value={termMonths} 
              onChange={setTermMonths} 
              options={[36, 48, 60, 72, 84, 96]} 
            />
          </div>
        </div>

        {/* Right Column: Result Card */}
        <div className="w-full lg:w-[440px] lg:sticky lg:top-24">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-brand-primary rounded-[32px] md:rounded-[40px] p-6 sm:p-8 md:p-12 text-white relative overflow-hidden shadow-[0_32px_64px_-16px_rgba(65,69,107,0.3)] ring-1 ring-white/10"
          >
            {/* Background Glows */}
            <div className="absolute -top-24 -right-24 w-[300px] h-[300px] bg-brand-secondary/30 blur-[100px] rounded-full pointer-events-none" />
            <div className="absolute -bottom-24 -left-24 w-[300px] h-[300px] bg-brand-secondary/20 blur-[100px] rounded-full pointer-events-none" />
            
            <div className="relative z-10 text-center flex flex-col h-full">
              <div className="mb-6 md:mb-10">
                <span className="inline-block px-4 py-1.5 bg-white/10 backdrop-blur-md rounded-full border border-white/10 text-[10px] font-black uppercase tracking-[0.3em] text-brand-secondary mb-6 md:mb-8">
                  Your Payment
                </span>
                
                <div className="relative">
                  <div className="text-6xl md:text-[88px] font-display font-black tracking-tight leading-none bg-gradient-to-br from-white via-white to-brand-secondary bg-clip-text text-transparent filter drop-shadow-xl inline-flex items-baseline">
                    <AnimatedAmount value={biWeeklyPayment} />
                  </div>
                  {/* Digital Glow */}
                  <div className="absolute inset-0 bg-brand-secondary/20 blur-3xl rounded-full scale-110 -z-10" />
                </div>
                <div className="text-brand-secondary font-black uppercase tracking-[0.3em] text-xs mt-3 md:mt-4">bi-weekly</div>
              </div>

              {/* Dynamic Visualizer */}
              <div className="w-full mb-8 md:mb-12">
                <div className="flex justify-between items-center mb-3">
                  <span className="text-[10px] font-black uppercase tracking-widest text-white/40">Loan Progress</span>
                  <span className="text-[10px] font-black tracking-widest text-brand-secondary">{Math.round(progress)}%</span>
                </div>
                <div className="h-2 w-full bg-white/10 rounded-full overflow-hidden p-0.5 border border-white/5">
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: `${progress}%` }}
                    className="h-full bg-brand-secondary rounded-full shadow-[0_0_15px_rgba(115,128,255,0.6)]"
                    transition={{ type: "spring", bounce: 0, duration: 1.2 }}
                  />
                </div>
              </div>

              <div className="mt-auto space-y-6">
                <Link 
                  to={getFinancingLink()} 
                  className="w-full flex items-center justify-center h-14 md:h-16 text-base md:text-lg font-bold bg-brand-secondary hover:bg-white hover:text-brand-primary text-white rounded-xl shadow-lg shadow-brand-secondary/30 transition-all duration-300 active:scale-[0.98]"
                >
                  Get Pre-Approved
                </Link>
                
                <div className="flex items-center justify-center gap-3">
                  <div className="h-[1px] w-8 bg-white/10" />
                  <div className="flex items-center gap-2 text-white/50">
                    <Lock className="h-3.5 w-3.5 text-brand-secondary" />
                    <span className="text-[10px] font-black uppercase tracking-[0.2em]">Bank-Level Security</span>
                  </div>
                  <div className="h-[1px] w-8 bg-white/10" />
                </div>
              </div>
            </div>
          </motion.div>
          
          <div className="mt-8 flex items-center justify-center gap-8 py-4 px-6 bg-slate-50 rounded-[28px] border border-slate-100">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-brand-secondary" />
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Fixed Rates</span>
            </div>
            <div className="w-px h-3 bg-slate-200" />
            <div className="flex items-center gap-2">
              <RotateCw className="h-4 w-4 text-brand-secondary" />
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Instant Calc</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
