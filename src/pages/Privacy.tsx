import React from 'react';
import { motion } from 'motion/react';

export default function Privacy() {
  return (
    <div className="min-h-screen bg-white py-20 px-4">
      <div className="max-w-4xl mx-auto pt-12">
        <motion.h1 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-4xl md:text-5xl lg:text-7xl font-display font-black text-brand-primary leading-[1.1] mb-12 tracking-tighter"
        >
          Privacy Policy
        </motion.h1>
        
        <div className="space-y-10 text-gray-700 leading-relaxed">
          <p>At Vehicle Approval Centre, we are committed to protecting your privacy and ensuring the security of your personal information in compliance with the Personal Information Protection and Electronic Documents Act (PIPEDA) and applicable Nova Scotia law.</p>
          
          <section>
            <h2 className="text-2xl font-bold text-[#7380FF] mb-4">Information Collection</h2>
            <p>To facilitate our "Get Pre-Approved" process, we collect personal and financial information, including your name, contact details, date of birth, employment information, income details, and residential history. This information is necessary to assess your eligibility for vehicle financing.</p>
          </section>
          
          <section>
            <h2 className="text-2xl font-bold text-[#7380FF] mb-4">How We Use Your Data</h2>
            <p>We use the information collected to personalize your financing rates, coordinate vehicle delivery, and provide you with the best possible service. Your data helps us tailor our offerings to your specific needs.</p>
          </section>
          
          <section>
            <h2 className="text-2xl font-bold text-[#7380FF] mb-4">Sharing Your Information</h2>
            <p>To provide you with competitive credit options, we may share your application information with our trusted financial partners. We only share the information necessary to process your financing request.</p>
          </section>
          
          <section>
            <h2 className="text-2xl font-bold text-[#7380FF] mb-4">Security</h2>
            <p>Your personal information is stored securely and handled with the highest level of professional confidentiality. We implement robust security measures to protect your data from unauthorized access or disclosure.</p>
          </section>
          
          <section>
            <h2 className="text-2xl font-bold text-[#7380FF] mb-4">Cookies</h2>
            <p>We use cookies to keep your browsing experience "Fresh." Cookies help us understand how you interact with our site, allowing us to provide personalized content and improve our services.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
