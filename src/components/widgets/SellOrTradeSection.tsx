import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Car, MapPin, ArrowRight } from 'lucide-react';
import SellOrTradeModal from './SellOrTradeModal';

export default function SellOrTradeSection() {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <section className="py-24 bg-white border-t border-gray-50">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
        >
          <Card className="rounded-[3rem] shadow-2xl shadow-[#41456B]/5 border border-gray-100 overflow-hidden">
            <CardContent className="p-8 sm:p-16">
              <div className="text-center mb-12">
                <Badge className="bg-brand-accent/10 text-brand-accent px-4 py-1.5 rounded-full font-bold mb-6 text-xs tracking-[0.2em] uppercase border border-brand-accent/20">
                  Instant Offer
                </Badge>
                <h2 className="text-4xl md:text-5xl font-display font-bold text-brand-primary mb-6">
                  Sell or Trade Your Vehicle
                </h2>
                <p className="text-gray-500 text-lg">
                  Get an instant offer in minutes. 100% Online Pickup.
                </p>
              </div>

              <Tabs defaultValue="plate" className="w-full">
                <TabsList className="grid w-full grid-cols-2 mb-10 bg-gray-50 p-1.5 rounded-full border border-gray-100">
                  <TabsTrigger value="plate" className="rounded-full py-3 text-sm font-bold data-[state=active]:bg-white data-[state=active]:text-brand-primary data-[state=active]:shadow-md transition-all">Licence Plate</TabsTrigger>
                  <TabsTrigger value="vin" className="rounded-full py-3 text-sm font-bold data-[state=active]:bg-white data-[state=active]:text-brand-primary data-[state=active]:shadow-md transition-all">VIN</TabsTrigger>
                </TabsList>
                
                <TabsContent value="plate" className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <Input placeholder="Enter Licence Plate" className="h-16 rounded-2xl bg-gray-50 border-transparent focus:bg-white focus:border-[#7380FF] transition-all text-lg px-6" />
                    <Input placeholder="Postal Code" className="h-16 rounded-2xl bg-gray-50 border-transparent focus:bg-white focus:border-[#7380FF] transition-all text-lg px-6" />
                  </div>
                </TabsContent>
                <TabsContent value="vin" className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <Input placeholder="Enter 17-digit VIN" className="h-16 rounded-2xl bg-gray-50 border-transparent focus:bg-white focus:border-[#7380FF] transition-all text-lg px-6" />
                    <Input placeholder="Postal Code" className="h-16 rounded-2xl bg-gray-50 border-transparent focus:bg-white focus:border-[#7380FF] transition-all text-lg px-6" />
                  </div>
                </TabsContent>
              </Tabs>

              <Button 
                size="lg" 
                className="w-full mt-10 h-16 text-xl font-bold rounded-full bg-brand-primary hover:bg-brand-primary/90 text-white shadow-xl shadow-brand-primary/20 transition-all"
                onClick={() => setIsModalOpen(true)}
              >
                Get My Instant Offer <ArrowRight className="ml-2 h-6 w-6" />
              </Button>
            </CardContent>
          </Card>
        </motion.div>
      </div>
      <SellOrTradeModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
    </section>
  );
}
