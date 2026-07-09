import React, { useState, useEffect, useCallback } from 'react';
import { db, collection, addDoc, updateDoc, deleteDoc, doc, query, orderBy, onSnapshot, storage, ref, uploadBytes, getDownloadURL, Timestamp } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Plus, Trash2, Edit2, Camera, Loader2, X, Check, ArrowUp, ArrowDown, Image as ImageIcon } from 'lucide-react';
import { toast } from 'sonner';
import Cropper from 'react-easy-crop';
import { motion, AnimatePresence } from 'motion/react';

interface TeamMember {
  id: string;
  name: string;
  title: string;
  email: string;
  phone: string;
  category: string;
  specialty: string;
  photoURL: string;
  orderIndex: number;
  createdAt?: any;
  updatedAt?: any;
}

const CATEGORIES = [
  "Our Founders",
  "General Management",
  "Client Relations",
  "Finance Department",
  "Sales & Product Specialists",
  "Delivery & Logistics"
];

export default function TeamManager() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<TeamMember | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  
  // Form state
  const [formData, setFormData] = useState({
    name: '',
    title: '',
    email: '',
    phone: '',
    category: CATEGORIES[0],
    specialty: '',
    photoURL: '',
    orderIndex: 0
  });

  // Cropper state
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<any>(null);

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

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.addEventListener('load', () => {
        setImageSrc(reader.result as string);
      });
      reader.readAsDataURL(file);
    }
  };

  const onCropComplete = useCallback((_croppedArea: any, croppedAreaPixels: any) => {
    setCroppedAreaPixels(croppedAreaPixels);
  }, []);

  const createImage = (url: string): Promise<HTMLImageElement> =>
    new Promise((resolve, reject) => {
      const image = new Image();
      image.addEventListener('load', () => resolve(image));
      image.addEventListener('error', (error) => reject(error));
      image.setAttribute('crossOrigin', 'anonymous');
      image.src = url;
    });

  const getCroppedImg = async (imageSrc: string, pixelCrop: any): Promise<Blob> => {
    const image = await createImage(imageSrc);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (!ctx) throw new Error('No 2d context');

    canvas.width = pixelCrop.width;
    canvas.height = pixelCrop.height;

    ctx.drawImage(
      image,
      pixelCrop.x,
      pixelCrop.y,
      pixelCrop.width,
      pixelCrop.height,
      0,
      0,
      pixelCrop.width,
      pixelCrop.height
    );

    return new Promise((resolve) => {
      canvas.toBlob((blob) => {
        if (!blob) throw new Error('Canvas is empty');
        resolve(blob);
      }, 'image/jpeg');
    });
  };

  const handleUpload = async () => {
    if (!imageSrc || !croppedAreaPixels) return;

    setIsUploading(true);
    try {
      const croppedImageBlob = await getCroppedImg(imageSrc, croppedAreaPixels);
      const storageRef = ref(storage, `team-portraits/${Date.now()}.jpg`);
      const uploadResult = await uploadBytes(storageRef, croppedImageBlob);
      const downloadURL = await getDownloadURL(uploadResult.ref);
      
      setFormData(prev => ({ ...prev, photoURL: downloadURL }));
      setImageSrc(null);
      toast.success('Photo cropped and uploaded!');
    } catch (error) {
      console.error('Upload error:', error);
      toast.error('Failed to upload image.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.photoURL) {
      toast.error('Please upload a photo.');
      return;
    }

    try {
      const now = Timestamp.now();
      const data: any = {
        ...formData,
        updatedAt: now
      };

      if (editingMember) {
        // Ensure createdAt is preserved for the rules validation
        if (editingMember.createdAt) {
          data.createdAt = editingMember.createdAt;
        } else {
          // Fallback for legacy data missing createdAt
          data.createdAt = now;
        }
        
        await updateDoc(doc(db, 'team', editingMember.id), data);
        toast.success('Team member updated!');
      } else {
        await addDoc(collection(db, 'team'), {
          ...data,
          createdAt: now,
          orderIndex: members.length // Add to end by default
        });
        toast.success('Team member added!');
      }
      
      closeModal();
    } catch (error) {
      console.error('Submit error:', error);
      toast.error('Failed to save team member.');
    }
  };

  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [memberToDelete, setMemberToDelete] = useState<string | null>(null);

  const handleDelete = async () => {
    if (!memberToDelete) return;
    try {
      await deleteDoc(doc(db, 'team', memberToDelete));
      toast.success('Team member removed.');
      setIsDeleteModalOpen(false);
      setMemberToDelete(null);
    } catch (error) {
      console.error('Delete error:', error);
      toast.error('Failed to remove team member.');
    }
  };

  const confirmDelete = (id: string) => {
    setMemberToDelete(id);
    setIsDeleteModalOpen(true);
  };

  const moveMember = async (index: number, direction: 'up' | 'down') => {
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= members.length) return;

    const memberA = members[index];
    const memberB = members[newIndex];

    try {
      await updateDoc(doc(db, 'team', memberA.id), { orderIndex: memberB.orderIndex });
      await updateDoc(doc(db, 'team', memberB.id), { orderIndex: memberA.orderIndex });
    } catch (error) {
      console.error('Sort error:', error);
      toast.error('Failed to update sort order.');
    }
  };

  const openModal = (member?: TeamMember) => {
    if (member) {
      setEditingMember(member);
      setFormData({
        name: member.name,
        title: member.title,
        email: member.email,
        phone: member.phone,
        category: member.category,
        specialty: member.specialty,
        photoURL: member.photoURL,
        orderIndex: member.orderIndex
      });
    } else {
      setEditingMember(null);
      setFormData({
        name: '',
        title: '',
        email: '',
        phone: '',
        category: CATEGORIES[0],
        specialty: '',
        photoURL: '',
        orderIndex: members.length
      });
    }
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingMember(null);
    setImageSrc(null);
    setFormData({
      name: '',
      title: '',
      email: '',
      phone: '',
      category: CATEGORIES[0],
      specialty: '',
      photoURL: '',
      orderIndex: 0
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-brand-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-display font-bold text-brand-primary">Team Management</h2>
          <p className="text-gray-500 font-medium">Manage the public team page members and their details.</p>
        </div>
        <Button 
          onClick={() => openModal()}
          className="h-12 px-6 bg-brand-primary hover:bg-brand-secondary text-white font-bold rounded-xl shadow-lg shadow-brand-primary/20 flex items-center gap-2"
        >
          <Plus className="h-5 w-5" /> Add Team Member
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {members.map((member, index) => (
          <Card key={member.id} className="border-gray-100 hover:border-brand-primary/20 transition-all rounded-2xl overflow-hidden group">
            <CardContent className="p-4 flex items-center gap-6">
              <div className="h-16 w-16 rounded-xl overflow-hidden bg-gray-100 flex-shrink-0">
                <img 
                  src={member.photoURL} 
                  alt={member.name} 
                  className="h-full w-full object-cover"
                  referrerPolicy="no-referrer"
                />
              </div>
              <div className="flex-grow">
                <h3 className="font-bold text-brand-primary text-lg">{member.name}</h3>
                <p className="text-sm text-gray-500 font-medium">{member.title} • {member.category}</p>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex flex-col gap-1 mr-4">
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-8 w-8 rounded-lg"
                    onClick={() => moveMember(index, 'up')}
                    disabled={index === 0}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-8 w-8 rounded-lg"
                    onClick={() => moveMember(index, 'down')}
                    disabled={index === members.length - 1}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                </div>
                <Button 
                  variant="outline" 
                  size="icon" 
                  className="h-10 w-10 rounded-xl border-gray-200 hover:text-brand-primary"
                  onClick={() => openModal(member)}
                >
                  <Edit2 className="h-4 w-4" />
                </Button>
                <Button 
                  variant="outline" 
                  size="icon" 
                  className="h-10 w-10 rounded-xl border-gray-200 hover:text-red-600 hover:border-red-100"
                  onClick={() => confirmDelete(member.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-[2.5rem] w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl"
            >
              <div className="p-8">
                <div className="flex justify-between items-center mb-8">
                  <h3 className="text-2xl font-display font-bold text-brand-primary">
                    {editingMember ? 'Edit Team Member' : 'Add Team Member'}
                  </h3>
                  <Button variant="ghost" size="icon" onClick={closeModal} className="rounded-full">
                    <X className="h-6 w-6" />
                  </Button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-6">
                  {/* Photo Upload Section */}
                  <div className="space-y-4">
                    <Label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Portrait Photo (4:5 Aspect Ratio)</Label>
                    <div className="flex items-center gap-6">
                      <div className="h-32 w-24 rounded-2xl bg-gray-100 overflow-hidden flex-shrink-0 relative group">
                        {formData.photoURL ? (
                          <img 
                            src={formData.photoURL} 
                            alt="Preview" 
                            className="h-full w-full object-cover"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <div className="h-full w-full flex items-center justify-center text-gray-400">
                            <ImageIcon className="h-8 w-8" />
                          </div>
                        )}
                        <label className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer">
                          <Camera className="h-6 w-6 text-white" />
                          <input type="file" className="hidden" accept="image/*" onChange={handleFileChange} />
                        </label>
                      </div>
                      <div className="flex-grow space-y-2">
                        <p className="text-sm text-gray-500">
                          Upload a professional portrait. You can crop it to the perfect 4:5 ratio after selecting a file.
                        </p>
                        <Button 
                          type="button" 
                          variant="outline" 
                          className="rounded-xl border-gray-200"
                          onClick={() => document.querySelector<HTMLInputElement>('input[type="file"]')?.click()}
                        >
                          Select Photo
                        </Button>
                      </div>
                    </div>
                  </div>

                  {/* Cropper Modal */}
                  {imageSrc && (
                    <div className="fixed inset-0 z-[60] bg-black flex flex-col items-center justify-center p-4">
                      <div className="relative w-full max-w-lg aspect-[4/5] bg-gray-900 rounded-3xl overflow-hidden mb-6">
                        <Cropper
                          image={imageSrc}
                          crop={crop}
                          zoom={zoom}
                          aspect={4 / 5}
                          onCropChange={setCrop}
                          onCropComplete={onCropComplete}
                          onZoomChange={setZoom}
                        />
                      </div>
                      <div className="w-full max-w-lg space-y-6">
                        <div className="space-y-2">
                          <Label className="text-white">Zoom</Label>
                          <input
                            type="range"
                            value={zoom}
                            min={1}
                            max={3}
                            step={0.1}
                            aria-labelledby="Zoom"
                            onChange={(e) => setZoom(Number(e.target.value))}
                            className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-brand-accent"
                          />
                        </div>
                        <div className="flex gap-4">
                          <Button 
                            type="button" 
                            className="flex-grow h-12 bg-brand-accent hover:bg-brand-accent/90 text-white font-bold rounded-xl"
                            onClick={handleUpload}
                            disabled={isUploading}
                          >
                            {isUploading ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Apply Crop & Upload'}
                          </Button>
                          <Button 
                            type="button" 
                            variant="outline" 
                            className="h-12 px-6 border-white/20 text-white hover:bg-white/10 rounded-xl"
                            onClick={() => setImageSrc(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <Label htmlFor="name" className="text-xs font-bold text-gray-400 uppercase tracking-widest">Full Name</Label>
                      <Input 
                        id="name" 
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        className="h-12 rounded-xl border-gray-200"
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="title" className="text-xs font-bold text-gray-400 uppercase tracking-widest">Job Title</Label>
                      <Input 
                        id="title" 
                        value={formData.title}
                        onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                        className="h-12 rounded-xl border-gray-200"
                        required
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <Label htmlFor="email" className="text-xs font-bold text-gray-400 uppercase tracking-widest">Email Address</Label>
                      <Input 
                        id="email" 
                        type="email"
                        value={formData.email}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        className="h-12 rounded-xl border-gray-200"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="phone" className="text-xs font-bold text-gray-400 uppercase tracking-widest">Phone Number</Label>
                      <Input 
                        id="phone" 
                        value={formData.phone}
                        onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                        className="h-12 rounded-xl border-gray-200"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="category" className="text-xs font-bold text-gray-400 uppercase tracking-widest">Department Category</Label>
                    <Select 
                      value={formData.category}
                      onValueChange={(value) => setFormData({ ...formData, category: value })}
                    >
                      <SelectTrigger className="h-12 rounded-xl border-gray-200">
                        <SelectValue placeholder="Select Category" />
                      </SelectTrigger>
                      <SelectContent>
                        {CATEGORIES.map(cat => (
                          <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex gap-4 pt-4">
                    <Button type="submit" className="flex-grow h-14 bg-brand-primary hover:bg-brand-secondary text-white font-bold rounded-2xl shadow-lg shadow-brand-primary/20">
                      {editingMember ? 'Update Team Member' : 'Save Team Member'}
                    </Button>
                    <Button type="button" variant="ghost" onClick={closeModal} className="h-14 px-8 font-bold rounded-2xl">
                      Cancel
                    </Button>
                  </div>
                </form>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isDeleteModalOpen && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-[2rem] w-full max-w-md p-8 shadow-2xl"
            >
              <h3 className="text-2xl font-display font-bold text-brand-primary mb-4">Remove Team Member?</h3>
              <p className="text-gray-500 mb-8">
                Are you sure you want to remove this team member? This action cannot be undone and they will be removed from the public Team page immediately.
              </p>
              <div className="flex gap-4">
                <Button 
                  className="flex-grow h-12 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl"
                  onClick={handleDelete}
                >
                  Yes, Remove Member
                </Button>
                <Button 
                  variant="ghost" 
                  className="h-12 px-6 font-bold rounded-xl"
                  onClick={() => setIsDeleteModalOpen(false)}
                >
                  Cancel
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
