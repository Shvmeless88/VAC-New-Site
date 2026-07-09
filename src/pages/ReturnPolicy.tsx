import React, { useEffect } from 'react';
import { motion } from 'motion/react';
import { ShieldCheck, Info, FileText, Scale } from 'lucide-react';

const ReturnPolicy = () => {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 pt-32 pb-20">
      <div className="max-w-4xl mx-auto px-6">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-[2.5rem] shadow-xl shadow-slate-200/50 border border-slate-100 overflow-hidden"
        >
          {/* Header */}
          <div className="bg-brand-primary p-12 text-white relative overflow-hidden">
            <div className="relative z-10">
              <h1 className="text-4xl md:text-5xl font-black tracking-tight mb-4">Return & Cancellation Policy</h1>
              <p className="text-white/80 text-lg max-w-2xl font-medium leading-relaxed">
                Transparency is at the heart of our commitment to you. This policy outlines your legal rights regarding the purchase and financing of your vehicle.
              </p>
            </div>
            {/* Abstract Background Detail */}
            <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full -mr-20 -mt-20 blur-3xl"></div>
          </div>

          <div className="p-8 md:p-12 space-y-12">
            {/* Main Policy Statement */}
            <section className="space-y-6">
              <div className="flex items-center gap-3 text-brand-primary mb-2">
                <ShieldCheck className="h-6 w-6" />
                <h2 className="text-2xl font-bold tracking-tight">Core Policy</h2>
              </div>
              <div className="bg-red-50 border border-red-100 rounded-2xl p-8">
                <p className="text-slate-900 text-xl font-bold leading-relaxed text-center italic">
                  "Vehicle Approval Centre (VAC) does not offer a return policy on any vehicles. Any exceptions to this policy must be explicitly approved in writing by VAC Ownership."
                </p>
              </div>
            </section>

            {/* Legal Disclosure Section */}
            <section className="space-y-6">
              <div className="flex items-center gap-3 text-brand-primary mb-2">
                <Scale className="h-6 w-6" />
                <h2 className="text-2xl font-bold tracking-tight">Legal Rights & Compliance</h2>
              </div>
              <div className="bg-slate-50 rounded-2xl p-6 border border-slate-100 space-y-4">
                <p className="text-slate-700 leading-relaxed font-medium">
                  Vehicle Approval Centre (VAC) is committed to transparency and compliance with all provincial consumer protection regulations. We are required by law and our financial partnerships to ensure every purchaser is fully informed of their legal rights.
                </p>
                
                <div className="space-y-4 prose prose-slate max-w-none">
                  <h3 className="text-lg font-bold text-slate-800">1. Mandatory Disclosures</h3>
                  <p className="text-slate-600 text-sm">
                    VAC must inform the Purchaser of any legal rights they have regarding cancellation, rescission, or termination as required by applicable provincial law. These rights vary by jurisdiction and the specific method of purchase.
                  </p>

                  <h3 className="text-lg font-bold text-slate-800">2. Confirmation of Rights</h3>
                  <p className="text-slate-600 text-sm">
                    As part of our compliance process with lending institutions, VAC must confirm whether a Purchaser has exercised any of these statutory rights regarding cancellation or rescission. This confirmation is a standard requirement for all vehicle financing agreements.
                  </p>

                  <h3 className="text-lg font-bold text-slate-800">3. Written Notice</h3>
                  <p className="text-slate-600 text-sm">
                    In the event that a statutory right to cancellation exists under law, the Purchaser must provide formal written notice to Vehicle Approval Centre within the strict timeframes specified by provincial legislation.
                  </p>
                </div>
              </div>
            </section>

            {/* Assistance Card */}
            <div className="bg-brand-primary/5 rounded-[2rem] p-8 border border-brand-primary/10 flex flex-col md:flex-row items-center gap-6">
              <div className="bg-brand-primary/10 p-4 rounded-2xl">
                <Info className="h-8 w-8 text-brand-primary" />
              </div>
              <div className="flex-1">
                <h4 className="text-xl font-bold text-brand-primary mb-1">Questions about your specific rights?</h4>
                <p className="text-slate-600 text-sm">
                  Our compliance team is here to help you understand the specific regulations applicable to your province and contract.
                </p>
              </div>
              <button 
                onClick={() => window.location.href = 'mailto:compliance@drivevac.ca'}
                className="bg-brand-primary text-white font-bold py-3 px-8 rounded-xl hover:bg-brand-secondary transition-all shrink-0 shadow-lg shadow-brand-primary/20"
              >
                Contact Compliance
              </button>
            </div>
          </div>

          {/* Footer Disclaimer */}
          <div className="bg-slate-50 border-t border-slate-100 p-6 text-center">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-loose max-w-2xl mx-auto">
              This policy is provided for informational purposes and does not constitute legal advice. Your specific rights are governed by the Consumer Protection Act of your province and the terms of your individual purchase and financing agreements.
            </p>
          </div>
        </motion.div>
      </div>
    </div>
  );
};

export default ReturnPolicy;
