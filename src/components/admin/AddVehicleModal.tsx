import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Loader2, UploadCloud, ScanLine, X, Check } from 'lucide-react';

type Fields = {
  year: string; make: string; model: string; trim: string; vin: string;
  mileage: string; bodyStyle: string; exteriorColor: string;
  engine: string; transmission: string; drivetrain: string;
  price: string; status: string;
};

const BLANK: Fields = {
  year: '', make: '', model: '', trim: '', vin: '', mileage: '',
  bodyStyle: '', exteriorColor: '', engine: '', transmission: '', drivetrain: '',
  price: '', status: 'In Recon',
};

const BODY_TYPES = ['SUV', 'Sedan', 'Truck', 'Hatchback', 'Van', 'Convertible'];

async function authToken(): Promise<string> {
  const { auth } = await import('@/lib/firebase');
  return (await auth.currentUser?.getIdToken()) || '';
}

export default function AddVehicleModal({ onClose }: { onClose: () => void }) {
  const [f, setF] = useState<Fields>(BLANK);
  const [photos, setPhotos] = useState<string[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [extracted, setExtracted] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [creating, setCreating] = useState(false);
  const set = (k: keyof Fields, v: string) => setF((s) => ({ ...s, [k]: v }));

  const readScreenshot = async (file: File | null) => {
    if (!file) return;
    setExtracting(true);
    const toastId = toast.loading('Reading the vehicle details…');
    try {
      const fd = new FormData();
      fd.append('screenshot', file);
      const res = await fetch('/api/inventory/extract-pbs', {
        method: 'POST', headers: { Authorization: `Bearer ${await authToken()}` }, body: fd,
      });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.error || 'Could not read the screenshot.');
      const v = j.vehicle;
      setF((s) => ({
        ...s,
        year: v.year ? String(v.year) : s.year,
        make: v.make || s.make,
        model: v.model || s.model,
        trim: v.trim || s.trim,
        vin: v.vin || s.vin,
        mileage: v.mileage ? String(v.mileage) : s.mileage,
        bodyStyle: v.bodyStyle || s.bodyStyle,
        exteriorColor: v.exteriorColor || s.exteriorColor,
        engine: v.engine || s.engine,
        transmission: v.transmission || s.transmission,
        drivetrain: v.drivetrain || s.drivetrain,
      }));
      setExtracted(true);
      toast.success(`Read: ${[v.year, v.make, v.model, v.trim].filter(Boolean).join(' ') || 'vehicle'} — check the details and set a price.`, { id: toastId });
    } catch (e: any) {
      toast.error(e.message, { id: toastId });
    } finally {
      setExtracting(false);
    }
  };

  const uploadPhotos = async (files: FileList | null) => {
    if (!files || !files.length) return;
    setUploading(true);
    const toastId = toast.loading(`Uploading ${files.length} photo${files.length === 1 ? '' : 's'}…`);
    try {
      const fd = new FormData();
      Array.from(files).forEach((file) => fd.append('photos', file));
      const res = await fetch('/api/inventory/upload-photos', {
        method: 'POST', headers: { Authorization: `Bearer ${await authToken()}` }, body: fd,
      });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.error || 'Upload failed.');
      setPhotos((p) => [...p, ...j.urls]);
      toast.success(`${j.urls.length} photo${j.urls.length === 1 ? '' : 's'} added.`, { id: toastId });
    } catch (e: any) {
      toast.error(e.message, { id: toastId });
    } finally {
      setUploading(false);
    }
  };

  const canCreate = f.year && f.make && f.model && Number(f.price) > 0 && photos.length > 0 && !creating;

  const create = async () => {
    if (!canCreate) return;
    setCreating(true);
    const toastId = toast.loading('Building the listing — generating the showroom photo (about a minute)…');
    try {
      const res = await fetch('/api/inventory/import-auction', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await authToken()}` },
        body: JSON.stringify({
          manual: true,
          year: Number(f.year), make: f.make.trim(), model: f.model.trim(), trim: f.trim.trim(),
          vin: f.vin.trim(), mileage: f.mileage, price: Number(f.price) || 0,
          bodyStyle: f.bodyStyle, exteriorColor: f.exteriorColor, engine: f.engine,
          transmission: f.transmission, drivetrain: f.drivetrain, status: f.status,
          photoUrls: photos,
        }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.error || 'Failed to create the listing.');
      toast.success(`${j.title} is live with ${j.photos} showroom photo${j.photos === 1 ? '' : 's'}.`, { id: toastId, duration: 9000 });
      onClose();
    } catch (e: any) {
      toast.error(`Could not create the listing: ${e.message}`, { id: toastId, duration: 8000 });
    } finally {
      setCreating(false);
    }
  };

  const field = (label: string, k: keyof Fields, opts?: { placeholder?: string; type?: string }) => (
    <div className="space-y-1.5">
      <Label className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">{label}</Label>
      <Input value={f[k]} onChange={(e) => set(k, e.target.value)} type={opts?.type || 'text'}
        placeholder={opts?.placeholder} className="h-11 rounded-xl border-gray-200" />
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div onClick={onClose} className="absolute inset-0 bg-brand-primary/40 backdrop-blur-sm" />
      <div className="relative bg-white w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
        <div className="px-7 py-5 border-b border-gray-100 flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-display font-bold text-brand-primary">Add Vehicle</h2>
            <p className="text-sm text-gray-500">Screenshot the PBS record, drop a photo — we build the listing.</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full"><X className="h-5 w-5" /></Button>
        </div>

        <div className="p-7 space-y-6 overflow-y-auto">
          {/* Step 1 — PBS screenshot */}
          <div className="space-y-2">
            <Label className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">1 · PBS screenshot</Label>
            <label className={`flex items-center justify-center gap-3 w-full rounded-2xl border-2 border-dashed p-5 cursor-pointer transition-colors ${extracting ? 'border-brand-primary/40 bg-brand-accent/5' : extracted ? 'border-emerald-200 bg-emerald-50' : 'border-gray-200 hover:border-brand-primary/50 hover:bg-gray-50'}`}>
              <input type="file" accept="image/*" className="hidden" disabled={extracting}
                onChange={(e) => { readScreenshot(e.target.files?.[0] || null); e.currentTarget.value = ''; }} />
              {extracting ? (
                <><Loader2 className="h-5 w-5 animate-spin text-brand-primary" /><span className="text-sm font-semibold text-gray-500">Reading…</span></>
              ) : extracted ? (
                <><Check className="h-5 w-5 text-emerald-600" /><span className="text-sm font-bold text-emerald-700">Details read — edit below if needed, or drop another screenshot</span></>
              ) : (
                <><ScanLine className="h-5 w-5 text-brand-primary" /><span className="text-sm font-bold text-gray-600">Drop the PBS vehicle screenshot to auto-fill</span></>
              )}
            </label>
          </div>

          {/* Step 2 — details */}
          <div className="space-y-3">
            <Label className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">2 · Details</Label>
            <div className="grid grid-cols-2 gap-3">
              {field('Year', 'year', { type: 'number' })}
              {field('Make', 'make')}
              {field('Model', 'model')}
              {field('Trim', 'trim')}
              {field('VIN', 'vin')}
              {field('Mileage (km)', 'mileage', { type: 'number' })}
              <div className="space-y-1.5">
                <Label className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">Body Type</Label>
                <select value={f.bodyStyle} onChange={(e) => set('bodyStyle', e.target.value)}
                  className="h-11 w-full rounded-xl border border-gray-200 px-3 text-sm bg-white">
                  <option value="">—</option>
                  {BODY_TYPES.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
              {field('Colour', 'exteriorColor')}
              <div className="space-y-1.5">
                <Label className="text-[11px] font-bold text-brand-primary uppercase tracking-widest">Retail Price *</Label>
                <Input value={f.price} onChange={(e) => set('price', e.target.value)} type="number" placeholder="e.g. 42995"
                  className="h-11 rounded-xl border-brand-primary/30 focus-visible:ring-brand-primary/20" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">Status</Label>
                <select value={f.status} onChange={(e) => set('status', e.target.value)}
                  className="h-11 w-full rounded-xl border border-gray-200 px-3 text-sm bg-white">
                  <option value="In Recon">Incoming — Just Arrived</option>
                  <option value="For Sale">For Sale</option>
                  <option value="Pending Sale">Pending Sale</option>
                </select>
              </div>
            </div>
          </div>

          {/* Step 3 — photos */}
          <div className="space-y-2">
            <Label className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">3 · Vehicle photos (for the showroom hero)</Label>
            <label className={`flex flex-col items-center justify-center gap-2 w-full rounded-2xl border-2 border-dashed p-5 cursor-pointer transition-colors ${uploading ? 'border-brand-primary/40 bg-brand-accent/5' : 'border-gray-200 hover:border-brand-primary/50 hover:bg-gray-50'}`}>
              <input type="file" accept="image/*" multiple className="hidden" disabled={uploading}
                onChange={(e) => { uploadPhotos(e.target.files); e.currentTarget.value = ''; }} />
              {uploading ? (
                <><Loader2 className="h-5 w-5 animate-spin text-brand-primary" /><span className="text-xs font-semibold text-gray-500">Uploading…</span></>
              ) : (
                <><UploadCloud className="h-5 w-5 text-brand-primary" /><span className="text-sm font-bold text-gray-600">Click to upload the vehicle photos</span><span className="text-[11px] text-gray-400">The clearest front three-quarter shot becomes the showroom hero</span></>
              )}
            </label>
            {photos.length > 0 && (
              <div className="flex items-center gap-2 text-[11px] font-semibold text-emerald-600">
                <div className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                {photos.length} photo{photos.length === 1 ? '' : 's'} ready
              </div>
            )}
          </div>
        </div>

        <div className="px-7 py-5 border-t border-gray-100 flex gap-3">
          <Button onClick={create} disabled={!canCreate}
            className="flex-1 h-12 rounded-2xl bg-brand-primary hover:bg-brand-secondary text-white font-bold shadow-lg shadow-brand-primary/20 disabled:opacity-50">
            {creating ? <><Loader2 className="h-5 w-5 animate-spin mr-2" />Building listing…</> : 'Create Listing'}
          </Button>
          <Button variant="outline" onClick={onClose} className="h-12 px-6 rounded-2xl border-gray-200 font-bold">Cancel</Button>
        </div>
      </div>
    </div>
  );
}
