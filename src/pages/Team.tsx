import React, { ReactNode, useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Phone, Mail, MessageCircle, ArrowRight, Linkedin, Loader2, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import { db, collection, query, orderBy, onSnapshot } from '@/lib/firebase';

interface TeamMember {
  id: string;
  name: string;
  title: string;
  specialty: string;
  photoURL: string;
  email: string;
  phone: string;
  category: string;
  chat?: boolean;
  isFinance?: boolean;
}

const TeamCard: React.FC<{ member: TeamMember }> = ({ member }) => {
  const isSales = member.category === "Sales & Product Specialists";
  const isFinance = member.category === "Finance Department";
  const isManagement = member.category === "General Management";
  const isFounders = member.category === "Our Founders";
  const isLogistics = member.category === "Delivery & Logistics";
  const isConcierge = member.category === "Client Relations";
  
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      className="group relative bg-white rounded-[2rem] shadow-sm hover:shadow-xl transition-all duration-500 overflow-hidden border border-gray-100 flex flex-col h-full"
    >
      {/* Image Container */}
      <div className="aspect-[4/5] bg-white relative overflow-hidden flex justify-center border-b border-slate-100">
        <img
          src={member.photoURL}
          alt={member.name}
          className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110 mx-auto"
          referrerPolicy="no-referrer"
        />
        
        {/* Hover Overlay */}
        <div className="absolute inset-0 bg-brand-primary/80 opacity-0 group-hover:opacity-100 transition-opacity duration-500 flex flex-col justify-center items-center p-8 text-center">
          <p className="text-white font-medium text-lg mb-2">{member.name}</p>
          
          <div className="flex gap-4 mt-6">
            {member.phone && !isLogistics && (
              <a href={`tel:${member.phone}`} className="p-2 bg-white/10 hover:bg-white/20 rounded-full transition-colors">
                <Phone className="h-5 w-5 text-white" />
              </a>
            )}
            {member.email && !isLogistics && (
              <a href={`mailto:${member.email}?subject=Inquiry for ${member.name} @ VAC`} className="p-2 bg-white/10 hover:bg-white/20 rounded-full transition-colors">
                <Mail className="h-5 w-5 text-white" />
              </a>
            )}
            {member.chat && (
              <button className="p-2 bg-brand-accent hover:bg-brand-accent/90 rounded-full transition-colors shadow-lg">
                <MessageCircle className="h-5 w-5 text-white" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-6 flex flex-col flex-grow justify-between text-center">
        <div className="mb-6">
          <div className="flex flex-col items-center mb-2">
            <div className="text-center">
              <h3 className="text-xl font-display font-bold text-brand-primary group-hover:text-brand-secondary transition-colors">
                {member.name}
              </h3>
              <p className="text-sm font-medium text-gray-500 uppercase tracking-wider">{member.title}</p>
            </div>
            {member.chat && (
              <div className="bg-brand-accent/10 p-2 rounded-xl mt-2" title="Chat with Me">
                <MessageCircle className="h-4 w-4 text-brand-accent" />
              </div>
            )}
          </div>
        </div>

        <div className="mt-auto space-y-4">
          {(isSales || isFinance || isFounders || isManagement || isConcierge) && (
            <div className="flex gap-3 justify-center">
              {member.phone && (
                <Button variant="outline" size="icon" className="rounded-xl border-gray-200 h-10 w-10" asChild>
                  <a href={`tel:${member.phone}`}><Phone className="h-4 w-4" /></a>
                </Button>
              )}
              {member.email && (
                <Button 
                  variant="outline" 
                  size="icon" 
                  className={`rounded-xl border-gray-200 h-10 w-10 ${(isFinance || isManagement || isConcierge) ? 'bg-slate-100 border-transparent' : ''}`} 
                  asChild
                >
                  <a href={`mailto:${member.email}?subject=Inquiry for ${member.name} @ VAC`}>
                    <Mail className="h-4 w-4" />
                  </a>
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
};

export default function Team() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, 'team'), orderBy('orderIndex', 'asc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const teamData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as TeamMember[];
      setMembers(teamData);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const categories = {
    leadership: members.filter(m => m.category === "Our Founders"),
    management: members.filter(m => m.category === "General Management"),
    concierge: members.filter(m => m.category === "Client Relations"),
    finance: members.filter(m => m.category === "Finance Department"),
    advisory: members.filter(m => m.category === "Sales & Product Specialists"),
    logistics: members.filter(m => m.category === "Delivery & Logistics")
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-12 w-12 animate-spin text-brand-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white pb-24">
      {/* Hero Section */}
      <section className="relative w-full pt-32 pb-16 flex flex-col items-center justify-center bg-white overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 w-full text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
          >
            <h1 className="text-4xl md:text-5xl lg:text-7xl font-display font-black text-brand-primary leading-[1.1] mb-8 tracking-tighter">
              Real People.<br />Real Approvals<span className="text-[#7380FF]">.</span>
            </h1>
            <p className="text-lg md:text-xl text-slate-500 max-w-2xl mx-auto font-medium leading-relaxed">
              Meet the Atlantic Canadian specialists dedicated to getting you behind the wheel.
            </p>
          </motion.div>
        </div>

        {/* Seamless Transition Gradient */}
        <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-white to-transparent" />
      </section>

      {/* Our Founders */}
      {categories.leadership.length > 0 && (
        <section className="py-16 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16 border-b-2 border-slate-100 pb-8">
            <h2 className="text-3xl md:text-4xl font-display font-bold text-brand-primary tracking-tighter">Our Founders</h2>
          </div>
          <div className="flex justify-center">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 gap-y-12 w-full max-w-4xl">
              {categories.leadership.map((member) => (
                <TeamCard key={member.id} member={member} />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* General Management */}
      {categories.management.length > 0 && (
        <section className="py-32 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16 border-b-2 border-slate-100 pb-8">
            <h2 className="text-3xl md:text-4xl font-display font-bold text-brand-primary tracking-tighter">General Management</h2>
          </div>
          <div className="flex justify-center">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 gap-y-12 w-full max-w-5xl">
              {categories.management.map((member) => (
                <TeamCard key={member.id} member={member} />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Finance Department */}
      {categories.finance.length > 0 && (
        <section className="py-32 bg-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16 relative border-b-2 border-slate-100 pb-8">
              <h2 className="text-3xl md:text-4xl font-display font-bold text-brand-primary tracking-tighter">Finance Department</h2>
              <div className="mt-4 flex justify-center">
                <Badge className="bg-brand-accent text-white border-none px-4 py-1">Priority Support</Badge>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 gap-y-12">
              {categories.finance.map((member) => (
                <TeamCard key={member.id} member={member} />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Sales & Product Specialists */}
      {categories.advisory.length > 0 && (
        <section className="py-32 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16 border-b-2 border-slate-100 pb-8">
            <h2 className="text-3xl md:text-4xl font-display font-bold text-brand-primary tracking-tighter">Sales & Product Specialists</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 gap-y-12">
            {categories.advisory.map((member) => (
              <TeamCard key={member.id} member={member} />
            ))}
          </div>
        </section>
      )}

      {/* Client Relations */}
      {categories.concierge.length > 0 && (
        <section className="py-32 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16 border-b-2 border-slate-100 pb-8">
            <h2 className="text-3xl md:text-4xl font-display font-bold text-brand-primary tracking-tighter">Client Relations</h2>
          </div>
          <div className="flex justify-center">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 gap-y-12 w-full max-w-5xl justify-center">
              {categories.concierge.map((member) => (
                <TeamCard key={member.id} member={member} />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Delivery & Logistics */}
      {categories.logistics.length > 0 && (
        <section className="py-32 bg-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16 border-b-2 border-slate-100 pb-8">
              <h2 className="text-3xl md:text-4xl font-display font-bold text-brand-primary tracking-tighter">Delivery & Logistics</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 gap-y-12">
              {categories.logistics.map((member) => (
                <TeamCard key={member.id} member={member} />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* CTA Section */}
      <section className="mt-12 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-brand-secondary rounded-[3rem] p-12 md:p-20 text-center text-white relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl" />
          <div className="relative z-10">
            <h2 className="text-3xl md:text-5xl font-display font-bold mb-6">Ready to get started?</h2>
            <p className="text-xl text-white/80 mb-10 max-w-2xl mx-auto">
              Our team is standing by to help you find the perfect vehicle and financing solution.
            </p>
            <div className="flex flex-col sm:flex-row justify-center gap-4">
              <Button asChild size="lg" className="bg-[#41456B] hover:bg-[#2d304b] text-white font-bold px-10 rounded-2xl h-16 text-lg shadow-xl shadow-black/10">
                <Link to="/financing">Apply for Financing</Link>
              </Button>
              <Button asChild size="lg" className="bg-transparent border-2 border-white text-white hover:bg-white hover:text-brand-secondary font-bold px-10 rounded-2xl h-16 text-lg transition-all duration-300">
                <Link to="/inventory">Browse Inventory</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function Badge({ children, className }: { children: ReactNode, className?: string }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 ${className}`}>
      {children}
    </span>
  );
}
