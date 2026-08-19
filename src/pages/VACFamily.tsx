import React, { useState } from 'react';
import { useDeliveries } from '@/hooks/useDeliveries';
import { motion } from 'motion/react';
import { Camera, MapPin, Car as CarIcon, Loader2, Star, StarHalf, ShieldCheck, Info } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function VACFamily() {
  const { deliveries, loading, error } = useDeliveries();
  const [visibleCount, setVisibleCount] = useState(10);

  const isQuotaError = error?.includes('quota') || error?.includes('resource-exhausted') || error?.includes('limit exceeded');

  return (
    <div className="min-h-screen bg-white">
      {/* Hero Section */}
      <section className="relative py-24 bg-white overflow-hidden">
        <div className="container mx-auto px-4 relative z-10 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <Badge variant="secondary" className="px-6 py-2 rounded-full mb-6 bg-brand-primary/10 text-brand-primary border-none font-bold">
              VAC Family
            </Badge>
            <h1 className="text-4xl md:text-5xl lg:text-7xl font-display font-black text-brand-primary leading-[1.1] mb-8 tracking-tighter">
              Sold Stories
            </h1>
            <p className="text-xl text-gray-500 max-w-2xl mx-auto font-medium leading-relaxed">
              Every delivery is a new chapter in our story. Meet the amazing people who joined the VAC family this month.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Gallery Section */}
      <section className="py-12 container mx-auto px-4">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-32">
            <Loader2 className="h-12 w-12 text-[#7380FF] animate-spin mb-4" />
            <p className="text-gray-500 font-medium">Loading our family gallery...</p>
          </div>
        ) : error ? (
          <div className="text-center py-20 px-6 bg-red-50/50 rounded-[3rem] border border-red-100 max-w-2xl mx-auto">
            <div className="bg-white h-16 w-16 rounded-full flex items-center justify-center mx-auto mb-6 shadow-sm">
              <Info className="h-8 w-8 text-red-500" />
            </div>
            <h2 className="text-2xl font-display font-bold text-brand-primary mb-4">
              {isQuotaError ? "High Traffic Alert" : "Gallery Connectivity Issue"}
            </h2>
            <p className="text-gray-600 mb-8 leading-relaxed">
              {isQuotaError 
                ? "We've had so many visitors today that our daily free gallery limit has been reached! Our systems will reset automatically shortly. Please check back soon to see our happy customers."
                : "We're having a temporary issue connecting to our gallery. Please try refreshing the page."}
            </p>
            <Button onClick={() => window.location.reload()} variant="brand">
              Refresh Gallery
            </Button>
          </div>
        ) : deliveries.length === 0 ? (
          <div className="text-center py-32 bg-white rounded-[3rem] border border-slate-100">
            <Camera className="h-16 w-16 text-gray-300 mx-auto mb-6" />
            <h2 className="text-3xl font-display font-bold text-[#41456B] mb-4">Gallery Coming Soon</h2>
            <p className="text-gray-500 max-w-md mx-auto">We're currently preparing our latest delivery stories. Check back soon to see our happy customers!</p>
          </div>
        ) : (
          <div className="space-y-12">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-12 px-2 md:px-0">
              {deliveries.slice(0, visibleCount).map((delivery, index) => (
                <motion.div
                  key={delivery.id}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.4, ease: "easeInOut", delay: index * 0.1 }}
                  style={{ transform: 'translateZ(0)', backfaceVisibility: 'hidden', willChange: 'transform, opacity' }}
                  className="w-full mx-auto h-full"
                >
                <Card className="overflow-hidden border border-[#E2E8F0] hover:shadow-2xl transition-all duration-300 ease-in-out group h-full flex flex-col rounded-xl bg-white">
                  
                  {/* Image Section - 16:9 */}
                  <div className="relative aspect-video overflow-hidden bg-gray-100 rounded-t-xl">
                    {/* Firebase Storage can't resize on the fly, so these are
                        whatever was uploaded. Lazy-load so we don't pull every
                        photo at once on a phone. */}
                    <img
                      src={delivery.photoUrl}
                      alt={`Congrats, ${delivery.firstName}!`}
                      className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
                      loading="lazy"
                      decoding="async"
                      referrerPolicy="no-referrer"
                    />

                    {/* Overlay Badges */}
                    <div className="absolute top-2 left-2 bg-white/90 backdrop-blur-sm rounded-lg px-2 py-1 shadow-sm text-[10px] font-bold text-brand-primary">
                      RECENT DELIVERY
                    </div>
                    <div className="absolute bottom-2 right-2 bg-white/90 backdrop-blur-sm rounded-lg px-2 py-1 shadow-sm text-[10px] font-bold text-brand-primary">
                      360° VERIFIED
                    </div>
                  </div>
                  
                  {/* Content Section */}
                  <div className="p-4 flex flex-col flex-grow">
                    {/* Header: Title & Date */}
                    <div className="flex items-baseline justify-between mb-2">
                        <h3 className="font-bold text-brand-primary text-base tracking-tight truncate">
                          Congrats, {delivery.firstName}!
                        </h3>
                        <span className="text-xs font-bold text-[#64748B] whitespace-nowrap ml-2">
                            {delivery.createdAt?.toDate().toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                        </span>
                    </div>

                    {/* Meta/Data: Vehicle & Location */}
                    <div className="flex items-baseline justify-between mb-3 gap-2">
                        <p className="text-xs text-[#64748B] font-medium truncate">
                          {delivery.vehicle}
                        </p>
                        <span className="text-xs text-[#64748B] font-medium truncate">
                            {delivery.city}, {delivery.province}
                        </span>
                    </div>

                    {/* Spacer */}
                    <div className="flex-grow"></div>

                    {/* Footer */}
                    <div className="flex items-center justify-between text-[10px] text-gray-400 mt-2 font-medium">
                      <span>Delivery Story</span>
                      <div className="flex items-center gap-1 cursor-help">
                        <Info className="h-3 w-3" />
                        <span>Verified Customer</span>
                      </div>
                    </div>
                  </div>
                </Card>
              </motion.div>
            ))}
            </div>
            
            {visibleCount < deliveries.length && (
              <div className="flex justify-center mt-8">
                <Button 
                  variant="outline" 
                  onClick={() => setVisibleCount(prev => prev + 10)}
                  className="border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-brand-primary rounded-full px-8 py-2 font-semibold transition-all shadow-sm"
                >
                  Load More Stories
                </Button>
              </div>
            )}
          </div>
        )
}
      </section>

      {/* CTA Section */}
      <section className="py-32 bg-white">
        <div className="container mx-auto px-4 text-center">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-brand-primary mb-6">Ready to join the family?</h2>
            <p className="text-lg text-gray-500 mb-10 leading-relaxed max-w-2xl mx-auto">
              Experience the VAC difference. Premium vehicles, transparent pricing, and a delivery experience you'll want to share.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-6">
              <a 
                href="/inventory" 
                className="w-full sm:w-auto px-12 py-5 bg-[#7380FF] text-white font-bold rounded-2xl hover:bg-[#41456B] hover:text-white hover:shadow-lg transition-all duration-300 ease-in-out shadow-xl shadow-[#7380FF]/20"
              >
                Browse Inventory
              </a>
              <a 
                href="/apply-now" 
                className="w-full sm:w-auto px-12 py-5 bg-white text-[#41456B] border-2 border-gray-100 font-bold rounded-2xl hover:bg-gray-50 transition-all"
              >
                Get Approved
              </a>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
