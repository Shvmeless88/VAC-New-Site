import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import { slugify, cleanAndFormatPhone } from '@/lib/utils';

import { getStoredUtms } from '@/lib/utms';

interface LeadFormProps {
  carId: string;
  carTitle: string;
  onSuccess?: () => void;
}

export function LeadForm({ carId, carTitle, onSuccess }: LeadFormProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phone, setPhone] = useState('');

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPhone(cleanAndFormatPhone(e.target.value));
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    if (phone.length < 14) {
      setError('Phone number must be at least 10 digits');
      setLoading(false);
      return;
    }

    const formData = new FormData(e.currentTarget);
    const name = formData.get('name') as string;
    const leadData = {
      title: name,
      name: name,
      email: formData.get('email') as string,
      phone: formData.get('phone') as string,
      person_id: null,
      organization_id: null,
      vehicleName: carTitle,
      vehicleUrl: carId ? `${window.location.origin}/inventory/${slugify(carTitle)}-${carId}` : undefined,
      value: null,
      expected_close_date: null,
    };

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const response = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          ...getStoredUtms(),
          ...leadData
        }),
      });

      clearTimeout(timeoutId);
      const result = await response.json();
      if (result.success) {
        onSuccess?.();
      } else {
        setError(result.error || 'Failed to create lead');
      }
    } catch (err) {
      setError('An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">Full Name</Label>
        <Input id="name" name="name" required placeholder="John Doe" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" required placeholder="john@example.com" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="phone">Phone</Label>
        <Input 
          id="phone" 
          name="phone" 
          type="tel" 
          required 
          placeholder="(555) 555-5555" 
          value={phone}
          onChange={handlePhoneChange}
        />
      </div>
      {error && <p className="text-red-500 text-sm">{error}</p>}
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Submit Inquiry'}
      </Button>
    </form>
  );
}
