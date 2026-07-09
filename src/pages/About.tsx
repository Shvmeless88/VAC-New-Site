import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { motion } from 'motion/react';

const contentSections = [
  {
    title: 'Rigorous Quality Control',
    description: 'Every vehicle we sell undergoes a comprehensive 150-point inspection and detailed history check. We refuse to compromise on safety, ensuring that every car you receive meets the highest standards on the road.',
    bgClass: 'bg-white'
  },
  {
    title: 'Local & Trustworthy',
    description: 'Founded right here in Atlantic Canada, we’re replacing the old dealership games with a digital-first approach. No pressure, no middle-men—just a seamless, transparent experience that honors your time and intelligence.',
    bgClass: 'bg-[#f0f4f8]'
  }
];

export default function About() {
  return (
    <div className="min-h-screen bg-white selection:bg-[#7380FF]/10 text-slate-600 font-sans pb-24">
      {/* Hero Section */}
      <div className="max-w-3xl mx-auto px-6 pt-32 pb-16">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        >
          <h1 className="text-4xl md:text-5xl lg:text-7xl font-display font-black text-brand-primary leading-[1.1] mb-8 tracking-tighter">
            We’re changing how you buy cars.
          </h1>
          
          <div className="space-y-8">
            <p className="text-xl md:text-2xl leading-[1.6] font-medium text-slate-900/80">
              VAC was built to replace the traditional dealership experience with transparency, technology, and trust.
            </p>
            
            <p className="text-[17px] md:text-lg leading-[1.6]">
              We started with a simple observation: buying a car shouldn't be a chore of negotiations and hidden fees. It should be a digital-first, seamless experience that gives you total control.
            </p>
          </div>
        </motion.div>
      </div>

      {/* Stats Bar */}
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.8, delay: 0.2 }}
        className="w-full bg-white border-y border-slate-100 shadow-[0_10px_40px_-15px_rgba(0,0,0,0.05)] py-16 mb-8"
      >
        <div className="max-w-5xl mx-auto px-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-12 md:gap-8 text-center">
            <div className="flex flex-col items-center">
              <span className="text-5xl md:text-6xl font-black text-brand-primary mb-3">150+</span>
              <span className="text-sm font-bold text-slate-500 uppercase tracking-widest">Point Inspection</span>
            </div>
            <div className="flex flex-col items-center">
              <span className="text-5xl md:text-6xl font-black text-brand-primary mb-3">Local</span>
              <span className="text-sm font-bold text-slate-500 uppercase tracking-widest">Atlantic Canada Owned</span>
            </div>
            <div className="flex flex-col items-center">
              <span className="text-5xl md:text-6xl font-black text-brand-primary mb-3">1000s</span>
              <span className="text-sm font-bold text-slate-500 uppercase tracking-widest">Of Happy Drivers</span>
            </div>
          </div>
        </div>
      </motion.div>

      {/* The Trust Grid - ZigZag */}
      <div className="flex flex-col w-full">
        {contentSections.map((section, index) => {
          const isEven = index % 2 === 0;
          return (
            <section key={section.title} className={`${section.bgClass} py-24 md:py-32 w-full`}>
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.8 }}
                className="max-w-5xl mx-auto px-6"
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-12 md:gap-24 items-center">
                  <div className={`space-y-6 ${isEven ? 'md:order-1' : 'md:order-2'}`}>
                    <h3 className="text-3xl md:text-4xl lg:text-5xl font-black tracking-tight text-slate-900 leading-[1.1]">
                      {section.title}
                    </h3>
                  </div>
                  <div className={`space-y-4 ${isEven ? 'md:order-2' : 'md:order-1'}`}>
                    <p className="text-[17px] md:text-[19px] leading-[1.6] text-slate-600 font-medium">
                      {section.description}
                    </p>
                  </div>
                </div>
              </motion.div>
            </section>
          );
        })}
      </div>

      {/* Closing Mission */}
      <div className="max-w-3xl mx-auto px-6 pt-32 pb-16">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
          className="text-center space-y-12"
        >
          <div className="space-y-6 max-w-2xl mx-auto">
            <h2 className="text-3xl md:text-4xl font-black tracking-tight text-slate-900">
              The future of driving is digital.
            </h2>
            <p className="text-lg leading-[1.6] text-slate-500">
              Join thousands of Atlantic Canadians who have discovered a faster, fairer way to get on the road. No pressure. No games. Just cars.
            </p>
          </div>

          <div className="pt-8">
            <Button asChild size="lg" className="bg-[#7380FF] hover:bg-[#5e4acc] text-white font-black rounded-xl px-12 h-16 text-lg transition-all duration-300 shadow-2xl shadow-[#7380FF]/25">
              <Link to="/inventory">Browse the Collection</Link>
            </Button>
          </div>
        </motion.div>

        {/* Fine Print Footer */}
        <div className="pt-24 mt-12 border-t border-slate-100 text-center">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-[0.3em]">
            Established 2017 • Atlantic Canada
          </p>
        </div>
      </div>
    </div>
  );
}
