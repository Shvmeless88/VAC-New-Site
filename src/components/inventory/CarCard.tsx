import { calculateBiWeeklyPayment, cn, getVehicleUrl, maxFinancingTerm } from '@/lib/utils';
import { sirvResize, sirvSrcSet } from '@/lib/imageUrl';
import * as React from 'react';
import { Car } from '@/types';
import { Card } from '@/components/ui/card';
import { ShieldCheck, Info } from 'lucide-react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';

interface CarCardProps {
  car: Car;
  key?: React.Key;
  hideSoldDate?: boolean;
}

export default React.memo(function CarCard({ car, hideSoldDate = false }: CarCardProps) {
  // Bi-weekly payment at 6.99% over the LONGEST TERM this year/km combo actually
  // qualifies for (lender rate sheets); null = not financeable, hide the payment.
  const hasPrice = Number(car.price) > 0;
  const financeTerm = hasPrice ? maxFinancingTerm(Number(car.year), Number(car.mileage)) : null;
  const biWeekly = financeTerm ? calculateBiWeeklyPayment(Number(car.price), 6.99, financeTerm) : 0;

  const formatSoldDate = (soldAt: any) => {
    if (!soldAt) return '';
    try {
      const d = soldAt.toDate ? soldAt.toDate() : new Date(soldAt);
      return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch (e) {
      return '';
    }
  };
  
  const soldDateStr = car.status === 'Sold' && !hideSoldDate ? formatSoldDate(car.soldAt) : '';
  
  const isNewlyAdded = React.useMemo(() => {
    if (!car.createdAt || car.status === 'Sold') return false;
    try {
      const createdDate = car.createdAt.toDate ? car.createdAt.toDate() : new Date(car.createdAt);
      if (isNaN(createdDate.getTime())) return false;
      
      const now = new Date();
      const diffInDays = (now.getTime() - createdDate.getTime()) / (1000 * 3600 * 24);
      return diffInDays <= 4;
    } catch (e) {
      return false;
    }
  }, [car.createdAt, car.status]);
  
  return (
    <motion.div
      whileHover={{ y: -4 }}
      transition={{ duration: 0.2 }}
      className="h-full"
    >
      <Link to={getVehicleUrl(car)} className="block h-full">
        <Card className="overflow-hidden border border-[#E2E8F0] hover:shadow-2xl transition-all duration-300 ease-in-out group h-full flex flex-col rounded-xl bg-white">
          
          {/* Image Section - 16:9 */}
          <div className="relative aspect-video overflow-hidden bg-gray-100 flex justify-center items-center">
            {/* Main Image */}
            {/* Sirv resizes on the fly, so ask for the size we actually render.
                The card is ~308px on a phone — shipping the 1920px original was
                ~6x more pixels across than the screen can show. */}
            <img
              src={sirvResize(car.images?.[0], 800) || 'https://picsum.photos/seed/car/800/600'}
              srcSet={sirvSrcSet(car.images?.[0])}
              sizes="(max-width: 768px) 100vw, 400px"
              alt={`${car.year} ${car.make} ${car.model}`}
              className="object-cover w-full h-full"
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
            />

            {/* Overlay Badges */}
            <div className="absolute top-2 left-2 flex flex-col gap-1.5">
              {isNewlyAdded && (
                <div className="bg-emerald-500 text-white rounded-lg px-2 py-1 shadow-md text-[10px] font-black uppercase tracking-wider flex items-center gap-1 animate-pulse">
                  <div className="h-1.5 w-1.5 rounded-full bg-white" />
                  Newly Added
                </div>
              )}
            </div>

            <div className="absolute bottom-2 left-2 flex gap-1">
              {car.status === 'In Recon' ? (
                <div className="bg-amber-50/95 backdrop-blur-sm rounded-lg px-2 py-1 shadow-sm text-[10px] font-bold text-amber-700 flex items-center">
                  Just Arrived · Reserve Early
                </div>
              ) : (
                <>
                  <div className="bg-white/90 backdrop-blur-sm rounded-lg p-1.5 shadow-sm">
                    <ShieldCheck className="h-3.5 w-3.5 text-brand-accent" />
                  </div>
                  <div className="bg-white/90 backdrop-blur-sm rounded-lg px-2 py-1 shadow-sm text-[10px] font-bold text-brand-primary flex items-center">
                    Certified
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Content Section */}
          <div className="p-4 flex flex-col flex-grow">
            {/* Consolidated Title & Specs */}
            <div className="mb-3">
              <h3 className="font-bold text-brand-primary text-base tracking-tight truncate">
                {car.year} {car.make} {car.model}
              </h3>
              <p className="text-xs text-[#64748B] font-medium truncate mt-0.5">
                {car.trim} • {(car.mileage || 0).toLocaleString()} km
              </p>
            </div>

            {/* Horizontal Price */}
            <div className="flex items-baseline justify-between mb-3 gap-2">
              {car.status === 'Sold' ? (
                <div className="flex flex-col items-center justify-center w-full bg-red-100 text-red-700 py-1.5 rounded-lg">
                  <span className="text-sm font-black tracking-widest uppercase">Sold</span>
                  {soldDateStr && <span className="text-[10px] font-bold opacity-80">{soldDateStr}</span>}
                </div>
              ) : car.status === 'Pending Sale' ? (
                <div className="flex flex-col items-center justify-center w-full bg-amber-100 text-amber-700 py-1.5 rounded-lg">
                  <span className="text-sm font-black tracking-widest uppercase">Pending Sale</span>
                </div>
              ) : (
                <>
                  {financeTerm ? (
                    <div className="flex items-baseline gap-1">
                      <span className="text-xl font-black text-brand-primary tracking-tighter">
                        ${Math.round(biWeekly).toLocaleString()}
                      </span>
                      <span className="text-xs font-bold text-[#64748B]">/bw</span>
                    </div>
                  ) : (
                    <span className="text-xs font-bold text-[#64748B]">Contact us for financing</span>
                  )}
                  <span className="text-sm font-bold text-[#64748B]">
                    {hasPrice ? `$${(car.price || 0).toLocaleString()}` : 'Call for Price'}
                  </span>
                  {/* Market-position badge — only shown for competitive prices.
                      "High Price" is never surfaced publicly (it would tell a
                      shopper the car is overpriced). */}
                  {car.marketPriceRating && car.marketPriceRating !== 'High Price' && (
                    <span className={cn(
                      "inline-flex items-center gap-1 mt-1 w-fit rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                      car.marketPriceRating.includes('Great') || car.marketPriceRating.includes('Good')
                        ? "bg-blue-50 text-blue-700"
                        : "bg-slate-100 text-slate-500"
                    )}>
                      {(car.marketPriceRating.includes('Great') || car.marketPriceRating.includes('Good')) && '↓ '}
                      {typeof car.marketPriceDifference === 'number' && car.marketPriceDifference > 0
                        ? `${car.marketPriceRating} · $${car.marketPriceDifference.toLocaleString()} below market`
                        : car.marketPriceRating}
                    </span>
                  )}
                </>
              )}
            </div>

            {/* Spacer */}
            <div className="flex-grow"></div>

            {/* Footer with Info Icon */}
            {car.status !== 'Sold' && car.status !== 'Pending Sale' && (
              <div className="flex items-center justify-between text-[10px] text-gray-400 mt-2 font-medium">
                <span>Excl. HST & Licensing</span>
                <div className="flex items-center gap-1 cursor-help">
                  <Info className="h-3 w-3" />
                  <span>6.99% O.A.C.</span>
                </div>
              </div>
            )}
          </div>

        </Card>
      </Link>
    </motion.div>
  );
});
