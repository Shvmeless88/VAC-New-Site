import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { X, Loader2, CheckCircle2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { getStoredUtms } from '@/lib/utms';
import { cleanAndFormatPhone } from '@/lib/utils';

interface VehicleScoutModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function VehicleScoutModal({ isOpen, onClose }: VehicleScoutModalProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  useEffect(() => {
    if (location.pathname === '/inventory/success' && isOpen) {
      setIsSuccess(true);
    }
  }, [location.pathname, isOpen]);

  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    desiredVehicle: ''
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    if (formData.phone.length < 14) {
      setError('Phone number must be at least 10 digits');
      setIsSubmitting(false);
      return;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const response = await fetch('/api/scout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          ...getStoredUtms(),
          ...formData
        })
      });

      clearTimeout(timeoutId);
      if (response.ok) {
        setIsSuccess(true);
        // Navigate to success URL
        if (location.pathname === '/inventory') {
          navigate('/inventory/success', { replace: true });
        }
        setTimeout(() => {
          onClose();
          setIsSuccess(false);
          setError(null);
          setFormData({ name: '', email: '', phone: '', desiredVehicle: '' });
          // Navigate back to normal inventory after success message is shown/modal closed
          if (location.pathname === '/inventory/success') {
            navigate('/inventory', { replace: true });
          }
        }, 3000);
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.error('Scout request timed out');
      } else {
        console.error('Error submitting scout request:', error);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
          />
          
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="relative w-full max-w-lg bg-white rounded-[2.5rem] shadow-2xl overflow-hidden"
          >
            <button 
              onClick={onClose}
              className="absolute top-6 right-6 p-2 hover:bg-slate-100 rounded-full transition-colors z-10"
            >
              <X className="h-5 w-5 text-slate-400" />
            </button>

            <div className="p-8 md:p-12">
              {isSuccess ? (
                <div className="text-center py-12">
                  <div className="bg-green-100 h-20 w-20 rounded-full flex items-center justify-center mx-auto mb-6">
                    <CheckCircle2 className="h-10 w-10 text-green-600" />
                  </div>
                  <h2 className="text-2xl font-display font-bold text-brand-primary mb-2">Request Received!</h2>
                  <p className="text-slate-500">Our scouts are already on the hunt. We'll be in touch soon.</p>
                </div>
              ) : (
                <>
                  <div className="mb-8">
                    <h2 className="text-3xl font-display font-bold text-brand-primary tracking-tighter mb-2">Vehicle Scout Request</h2>
                    <p className="text-slate-500">Tell us exactly what you're looking for.</p>
                  </div>

                  <form onSubmit={handleSubmit} className="space-y-6">
                    <div className="space-y-2">
                      <Label htmlFor="name" className="text-xs font-bold uppercase tracking-widest text-slate-400">Full Name</Label>
                      <Input 
                        id="name"
                        required
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        placeholder="John Doe"
                        className="h-12 rounded-xl border-slate-200 focus:border-[#6366f1] focus:ring-[#6366f1]/10"
                      />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <Label htmlFor="email" className="text-xs font-bold uppercase tracking-widest text-slate-400">Email Address</Label>
                        <Input 
                          id="email"
                          type="email"
                          required
                          value={formData.email}
                          onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                          placeholder="john@example.com"
                          className="h-12 rounded-xl border-slate-200 focus:border-[#6366f1] focus:ring-[#6366f1]/10"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="phone" className="text-xs font-bold uppercase tracking-widest text-slate-400">Phone Number</Label>
                        <Input 
                          id="phone"
                          type="tel"
                          required
                          value={formData.phone}
                          onChange={(e) => setFormData({ ...formData, phone: cleanAndFormatPhone(e.target.value) })}
                          placeholder="(902) 000-0000"
                          className="h-12 rounded-xl border-slate-200 focus:border-[#6366f1] focus:ring-[#6366f1]/10"
                        />
                      </div>
                    </div>

                    {error && (
                      <p className="text-xs text-red-500 mt-1 font-semibold">{error}</p>
                    )}

                    <div className="space-y-2">
                      <Label htmlFor="desiredVehicle" className="text-xs font-bold uppercase tracking-widest text-slate-400">Desired Vehicle</Label>
                      <Textarea 
                        id="desiredVehicle"
                        required
                        value={formData.desiredVehicle}
                        onChange={(e) => setFormData({ ...formData, desiredVehicle: e.target.value })}
                        placeholder="Tell us the make, model, year, or features you are looking for..."
                        className="min-h-[120px] rounded-xl border-slate-200 focus:border-[#6366f1] focus:ring-[#6366f1]/10 resize-none"
                      />
                    </div>

                    <Button 
                      type="submit"
                      disabled={isSubmitting}
                      className="w-full bg-[#6366f1] hover:bg-[#4f46e5] text-white font-bold h-14 rounded-xl text-lg shadow-xl shadow-indigo-500/20 transition-all"
                    >
                      {isSubmitting ? (
                        <Loader2 className="h-6 w-6 animate-spin" />
                      ) : (
                        "Find My Dream Car"
                      )}
                    </Button>
                  </form>
                </>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
