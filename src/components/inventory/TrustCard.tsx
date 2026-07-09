import * as React from 'react';
import { Card } from '@/components/ui/card';
import { ShieldCheck, TrendingUp, Wallet, RotateCw } from 'lucide-react';

interface TrustCardProps {
  type: 'financing' | 'trade-in' | '360-tour';
}

export default React.memo(function TrustCard({ type }: TrustCardProps) {
  const content = {
    'financing': {
      icon: Wallet,
      headline: 'Buying Power Made Easy',
      body: 'We work with all major lenders in Atlantic Canada to ensure you get the most competitive rates and flexible terms for your budget.'
    },
    'trade-in': {
      icon: TrendingUp,
      headline: 'Fair Market Trade-Ins',
      body: 'Get the maximum value for your current vehicle. Our transparent appraisal process ensures you get a fair, market-based offer every time.'
    },
    '360-tour': {
      icon: RotateCw,
      headline: 'The Velo Digital Studio',
      body: 'Our custom car turner and high-definition cameras capture every angle so you can shop with 100% confidence from anywhere.'
    }
  }[type];

  const Icon = content.icon;

  return (
    <div className="h-auto md:h-full">
      <Card className="overflow-hidden border border-white/20 h-full flex flex-row md:flex-col items-center rounded-2xl md:rounded-3xl shadow-xl shadow-brand-accent/20 p-4 md:p-8 relative bg-brand-accent text-white shadow-[inset_0_1px_2px_rgba(255,255,255,0.4)] cursor-default">
        {/* Background Pattern */}
        <div 
          className="absolute inset-0 opacity-10 pointer-events-none mix-blend-overlay"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='100' height='20' viewBox='0 0 100 20' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M21.184 20c.392-5.351 2.662-10.05 6.382-13.634C31.284 2.785 36.21 0 41.5 0c5.29 0 10.216 2.785 13.934 6.366 3.72 3.583 5.99 8.282 6.382 13.634h-2.028c-.39-4.81-2.42-9.04-5.736-12.23C50.74 4.58 46.33 2 41.5 2s-9.24 2.58-12.552 5.77c-3.316 3.19-5.346 7.42-5.736 12.23h-2.028zM0 20c0-5.29 2.785-10.216 6.366-13.934C9.948 2.346 14.648.076 20 0v2c-4.81 0-9.04 2.03-12.23 5.346C4.58 10.66 2 15.07 2 20H0z' fill='%23ffffff' fill-opacity='1' fill-rule='evenodd'/%3E%3C/svg%3E")`,
            maskImage: 'linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,0) 100%)',
            WebkitMaskImage: 'linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,0) 100%)'
          }}
        />
        
        {/* Decorative background elements */}
        <div className="absolute -right-8 -top-8 w-32 h-32 md:w-40 md:h-40 rounded-full blur-3xl opacity-30 bg-white pointer-events-none" />
        
        <div className="flex-grow flex flex-row md:flex-col justify-center items-center text-left md:text-center gap-4 md:gap-0 md:space-y-6 relative z-10 w-full">
          <div className="w-12 h-12 md:w-16 md:h-16 shrink-0 rounded-xl md:rounded-2xl flex items-center justify-center md:mx-auto md:mb-2 shadow-inner bg-white/20 backdrop-blur-sm border border-white/10">
            <Icon className="h-6 w-6 md:h-8 md:w-8 text-white" />
          </div>
          
          <div className="space-y-1 md:space-y-3 flex-grow">
            <h3 className="text-lg md:text-2xl font-display font-bold leading-tight text-white">
              {content.headline}
            </h3>
            <p className="text-xs md:text-sm font-medium leading-relaxed opacity-90 text-white/90">
              {content.body}
            </p>
            
            {/* Trust Badge Mobile */}
            <div className="md:hidden flex items-center justify-start gap-1.5 opacity-80 pt-1">
              <ShieldCheck className="h-3 w-3" />
              <span className="text-xs font-bold uppercase tracking-widest">
                The Velo Standard
              </span>
            </div>
          </div>
        </div>
        
        {/* Trust Badge Desktop */}
        <div className="hidden md:flex mt-8 items-center justify-center gap-2 opacity-80 relative z-10 w-full">
          <ShieldCheck className="h-4 w-4" />
          <span className="text-xs font-bold uppercase tracking-widest">
            The Velo Standard
          </span>
        </div>
      </Card>
    </div>
  );
});
