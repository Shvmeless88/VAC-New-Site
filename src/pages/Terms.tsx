import React from 'react';
import { motion } from 'motion/react';

export default function Terms() {
  return (
    <div className="min-h-screen bg-white py-20 px-4">
      <div className="max-w-4xl mx-auto pt-12">
        <motion.h1 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-4xl md:text-5xl lg:text-7xl font-display font-black text-brand-primary leading-[1.1] mb-12 tracking-tighter"
        >
          Terms of Service
        </motion.h1>
        
        <div className="space-y-10 text-gray-700 leading-relaxed">
          <section>
            <h2 className="text-2xl font-bold text-[#7380FF] mb-4">1. Electronic Communication & Digital Process</h2>
            <p>By using our website and services, you consent to conduct the entire car-buying process digitally. This includes electronic signatures, digital document submission, and electronic communications regarding your application and vehicle purchase.</p>
          </section>
          
          <section>
            <h2 className="text-2xl font-bold text-[#7380FF] mb-4">2. Credit Authorization</h2>
            <p className="font-bold">By clicking "Get Pre-Approved," you expressly authorize Vehicle Approval Centre (VAC) to obtain your credit report and share your personal and financial information with our trusted financial partners to facilitate and process your financing options.</p>
          </section>
          
          <section>
            <h2 className="text-2xl font-bold text-[#7380FF] mb-4">3. Vehicle Descriptions & Accuracy</h2>
            <p>While we strive for 100% accuracy in our vehicle listings, including 360° tours, specifications, and pricing, errors can occur. Vehicle Approval Centre reserves the right to correct any errors, inaccuracies, or omissions at any time without prior notice.</p>
          </section>
          
          <section>
            <h2 className="text-2xl font-bold text-[#7380FF] mb-4">4. Delivery & Title</h2>
            <p>The sale of a vehicle is considered finalized only upon successful delivery and the completion of all required signed documentation. Title to the vehicle remains with Vehicle Approval Centre until all conditions of sale are met and documentation is fully executed.</p>
          </section>
          
          <section>
            <h2 className="text-2xl font-bold text-[#7380FF] mb-4">5. Governing Law</h2>
            <p>These Terms of Service are governed by and construed in accordance with the laws of the Province of Nova Scotia, Canada, without regard to its conflict of law provisions.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
