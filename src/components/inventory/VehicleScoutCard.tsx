import React, { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Search, ArrowRight, Star, Truck, Package } from 'lucide-react';
import { motion } from 'motion/react';
import VehicleScoutModal from './VehicleScoutModal';

interface VehicleScoutCardProps {
  index: number;
}

export default function VehicleScoutCard({ index }: VehicleScoutCardProps) {
  const [isOpen, setIsOpen] = useState(false);

  const cards = [
    {
      icon: Search,
      headline: "Don't see what you're looking for?",
      body: "Our scouts have access to exclusive off-market inventory.",
      buttonText: "Start Search",
      showButton: true
    },
    {
      icon: Star,
      headline: "4.5/5 Star Rating",
      body: "Over 5,000 Atlantic Canadians have trusted VAC for their next vehicle.",
      buttonText: "",
      showButton: false
    },
    {
      icon: Package,
      headline: "Fresh Arrivals Daily",
      body: "Our inventory turns over fast. We add certified vehicles to our lot every day.",
      buttonText: "",
      showButton: false
    },
    {
      icon: Truck,
      headline: "Doorstep Delivery",
      body: "From Halifax to Moncton, we deliver your vehicle directly to your driveway.",
      buttonText: "",
      showButton: false
    }
  ];

  const cardData = cards[Math.floor(index / 8) % cards.length];
  const Icon = cardData.icon;

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        whileHover={{ y: -4 }}
        transition={{ duration: 0.2 }}
        className="h-full"
      >
        <Card className="h-full flex flex-col rounded-xl bg-white !important border border-gray-100 shadow-md hover:shadow-xl transition-all duration-300 overflow-hidden group">
          
          {/* Icon Container */}
          <div className="pt-8 pb-4 flex items-center justify-center">
            <div className="bg-brand-accent/10 p-4 rounded-full">
              <Icon className="h-8 w-8 text-brand-accent" />
            </div>
          </div>
          
          {/* Content Section */}
          <div className="px-6 pb-6 pt-2 flex flex-col flex-grow items-center justify-center text-center">
            <h3 className="text-lg font-bold text-[#1A1A1A] mb-2 leading-tight tracking-tight">
              {cardData.headline}
            </h3>
            
            <p className="text-[13px] text-gray-600 leading-relaxed mb-6">
              {cardData.body}
            </p>

            <div className="flex-grow"></div>

            {cardData.showButton && (
              <div className="mt-auto w-full">
                <Button 
                  onClick={() => setIsOpen(true)}
                  variant="brand"
                  className="w-full rounded-xl h-11 group/btn"
                >
                  {cardData.buttonText}
                  <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover/btn:translate-x-1" />
                </Button>
              </div>
            )}
          </div>
        </Card>
      </motion.div>

      <VehicleScoutModal isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </>
  );
}
