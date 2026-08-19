import React, { useState, useEffect, useMemo } from 'react';
import { GoogleGenAI } from "@google/genai";
import { useAdmin } from '@/hooks/useAdmin';
import { useInventory } from '@/hooks/useInventory';
import { useAdmins } from '@/hooks/useAdmins';
import { useDeliveries } from '@/hooks/useDeliveries';
import { db, collection, addDoc, updateDoc, deleteDoc, doc, Timestamp, loginWithGoogle, logout, query, where, getDocs, getDoc, setDoc, ref, uploadBytes, getDownloadURL, deleteObject, storage, serverTimestamp, deleteField, OperationType, handleFirestoreError } from '@/lib/firebase';
import LeadsPanel from '@/components/admin/LeadsPanel';
import CrmPanel from '@/components/admin/CrmPanel';
import CrmTeam from '@/components/admin/CrmTeam';
import CrmReports from '@/components/admin/CrmReports';
import CrmNurture from '@/components/admin/CrmNurture';
import Logo from '@/components/layout/Logo';
import { compressImage } from '@/lib/imageCompress';
import { mockInventory } from '@/data/mockInventory';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { 
  Plus, 
  Trash2, 
  Edit2, 
  LogOut, 
  LayoutDashboard,
  Inbox,
  Car as CarIcon,
  Database, 
  AlertCircle, 
  CheckCircle2, 
  Loader2,
  Search,
  ArrowLeft,
  X,
  Settings,
  ShieldCheck,
  Star,
  Users,
  MessageSquare,
  ChevronRight,
  ChevronLeft,
  User,
  Phone,
  TrendingUp,
  Share2,
  Zap,
  Check,
  RotateCw,
  Truck,
  Moon,
  Sun,
  BarChart3,
  Power,
} from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { Car } from '@/types/index';

import TeamManager from '@/components/admin/TeamManager';

type Tab = 'inventory' | 'team-manager' | 'deliveries' | 'settings' | 'leads' | 'crm' | 'inbox' | 'salesteam' | 'reports' | 'pool' | 'nurture';

const toTitleCase = (str: string) => {
  if (!str) return str;
  return str.toLowerCase().split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
};

const FEATURE_CATEGORIES = [
  {
    name: 'Safety & Assistance',
    features: [
      'Adaptive Cruise Control', 'Automatic Emergency Braking (AEB)', 'Blind Spot Monitoring',
      'Lane Keeping Assist', 'Rear Cross-Traffic Alert', '360-Degree Surround Camera',
      'Heads-Up Display (HUD)', 'Driver Attention/Drowsiness Alert'
    ]
  },
  {
    name: 'Seating & Comfort',
    features: [
      'Heated Front Seats', 'Heated Rear Seats', 'Ventilated/Cooled Front Seats',
      'Massaging Front Seats', 'Power-Adjustable Driver Seat (with Memory)',
      'Heated Steering Wheel', 'Dual-Zone Automatic Climate Control',
      'Leather / Premium Synthetic Upholstery'
    ]
  },
  {
    name: 'Technology & Infotainment',
    features: [
      'Wireless Apple CarPlay', 'Wireless Android Auto', 'Navigation System',
      'Premium Sound System', 'Wireless Smartphone Charging',
      'Built-in Wi-Fi Hotspot', 'AI Voice Assistant Integration'
    ]
  },
  {
    name: 'Exterior & Convenience',
    features: [
      'Panoramic Sunroof', 'LED Matrix Headlights', 'Power / Hands-Free Liftgate',
      'Remote Engine Start', 'Keyless Entry & Push-Button Start', 'Rain-Sensing Wipers',
      'AWD', '4WD', 'Alloy Wheels'
    ]
  },
  {
    name: 'EV & Hybrid Specific',
    features: [
      'DC Fast Charging Capability', 'One-Pedal Driving Mode',
      'V2L (Vehicle-to-Load) Power Outlets', 'Regenerative Braking Adjustment'
    ]
  }
];

export default function Admin() {
  const { user, isAdmin, role, realRole, setSimulatedRole, loading: authLoading } = useAdmin();
  const { inventory, loading: inventoryLoading } = useInventory();
  const { deliveries } = useDeliveries();
  const [editingDelivery, setEditingDelivery] = useState<string | null>(null);
  // Tab lives in the URL (?tab=crm) so a refresh / bookmark / back-button keeps you put.
  const [searchParams, setSearchParams] = useSearchParams();
  const ALL_TABS: Tab[] = ['inventory', 'team-manager', 'deliveries', 'settings', 'leads', 'crm', 'inbox', 'salesteam', 'reports', 'pool', 'nurture'];
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    const t = searchParams.get('tab') as Tab | null;
    if (t && ALL_TABS.includes(t)) return t;
    return role === 'sales_rep' ? 'crm' : 'inventory';
  });
  useEffect(() => {
    if (searchParams.get('tab') !== activeTab) {
      setSearchParams((prev) => { const p = new URLSearchParams(prev); p.set('tab', activeTab); return p; }, { replace: true });
    }
  }, [activeTab]); // eslint-disable-line react-hooks/exhaustive-deps
  // Admin dark mode — scoped to the dashboard: the `dark` class is added to
  // <html> only while Admin is mounted, and removed on unmount so the public
  // site is never affected. Choice persists across sessions.
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try { return (localStorage.getItem('vac-admin-theme') as 'light' | 'dark') || 'light'; } catch { return 'light'; }
  });
  useEffect(() => {
    try { localStorage.setItem('vac-admin-theme', theme); } catch {}
    const root = document.documentElement;
    if (theme === 'dark') root.classList.add('dark'); else root.classList.remove('dark');
    return () => { root.classList.remove('dark'); };
  }, [theme]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem('vac_admin_sidebar_collapsed') === '1'; } catch { return false; }
  });
  const toggleSidebar = () => setSidebarCollapsed((c) => {
    const next = !c;
    try { localStorage.setItem('vac_admin_sidebar_collapsed', next ? '1' : '0'); } catch {}
    return next;
  });

  useEffect(() => {
    // A sales rep gets ONLY the CRM board — every other tab bounces them back.
    const restrictedTabs: Tab[] = ['team-manager', 'inventory', 'settings', 'leads', 'deliveries', 'inbox', 'salesteam', 'nurture'];
    if (role === 'sales_rep' && restrictedTabs.includes(activeTab)) {
      setActiveTab('crm');
    } else if (role !== 'super_admin' && ['team-manager', 'settings'].includes(activeTab)) {
      setActiveTab('inventory');
    }
  }, [role, activeTab]);

  const [isSeeding, setIsSeeding] = useState(false);
  const [isSyncingCatalog, setIsSyncingCatalog] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isAddAdminOpen, setIsAddAdminOpen] = useState(false);
  const [newAdminEmail, setNewAdminEmail] = useState('');
  const [newAdminName, setNewAdminName] = useState('');
  const [newAdminRole, setNewAdminRole] = useState<'general_manager' | 'finance_manager' | 'sales_rep'>('sales_rep');
  const [isAddVehicleOpen, setIsAddVehicleOpen] = useState(false);
  const [isEditVehicleOpen, setIsEditVehicleOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [isGeneratingDescription, setIsGeneratingDescription] = useState(false);
  const [aiStatus, setAiStatus] = useState<'connected' | 'disconnected' | 'checking'>('checking');
  const [newDelivery, setNewDelivery] = useState({
    firstName: '',
    lastInitial: '',
    vehicle: '',
    city: '',
    province: '',
    photo: null as File | null,
    photoUrl: '',
    createdAt: null as any,
  });
  const [isUploadingDelivery, setIsUploadingDelivery] = useState(false);
  
  // PIN gate removed — access is secured by @drivevac.ca Google SSO + enforced 2FA.
  const handleLogout = () => { logout(); };

  // Sirv Integration State
  const [isSirvConfigOpen, setIsSirvConfigOpen] = useState(false);
  const [sirvConfig, setSirvConfig] = useState({
    account: (localStorage.getItem('sirv_account') || '').trim() || (import.meta.env.VITE_SIRV_ACCOUNT || '').trim() || 'vologous',
    clientId: (localStorage.getItem('sirv_client_id') || '').trim() || (import.meta.env.VITE_SIRV_CLIENT_ID || '').trim() || 'IzfcgSMOIErYOKXIvZdIt8PHh2B',
    clientSecret: (localStorage.getItem('sirv_client_secret') || '').trim() || (import.meta.env.VITE_SIRV_CLIENT_SECRET || '').trim() || 'PTCHFIo0SuujGhGElWVQj0jcQG0d9YRaOJ2P0apWjLX+qLl2NBSkAtmjOT+yZKcR4xAsZSBcrP5R7LBwAInBcg=='
  });
  const [isFetchingSirv, setIsFetchingSirv] = useState(false);
  const [isSyncingAll, setIsSyncingAll] = useState(false);
  const [isUnsyncingAll, setIsUnsyncingAll] = useState(false);

  // Automatically restore RAV4 images if missing
  // Added temporarily on mount to fix the user's issue with this specific car
  useEffect(() => {
    const restoreIfMissing = async () => {
      const vin = '2T3B1RFV0MC206032';
      const vehicle = inventory.find(v => v.vin === vin);
      if (vehicle && (!vehicle.images || vehicle.images.length < 5)) {
        const images = [
          'https://vologous.sirv.com/2T3B1RFV0MC206032/2T3B1RFV0MC206032/2T3B1RFV0MC206032/0.jpg?v=' + Date.now(),
          'https://vologous.sirv.com/2T3B1RFV0MC206032/2T3B1RFV0MC206032/2T3B1RFV0MC206032/1.jpeg',
          'https://vologous.sirv.com/2T3B1RFV0MC206032/2T3B1RFV0MC206032/2T3B1RFV0MC206032/1000036789.jpeg',
          'https://vologous.sirv.com/2T3B1RFV0MC206032/2T3B1RFV0MC206032/2T3B1RFV0MC206032/1000036788.jpeg',
          'https://vologous.sirv.com/2T3B1RFV0MC206032/2T3B1RFV0MC206032/2T3B1RFV0MC206032/1000036787.jpeg',
          'https://vologous.sirv.com/2T3B1RFV0MC206032/2T3B1RFV0MC206032/2T3B1RFV0MC206032/1000036784.jpeg',
          'https://vologous.sirv.com/2T3B1RFV0MC206032/2T3B1RFV0MC206032/2T3B1RFV0MC206032/1000036785.jpeg',
          'https://vologous.sirv.com/2T3B1RFV0MC206032/2T3B1RFV0MC206032/2T3B1RFV0MC206032/1000036786.jpeg',
          'https://vologous.sirv.com/2T3B1RFV0MC206032/2T3B1RFV0MC206032/2T3B1RFV0MC206032/1000036783.jpeg'
        ];
        try {
          await updateDoc(doc(db, 'inventory', vehicle.id), { images });
          toast.success("RAV4 Images restored automatically.");
        } catch (error) {
          console.error("Failed to restore images automatically:", error);
        }
      }
    };
    if (inventory.length > 0) {
      restoreIfMissing();
    }
  }, [inventory]);

  const updateVehicleStatus = async (id: string, status: 'For Sale' | 'Pending Sale' | 'Sold') => {
    try {
      const updatePayload: any = {
        status,
        updatedAt: Timestamp.now()
      };
      
      if (status === 'Sold') {
        updatePayload.soldAt = Timestamp.now();
      } else {
        updatePayload.soldAt = deleteField();
      }

      await updateDoc(doc(db, 'inventory', id), updatePayload);
      toast.success(`Status updated to ${status}`);
      triggerSync();
    } catch (error) {
      console.error('Error updating status:', error);
      toast.error('Error updating status.');
    }
  };

  // Bulk Actions State
  const [selectedVehicleIds, setSelectedVehicleIds] = useState<string[]>([]);
  const [isBulkSyncing, setIsBulkSyncing] = useState(false);
  const [isBulkUpdatingPrices, setIsBulkUpdatingPrices] = useState(false);

  useEffect(() => {
    const checkAi = async () => {
      // @ts-ignore
      if (window.aistudio && typeof window.aistudio.hasSelectedApiKey === 'function') {
        // @ts-ignore
        const hasKey = await window.aistudio.hasSelectedApiKey();
        setAiStatus(hasKey ? 'connected' : 'disconnected');
      } else {
        setAiStatus('disconnected');
      }
    };
    checkAi();
  }, []);

  const connectAI = async () => {
    // @ts-ignore
    if (window.aistudio && typeof window.aistudio.openSelectKey === 'function') {
      try {
        // @ts-ignore
        await window.aistudio.openSelectKey();
        // After selecting, we often need a refresh, but let's try to re-check
        window.location.reload();
      } catch (e) {
        setError('Failed to open AI key selector. Please try again or refresh the page.');
      }
    } else {
      setError('AI Studio platform tools not found. Please ensure you are running in the AI Studio preview environment.');
    }
  };
  const [vehicleToDelete, setVehicleToDelete] = useState<string | null>(null);
  const [isDecoding, setIsDecoding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newVehicle, setNewVehicle] = useState<Partial<Car>>({
    make: '',
    model: '',
    trim: '',
    year: new Date().getFullYear(),
    price: 0,
    mileage: 0,
    bodyStyle: 'Sedan',
    transmission: 'Automatic',
    fuelType: 'Gasoline',
    exteriorColor: '',
    interiorColor: '',
    images: [''],
    features: [],
    description: '',
    extrasAndPackages: [],
    isFeatured: false,
    isClearance: false,
    vin: '',
    stockNumber: '',
    seats: 0,
    engine: '',
    engineSize: 0,
    cylinders: 0,
    drivetrain: '',
    doors: 0,
    highwayMpg: 0,
    cityMpg: 0,
    powertrainType: '',
    comfortAndConvenience: [],
    entertainmentAndMedia: [],
    safetyAndSecurity: [],
    searchTags: [],
    biWeekly: 0,
    marketPriceRating: undefined,
    marketPriceDifference: 0,
    sirvUrl: '',
    interior360Photo: '',
    interior360Url: '',
    featureBadges: [],
    packages: [],
    safetySuite: [],
    manufacturerColor: '',
    transmissionDescription: '',
    trimConfidence: 0,
    baseMsrp: 0,
    totalMsrp: 0,
    width: '',
    height: '',
    length: '',
    wheelbase: '',
    curbWeight: '',
    manufacturerCode: '',
    packageCode: '',
    accidents: 0,
    owners: 0,
    status: 'For Sale'
  });
  const [editingVehicle, setEditingVehicle] = useState<Car | null>(null);

  const [isGeneratingPrice, setIsGeneratingPrice] = useState(false);

  const [newStory, setNewStory] = useState({
    customerName: '',
    location: '',
    vehicleInfo: '',
    image: null as File | null,
    imagePreview: '',
  });
  const [isUploadingStory, setIsUploadingStory] = useState(false);

  const getMarketPrice = async (isEdit: boolean = false) => {
    const vehicle = isEdit ? editingVehicle : newVehicle;
    if (!vehicle || !vehicle.year || !vehicle.make || !vehicle.model) {
      setError('Please enter Year, Make, and Model to get a market price.');
      return;
    }

    setIsGeneratingPrice(true);
    setError('Searching market data...');
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) throw new Error("GEMINI_API_KEY is not available");

      const ai = new GoogleGenAI({ apiKey });
      const prompt = `What is the current average selling price for a ${vehicle.year} ${vehicle.make} ${vehicle.model} ${vehicle.trim || ''} with approximately ${vehicle.mileage} km in Atlantic Canada? 
      Please search autotrader.ca and similar sites for current listings in Nova Scotia, New Brunswick, PEI, and Newfoundland.
      Return ONLY a single number representing the average price in CAD. Do not include currency symbols or text.`;

      const result = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          tools: [{ googleSearch: {} }]
        }
      });

      const priceTextFull = result.text || (result as any).response?.text?.() || "";
      const priceText = priceTextFull.replace(/[^0-9.]/g, '');
      const suggestedPrice = parseFloat(priceText || '0');

      if (suggestedPrice > 0) {
        if (isEdit && editingVehicle) {
          setEditingVehicle({ ...editingVehicle, price: suggestedPrice });
        } else {
          setNewVehicle({ ...newVehicle, price: suggestedPrice });
        }
        setError(null);
      } else {
        throw new Error('Could not determine a clear market price. Please try again or enter manually.');
      }
    } catch (error: any) {
      console.error('Error getting market price:', error);
      setError(`Market Price Error: ${error.message}`);
    } finally {
      setIsGeneratingPrice(false);
    }
  };

  const generateAIDescription = async (isEdit: boolean = false) => {
    const vehicle = isEdit ? editingVehicle : newVehicle;
    if (!vehicle || !vehicle.make || !vehicle.model) {
      setError('Please enter at least Make and Model to generate a description.');
      return;
    }

    setIsGeneratingDescription(true);
    setError('Generating content...');
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) throw new Error("GEMINI_API_KEY is not available");

      const ai = new GoogleGenAI({ apiKey });
      const prompt = `Generate a professional, engaging, and concise vehicle description for a ${vehicle.year} ${vehicle.make} ${vehicle.model} ${vehicle.trim || ''}. 
      Key details:
      - Mileage: ${vehicle.mileage} km
      - Body Style: ${vehicle.bodyStyle}
      - Transmission: ${vehicle.transmission}
      - Fuel Type: ${vehicle.fuelType}
      - Exterior Color: ${vehicle.exteriorColor}
      - Interior Color: ${vehicle.interiorColor}
      
      Focus on reliability, comfort, and key features. Keep it under 100 words.`;

      const result = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      });

      const generatedText = result.text || (result as any).response?.text?.() || "";

      if (generatedText) {
        if (isEdit && editingVehicle) {
          setEditingVehicle({ ...editingVehicle, description: generatedText });
        } else {
          setNewVehicle({ ...newVehicle, description: generatedText });
        }
        setError(null);
      } else {
        throw new Error('AI returned an empty response.');
      }
    } catch (error: any) {
      console.error('Error generating AI description:', error);
      setError(`AI Error: ${error.message}`);
    } finally {
      setIsGeneratingDescription(false);
    }
  };

  const handleEdit = (car: Car) => {
    setEditingVehicle({
      ...car,
      interior360Photo: car.interior360Photo || car.interior360Url || ''
    });
    setIsEditVehicleOpen(true);
  };

  const handleUpdateVehicle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingVehicle) return;
    try {
      const updateData: any = {
        ...editingVehicle,
        price: editingVehicle.price === 0 ? 19995 : editingVehicle.price,
        updatedAt: Timestamp.now()
      };
      
      if (editingVehicle.status === 'Sold') {
        if (!editingVehicle.soldAt) {
          updateData.soldAt = Timestamp.now();
        }
      } else {
        updateData.soldAt = deleteField();
      }
      
      // Remove undefined values to prevent Firestore errors
      Object.keys(updateData).forEach(key => {
        if (updateData[key] === undefined) {
          delete updateData[key];
        }
      });

      await updateDoc(doc(db, 'inventory', editingVehicle.id), updateData);
      setIsEditVehicleOpen(false);
      setEditingVehicle(null);
      triggerSync();
    } catch (error) {
      console.error('Error updating vehicle:', error);
      toast.error('Error updating vehicle. Check console.');
    }
  };

  const saveSirvConfig = () => {
    const trimmedConfig = {
      account: sirvConfig.account.trim(),
      clientId: sirvConfig.clientId.trim(),
      clientSecret: sirvConfig.clientSecret.trim()
    };
    localStorage.setItem('sirv_account', trimmedConfig.account);
    localStorage.setItem('sirv_client_id', trimmedConfig.clientId);
    localStorage.setItem('sirv_client_secret', trimmedConfig.clientSecret);
    setSirvConfig(trimmedConfig);
    setIsSirvConfigOpen(false);
  };

  const handleFetchFromSirv = async (isEdit: boolean = false) => {
    const vehicle = isEdit ? editingVehicle : newVehicle;
    if (!vehicle?.vin) {
      setError('Please enter a VIN first to search Sirv.');
      return;
    }

    if (!sirvConfig.account || !sirvConfig.clientId || !sirvConfig.clientSecret) {
      setIsSirvConfigOpen(true);
      return;
    }

    setIsFetchingSirv(true);
    setError(null);

    try {
      // 1. Get Token
      const tokenRes = await fetch('https://api.sirv.com/v2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: sirvConfig.clientId.trim(),
          clientSecret: sirvConfig.clientSecret.trim()
        })
      });

      if (!tokenRes.ok) {
        const errorData = await tokenRes.json().catch(() => ({}));
        console.error('Sirv Auth Error (Fetch):', errorData);
        throw new Error(`Failed to authenticate with Sirv: ${errorData.message || 'Check credentials.'}`);
      }
      const { token } = await tokenRes.json();

      // 2. Search for files matching VIN
      const searchRes = await fetch('https://api.sirv.com/v2/files/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          query: vehicle.vin,
          size: 100
        })
      });

      if (!searchRes.ok) throw new Error('Failed to search Sirv files.');
      const searchData = await searchRes.json();
      
      const hits = searchData.hits || [];
      if (hits.length === 0) {
        throw new Error('No files found on Sirv matching this VIN.');
      }

      let foundSpin = '';
      const imagesByFolder: Record<string, string[]> = {};

      hits.forEach((hit: any) => {
        // Filter by date: 2025 to present
        const mtime = hit._source.mtime;
        if (mtime) {
          const mtimeDate = new Date(mtime);
          if (mtimeDate.getFullYear() < 2025) return;
        }

        const filename = hit._source.filename;
        const url = `https://${sirvConfig.account.trim()}.sirv.com${filename}`;
        const ext = hit._source.extension?.toLowerCase();

        if (ext === '.spin') {
          foundSpin = url;
        } else if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
          const lastSlash = filename.lastIndexOf('/');
          const folder = lastSlash === -1 ? '' : filename.substring(0, lastSlash);
          
          // Skip backup folders
          if (folder.toLowerCase().includes('backup')) return;

          if (!imagesByFolder[folder]) imagesByFolder[folder] = [];
          if (!imagesByFolder[folder].includes(url)) {
            imagesByFolder[folder].push(url);
          }
        }
      });

      let foundImages: string[] = [];
      let found360Photo = '';
      
      // First, scan for 360.jpg/jpeg in all folders
      for (const [folder, folderImages] of Object.entries(imagesByFolder)) {
        const foundInFolder = folderImages.find(img => {
          const lower = img.toLowerCase();
          return lower.includes('360.jpg') || lower.includes('360.jpeg');
        });
        if (foundInFolder) {
          found360Photo = foundInFolder;
          break;
        }
      }

      // Then, build the image list, skipping spin/360 folders
      for (const [folder, folderImages] of Object.entries(imagesByFolder)) {
        const folderLower = folder.toLowerCase();
        
        // Skip folders that are clearly for spin frames (contain 'spin', 'frame', or '360')
        if (folderLower.includes('spin') || folderLower.includes('frame') || folderLower.includes('360')) continue;
        
        // If a folder has more than 20 images, it's likely a spin frame folder
        if (folderImages.length > 20) continue;
        
          // Filter out the 360.jpg/jpeg if it's in this folder
          const filteredFolderImages = folderImages.filter(img => {
            const lower = img.toLowerCase();
            return !lower.includes('360.jpg') && !lower.includes('360.jpeg');
          });

        foundImages = [...foundImages, ...filteredFolderImages];
      }

      // Deduplicate images and filter for unique filenames (shortest path)
      const uniqueImagesMap: Record<string, string> = {};
      foundImages.forEach(img => {
        const filename = img.split('/').pop() || '';
        if (!uniqueImagesMap[filename] || img.length < uniqueImagesMap[filename].length) {
          uniqueImagesMap[filename] = img;
        }
      });
      foundImages = Object.values(uniqueImagesMap);

      if (!foundSpin && foundImages.length === 0) {
        throw new Error('Found files, but no .spin or image files matched.');
      }

      // Update state
      if (isEdit && editingVehicle) {
        // Sort images to prioritize 0.jpg
        const sortedImages = foundImages.sort((a, b) => {
          const aIsZero = a.endsWith('/0.jpg');
          const bIsZero = b.endsWith('/0.jpg');
          if (aIsZero && !bIsZero) return -1;
          if (!aIsZero && bIsZero) return 1;
          return 0;
        });

        setEditingVehicle({
          ...editingVehicle,
          sirvUrl: foundSpin || editingVehicle.sirvUrl || '',
          images: sortedImages.length > 0 ? sortedImages : (editingVehicle.images || []),
          interior360Photo: found360Photo || editingVehicle.interior360Photo || ''
        });
      } else {
        // Sort images to prioritize 0.jpg
        const sortedImages = foundImages.sort((a, b) => {
          const aIsZero = a.endsWith('/0.jpg');
          const bIsZero = b.endsWith('/0.jpg');
          if (aIsZero && !bIsZero) return -1;
          if (!aIsZero && bIsZero) return 1;
          return 0;
        });

        setNewVehicle({
          ...newVehicle,
          sirvUrl: foundSpin || newVehicle.sirvUrl || '',
          images: sortedImages.length > 0 ? sortedImages : (newVehicle.images || []),
          interior360Photo: found360Photo || newVehicle.interior360Photo || ''
        });
      }

      toast.success(`Successfully found ${foundSpin ? '1 spin' : '0 spins'} and ${foundImages.length} images!`);

    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Error fetching from Sirv');
    } finally {
      setIsFetchingSirv(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedVehicleIds.length === 0) return;
    const toastId = toast.loading(`Deleting ${selectedVehicleIds.length} vehicles...`);

    try {
      for (const id of selectedVehicleIds) {
        await deleteDoc(doc(db, 'inventory', id));
      }
      const count = selectedVehicleIds.length;
      setSelectedVehicleIds([]);
      toast.success(`Successfully deleted ${count} vehicles.`, { id: toastId });
      triggerSync();
    } catch (err) {
      console.error("Error in bulk delete:", err);
      toast.error("Failed to delete some vehicles.", { id: toastId });
    }
  };

  const handleBulkSirvSync = async () => {
    if (selectedVehicleIds.length === 0) return;
    if (!sirvConfig.account || !sirvConfig.clientId || !sirvConfig.clientSecret) {
      setIsSirvConfigOpen(true);
      return;
    }

    setIsBulkSyncing(true);
    let updatedCount = 0;
    try {
      // 1. Get Token
      const tokenRes = await fetch('https://api.sirv.com/v2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: sirvConfig.clientId.trim(),
          clientSecret: sirvConfig.clientSecret.trim()
        })
      });

      if (!tokenRes.ok) {
        const errorData = await tokenRes.json().catch(() => ({}));
        console.error('Sirv Auth Error (Bulk):', errorData);
        throw new Error(`Failed to authenticate with Sirv: ${errorData.message || 'Check credentials.'}`);
      }
      const { token } = await tokenRes.json();

      for (const id of selectedVehicleIds) {
        const car = inventory.find(c => c.id === id);
        if (!car || !car.vin) continue;

        const searchRes = await fetch('https://api.sirv.com/v2/files/search', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            query: car.vin,
            size: 100
          })
        });

        if (!searchRes.ok) continue;
        const searchData = await searchRes.json();
        const hits = searchData.hits || [];
        if (hits.length === 0) continue;

        let foundSpin = '';
        const imagesByFolder: Record<string, string[]> = {};

        hits.forEach((hit: any) => {
          // Filter by date: 2025 to present
          const mtime = hit._source.mtime;
          if (mtime) {
            const mtimeDate = new Date(mtime);
            if (mtimeDate.getFullYear() < 2025) return;
          }

          const filename = hit._source.filename;
          const url = `https://${sirvConfig.account.trim()}.sirv.com${filename}`;
          const ext = hit._source.extension?.toLowerCase();

          if (ext === '.spin') {
            foundSpin = url;
          } else if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
            const lastSlash = filename.lastIndexOf('/');
            const folder = lastSlash === -1 ? '' : filename.substring(0, lastSlash);
            
            // Skip backup folders
            if (folder.toLowerCase().includes('backup')) return;

            if (!imagesByFolder[folder]) imagesByFolder[folder] = [];
            if (!imagesByFolder[folder].includes(url)) {
              imagesByFolder[folder].push(url);
            }
          }
        });

        // Filter folders: keep only those that don't look like spin frames
        let foundImages: string[] = [];
        let found360Photo = '';

        // First, scan for 360.jpg/jpeg in all folders
        for (const [folder, folderImages] of Object.entries(imagesByFolder)) {
          const foundInFolder = folderImages.find(img => {
            const lower = img.toLowerCase();
            return lower.includes('360.jpg') || lower.includes('360.jpeg');
          });
          if (foundInFolder) {
            found360Photo = foundInFolder;
            break;
          }
        }

        for (const [folder, folderImages] of Object.entries(imagesByFolder)) {
          const folderLower = folder.toLowerCase();
          
          // Skip folders that are clearly for spin frames
          if (folderLower.includes('spin') || folderLower.includes('frame') || folderLower.includes('360')) continue;
          
          // If a folder has more than 20 images, it's likely a spin frame folder
          if (folderImages.length > 20) continue;
          
          // Filter out the 360.jpg/jpeg if it's in this folder
          const filteredFolderImages = folderImages.filter(img => {
            const lower = img.toLowerCase();
            return !lower.includes('360.jpg') && !lower.includes('360.jpeg');
          });
          foundImages = Array.from(new Set([...foundImages, ...filteredFolderImages]));
        }

        // Deduplicate images and filter for unique filenames (shortest path)
        const uniqueImagesMap: Record<string, string> = {};
        foundImages.forEach(img => {
          const filename = img.split('/').pop() || '';
          if (!uniqueImagesMap[filename] || img.length < uniqueImagesMap[filename].length) {
            uniqueImagesMap[filename] = img;
          }
        });
        foundImages = Object.values(uniqueImagesMap);

        if (foundSpin || foundImages.length > 0 || found360Photo) {
          await updateDoc(doc(db, 'inventory', id), {
            sirvUrl: foundSpin || car.sirvUrl || '',
            images: foundImages.length > 0 ? foundImages : (car.images || []),
            interior360Photo: found360Photo || car.interior360Photo || '',
            updatedAt: Timestamp.now()
          });
          updatedCount++;
        }
      }
      toast.success(`Bulk sync complete! Updated ${updatedCount} vehicles.`);
      setSelectedVehicleIds([]);
      triggerSync();
    } catch (err) {
      console.error("Error in bulk sync:", err);
      toast.error("Failed to sync some vehicles. Check console.");
    } finally {
      setIsBulkSyncing(false);
    }
  };

  const toggleVehicleSelection = (id: string) => {
    setSelectedVehicleIds(prev => 
      prev.includes(id) ? prev.filter(vId => vId !== id) : [...prev, id]
    );
  };

  useEffect(() => {
    // One-time data migration to fix missing VINs on pre-existing inventory items
    const fixMissingVins = async () => {
      if (!isAdmin || !inventory || inventory.length === 0) return;
      
      const mockVins = [
        '1HGCM8265CA123456', '2T3F1RFV7MW123456', '1FTEW1E50LFC12345', 
        '5YJ3E1EA4MF123456', 'KMHD84LF0PU123456', 'JM3KFBCM3K0123456',
        'JF2GTACZ8RH123456', '2HGFE1F68PH123456', '1G1RC6E44FU123456'
      ];
      
      let updated = false;
      for (let i = 0; i < inventory.length; i++) {
        const car = inventory[i];
        if (!car.vin || car.vin === '') {
          try {
            await updateDoc(doc(db, 'inventory', car.id), {
              vin: mockVins[i % mockVins.length]
            });
            updated = true;
          } catch (e) {
            console.error("Migration error:", e);
          }
        }
      }
      
      if (updated) {
        console.log("Backfilled missing VINs on pre-existing cars.");
      }
    };
    
    fixMissingVins();
  }, [isAdmin, inventory]);

  const toggleSelectAll = () => {
    if (selectedVehicleIds.length === filteredInventory.length) {
      setSelectedVehicleIds([]);
    } else {
      setSelectedVehicleIds(filteredInventory.map(car => car.id));
    }
  };

  const handleUnsyncAllSirv = async () => {
    const toastId = toast.loading('Removing all Sirv media...');
    setIsUnsyncingAll(true);
    let count = 0;
    try {
      for (const car of inventory) {
        if (car.sirvUrl || (car.images && car.images.length > 0)) {
          await updateDoc(doc(db, 'inventory', car.id), {
            sirvUrl: '',
            images: [],
            updatedAt: Timestamp.now()
          });
          count++;
        }
      }
      toast.success(`Successfully unsynced ${count} vehicles.`, { id: toastId });
      triggerSync();
    } catch (err) {
      console.error("Error unsyncing:", err);
      toast.error("Failed to unsync some vehicles.", { id: toastId });
    } finally {
      setIsUnsyncingAll(false);
    }
  };

  const handleBulkUpdatePrices = async () => {
    const zeroPriceCars = inventory.filter(car => car.price === 0);
    if (zeroPriceCars.length === 0) {
      toast.info('No vehicles with price $0 found.');
      return;
    }

    setIsBulkUpdatingPrices(true);
    const toastId = toast.loading(`Updating ${zeroPriceCars.length} prices to $19,995...`);
    
    try {
      let count = 0;
      for (const car of zeroPriceCars) {
        await updateDoc(doc(db, 'inventory', car.id), {
          price: 19995,
          updatedAt: Timestamp.now()
        });
        count++;
      }
      toast.success(`Successfully updated ${count} vehicle prices to $19,995!`, { id: toastId });
      triggerSync();
    } catch (err) {
      console.error("Error bulk updating prices:", err);
      toast.error("Failed to update some vehicle prices.", { id: toastId });
    } finally {
      setIsBulkUpdatingPrices(false);
    }
  };

  const handleSyncAllWithSirv = async () => {
    if (!sirvConfig.account || !sirvConfig.clientId || !sirvConfig.clientSecret) {
      setIsSirvConfigOpen(true);
      return;
    }

    const toastId = toast.loading('Syncing with Sirv...');
    setIsSyncingAll(true);
    let updatedCount = 0;
    let createdCount = 0;

    try {
      // 1. Get Token
      const tokenRes = await fetch('https://api.sirv.com/v2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: sirvConfig.clientId.trim(),
          clientSecret: sirvConfig.clientSecret.trim()
        })
      });

      if (!tokenRes.ok) {
        const errorData = await tokenRes.json().catch(() => ({}));
        console.error('Sirv Auth Error (All):', errorData);
        throw new Error(`Failed to authenticate with Sirv: ${errorData.message || 'Check credentials.'}`);
      }
      const { token } = await tokenRes.json();

      // 2. Search all files in Sirv
      let allHits: any[] = [];
      let from = 0;
      const size = 100;
      let hasMore = true;

      while (hasMore) {
        const searchRes = await fetch('https://api.sirv.com/v2/files/search', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            query: "extension:spin OR extension:jpg OR extension:jpeg OR extension:png OR extension:webp",
            size,
            from
          })
        });

        if (!searchRes.ok) {
          const errText = await searchRes.text();
          throw new Error(`Failed to search Sirv files: ${errText}`);
        }
        
        const searchData = await searchRes.json();
        const currentHits = searchData.hits || [];
        allHits = [...allHits, ...currentHits];
        
        if (currentHits.length < size) {
          hasMore = false;
        } else {
          from += size;
        }
      }
      
      const hits = allHits;
      
      if (hits.length === 0) {
        toast.error('No media files found on Sirv.');
        setIsSyncingAll(false);
        return;
      }

      // 3. Group files by VIN and Folder
      const vinRegex = /[A-HJ-NPR-Z0-9]{17}/i;
      const dataByVin: Record<string, { spin: string, imagesByFolder: Record<string, string[]> }> = {};

      hits.forEach((hit: any) => {
        // Filter by date: 2025 to present
        const mtime = hit._source.mtime;
        if (mtime) {
          const mtimeDate = new Date(mtime);
          if (mtimeDate.getFullYear() < 2025) return;
        }

        const filename = hit._source.filename;
        const match = filename.match(vinRegex);
        if (match) {
          const vin = match[0].toUpperCase();
          if (!dataByVin[vin]) {
            dataByVin[vin] = { spin: '', imagesByFolder: {} };
          }
          
          const url = `https://${sirvConfig.account.trim()}.sirv.com${filename}`;
          const ext = hit._source.extension?.toLowerCase();
          if (ext === '.spin') {
            dataByVin[vin].spin = url;
          } else if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
            const lastSlash = filename.lastIndexOf('/');
            const folder = lastSlash === -1 ? '' : filename.substring(0, lastSlash);
            
            if (folder.toLowerCase().includes('backup')) return;

            if (!dataByVin[vin].imagesByFolder[folder]) {
              dataByVin[vin].imagesByFolder[folder] = [];
            }
            if (!dataByVin[vin].imagesByFolder[folder].includes(url)) {
              dataByVin[vin].imagesByFolder[folder].push(url);
            }
          }
        }
      });

      // 4. Process each found VIN
      for (const [vin, data] of Object.entries(dataByVin)) {
        const existingCar = inventory.find(c => c.vin?.toUpperCase() === vin);

        // Filter images for this VIN: keep only those that don't look like spin frames
        let finalImages: string[] = [];
        let found360Photo = '';

        // First, scan for 360.jpg in all folders for this VIN
        for (const [folder, folderImages] of Object.entries(data.imagesByFolder)) {
          const foundInFolder = folderImages.find(img => {
            const lower = img.toLowerCase();
            return lower.includes('360.jpg') || lower.includes('360.jpeg');
          });
          if (foundInFolder) {
            found360Photo = foundInFolder;
            break;
          }
        }

        for (const [folder, folderImages] of Object.entries(data.imagesByFolder)) {
          const folderLower = folder.toLowerCase();
          
          // Skip folders that are clearly for spin frames
          if (folderLower.includes('spin') || folderLower.includes('frame') || folderLower.includes('360')) continue;
          
          // If a folder has more than 20 images, it's likely a spin frame folder
          if (folderImages.length > 20) continue;
          
          // Filter out the 360.jpg/jpeg if it's in this folder
          const filteredFolderImages = folderImages.filter(img => {
            const lower = img.toLowerCase();
            return !lower.includes('360.jpg') && !lower.includes('360.jpeg');
          });
          finalImages = Array.from(new Set([...finalImages, ...filteredFolderImages]));
        }

        // Deduplicate images and filter for unique filenames (shortest path)
        const uniqueImagesMap: Record<string, string> = {};
        finalImages.forEach(img => {
          const filename = img.split('/').pop() || '';
          if (!uniqueImagesMap[filename] || img.length < uniqueImagesMap[filename].length) {
            uniqueImagesMap[filename] = img;
          }
        });
        finalImages = Object.values(uniqueImagesMap);

        if (existingCar) {
          // Update existing
          const needsUpdate = (data.spin && existingCar.sirvUrl !== data.spin) || 
                              (finalImages.length > 0 && JSON.stringify(existingCar.images) !== JSON.stringify(finalImages)) ||
                              (found360Photo && existingCar.interior360Photo !== found360Photo);
          
          if (needsUpdate) {
            await updateDoc(doc(db, 'inventory', existingCar.id), {
              sirvUrl: data.spin || existingCar.sirvUrl || '',
              images: finalImages.length > 0 ? finalImages : (existingCar.images || []),
              interior360Photo: found360Photo || existingCar.interior360Photo || '',
              updatedAt: Timestamp.now()
            });
            updatedCount++;
          }
        } else {
          // Create new vehicle
          try {
            // Robust duplicate check
            const vinQuery = query(collection(db, 'inventory'), where('vin', '==', vin));
            const vinSnapshot = await getDocs(vinQuery);
            
            if (!vinSnapshot.empty) {

              continue;
            }

            // Decode VIN
            const decodeRes = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${vin}?format=json`);
            const decodeData = await decodeRes.json();
            const result = decodeData.Results?.[0];

            let make = 'Unknown';
            let model = 'Unknown';
            let year = new Date().getFullYear();
            let trim = '';
            let bodyStyle = 'Sedan';
            let transmission = 'Automatic';
            let fuelType = 'Gasoline';

            if (result) {
              make = toTitleCase(result.Make) || make;
              model = result.Model || model;
              year = result.ModelYear ? parseInt(result.ModelYear) : year;
              trim = result.Trim || trim;
              
              if (result.BodyClass) {
                if (result.BodyClass.includes('SUV')) bodyStyle = 'SUV';
                else if (result.BodyClass.includes('Truck')) bodyStyle = 'Truck';
                else if (result.BodyClass.includes('Hatchback')) bodyStyle = 'Hatchback';
                else if (result.BodyClass.includes('Van')) bodyStyle = 'Van';
                else if (result.BodyClass.includes('Convertible')) bodyStyle = 'Convertible';
              }

              if (result.FuelTypePrimary) {
                if (result.FuelTypePrimary.includes('Electric')) fuelType = 'Electric';
                else if (result.FuelTypePrimary.includes('Hybrid')) fuelType = 'Hybrid';
                else if (result.FuelTypePrimary.includes('Diesel')) fuelType = 'Diesel';
              }

              if (result.TransmissionStyle && result.TransmissionStyle.includes('Manual')) {
                transmission = 'Manual';
              }
            }

            await addDoc(collection(db, 'inventory'), {
              vin,
              make,
              model,
              year,
              trim,
              bodyStyle,
              transmission,
              fuelType,
              price: 0,
              mileage: 0,
              exteriorColor: '',
              interiorColor: '',
              engine: '',
              driveTrain: '',
              description: '',
              features: [],
              images: finalImages,
              sirvUrl: data.spin,
              interior360Photo: found360Photo,
              status: 'available',
              isFeatured: false,
              createdAt: Timestamp.now(),
              updatedAt: Timestamp.now()
            });
            createdCount++;
          } catch (err) {
            console.error(`Error creating vehicle for VIN ${vin}:`, err);
          }
        }
      }
      toast.success(`Sync complete! Updated ${updatedCount} and created ${createdCount} vehicles.`, { id: toastId });
      triggerSync();
    } catch (err: any) {
      console.error(err);
      toast.error(`Error syncing with Sirv: ${err.message}`, { id: toastId });
    } finally {
      setIsSyncingAll(false);
    }
  };

  const handleDecodeVin = async () => {
    if (!newVehicle.vin || newVehicle.vin.length < 11) {
      setError('Please enter a valid VIN (at least 11 characters)');
      return;
    }

    setIsDecoding(true);
    setError(null);
    try {
      const response = await fetch(`/api/decode-vin/${newVehicle.vin}?price=${newVehicle.price || ''}&miles=${newVehicle.mileage || ''}`);
      const data = await response.json();

      if (data.source.startsWith('marketcheck') && data.data) {
        const mc = data.data;
        
        // Detailed console log for debugging
        console.log('API RESPONSE RECEIVED:', mc);
        
        // Extract features with fallbacks for both processed and raw responses
        const comfort = Array.isArray(mc.comfortAndConvenience) ? mc.comfortAndConvenience : (Array.isArray(mc.comfort_and_convenience) ? mc.comfort_and_convenience : []);
        const entertainment = Array.isArray(mc.entertainmentAndMedia) ? mc.entertainmentAndMedia : (Array.isArray(mc.entertainment_and_media) ? mc.entertainment_and_media : []);
        const safety = Array.isArray(mc.safetyAndSecurity) ? mc.safetyAndSecurity : (Array.isArray(mc.safety_and_security) ? mc.safety_and_security : []);
        const extras = Array.isArray(mc.extrasAndPackages) ? mc.extrasAndPackages : (Array.isArray(mc.extras_and_packages) ? mc.extras_and_packages : []);

        const comfortStr = comfort.join(', ');

        const updatedVehicle = {
          ...newVehicle, // Keep VIN and other existing fields
          make: mc.make || newVehicle.make || '',
          model: mc.model || newVehicle.model || '',
          trim: mc.trim || newVehicle.trim || '',
          year: mc.year ? parseInt(mc.year.toString()) : newVehicle.year,
          bodyStyle: (mc.body_type?.includes('SUV') || mc.bodyType?.includes('SUV') ? 'SUV' : 
                      mc.body_type?.includes('Truck') || mc.bodyType?.includes('Truck') ? 'Truck' : 
                      mc.body_type?.includes('Sedan') || mc.bodyType?.includes('Sedan') ? 'Sedan' : 
                      mc.body_type?.includes('Hatchback') || mc.bodyType?.includes('Hatchback') ? 'Hatchback' : 
                      mc.body_type?.includes('Van') || mc.bodyType?.includes('Van') ? 'Van' : 
                      mc.body_type?.includes('Convertible') || mc.bodyType?.includes('Convertible') ? 'Convertible' : (mc.bodyType || mc.body_type || newVehicle.bodyStyle)) as Car['bodyStyle'],
          fuelType: (mc.fuel_type?.includes('Electric') || mc.fuelType?.includes('Electric') ? 'Electric' : 
                     mc.fuel_type?.includes('Hybrid') || mc.fuelType?.includes('Hybrid') ? 'Hybrid' : 
                     mc.fuel_type?.includes('Diesel') || mc.fuelType?.includes('Diesel') ? 'Diesel' : 'Gasoline') as Car['fuelType'],
          transmission: (mc.transmission?.includes('Manual') ? 'Manual' : 'Automatic') as Car['transmission'],
          exteriorColor: mc.exteriorColorBase || mc.exterior_color_base || mc.exteriorColor || newVehicle.exteriorColor || '',
          interiorColor: mc.interiorColor || mc.interior_color || newVehicle.interiorColor || '',
          drivetrain: mc.drivetrain || newVehicle.drivetrain || '',
          engine: mc.engine || newVehicle.engine || '',
          engineSize: mc.engine_size || mc.engineSize || newVehicle.engineSize,
          cylinders: mc.cylinders || newVehicle.cylinders,
          doors: mc.doors || newVehicle.doors,
          seats: mc.seating_capacity || mc.seats || mc.seatingCapacity || newVehicle.seats,
          highwayMpg: mc.highway_mpg || mc.highwayMpg || newVehicle.highwayMpg,
          cityMpg: mc.city_mpg || mc.cityMpg || newVehicle.cityMpg,
          powertrainType: mc.powertrain_type || mc.powertrainType || newVehicle.powertrainType || '',
          featureBadges: Array.from(new Set([...(newVehicle.featureBadges || []), ...(mc.featureBadges || [])])),
          packages: mc.packages || newVehicle.packages || [],
          safetySuite: mc.safetySuite || newVehicle.safetySuite || [],
          baseMsrp: mc.base_msrp || mc.baseMsrp || newVehicle.baseMsrp,
          totalMsrp: mc.total_msrp || mc.totalMsrp || newVehicle.totalMsrp,
          manufacturerColor: mc.manufacturerColor || (mc.exterior_color?.name) || (mc.exterior_color) || newVehicle.manufacturerColor || '',
          transmissionDescription: mc.transmission_description || mc.transmissionDescription || newVehicle.transmissionDescription || '',
          trimConfidence: mc.trim_confidence !== undefined ? mc.trim_confidence : (mc.trimConfidence !== undefined ? mc.trimConfidence : newVehicle.trimConfidence),
          comfortAndConvenience: comfort,
          entertainmentAndMedia: entertainment,
          safetyAndSecurity: safety,
          extrasAndPackages: extras,
          width: mc.width || newVehicle.width,
          height: mc.height || newVehicle.height,
          length: mc.length || newVehicle.length,
          wheelbase: mc.wheelbase || newVehicle.wheelbase,
          curbWeight: mc.curb_weight || mc.curbWeight || newVehicle.curbWeight,
          manufacturerCode: mc.manufacturer_code || mc.manufacturerCode || newVehicle.manufacturerCode || '',
          packageCode: mc.package_code || mc.packageCode || newVehicle.packageCode || '',
          marketPriceRating: mc.marketPriceRating || newVehicle.marketPriceRating,
          marketPriceDifference: mc.marketPriceDifference ?? newVehicle.marketPriceDifference,
          marketSampleSize: mc.marketSampleSize ?? newVehicle.marketSampleSize,
          marketMedian: mc.marketMedian ?? newVehicle.marketMedian,
          accidents: mc.accidents !== undefined ? mc.accidents : newVehicle.accidents,
          owners: mc.owners !== undefined ? mc.owners : newVehicle.owners,
          searchTags: Array.from(new Set([
            ...comfort,
            ...entertainment,
            ...safety,
            ...extras
          ]))
        };

        setNewVehicle(updatedVehicle);

        // Brute force DOM override as requested
        setTimeout(() => {
          try {
            const fields = ['comfortAndConvenience', 'entertainmentAndMedia', 'safetyAndSecurity', 'extrasAndPackages'];
            fields.forEach(field => {
              const elements = document.getElementsByName(field);
              if (elements && elements.length > 0) {
                (elements[0] as HTMLTextAreaElement).value = comfortStr;
                console.log(`Successfully manual-set ${field}`);
              }
            });
          } catch (domErr) {
            console.error('DOM override failed:', domErr);
          }
        }, 300);

        alert('Data received for ' + (mc.make || 'Vehicle') + ' ' + (mc.model || ''));
      } else if (data.source === 'nhtsa' && data.data?.Results?.[0]) {
        const result = data.data.Results[0];
        setNewVehicle(prev => ({
          ...prev,
          make: toTitleCase(result.Make) || prev.make,
          model: result.Model || prev.model,
          trim: result.Trim || prev.trim,
          year: result.ModelYear ? parseInt(result.ModelYear) : prev.year,
          bodyStyle: (result.BodyClass?.includes('SUV') ? 'SUV' : 
                      result.BodyClass?.includes('Truck') ? 'Truck' : 
                      result.BodyClass?.includes('Sedan') ? 'Sedan' : 
                      result.BodyClass?.includes('Hatchback') ? 'Hatchback' : 
                      result.BodyClass?.includes('Van') ? 'Van' : 
                      result.BodyClass?.includes('Convertible') ? 'Convertible' : prev.bodyStyle) as Car['bodyStyle'],
          fuelType: (result.FuelTypePrimary?.includes('Electric') ? 'Electric' : 
                     result.FuelTypePrimary?.includes('Hybrid') ? 'Hybrid' : 
                     result.FuelTypePrimary?.includes('Diesel') ? 'Diesel' : 'Gasoline') as Car['fuelType'],
          transmission: (result.TransmissionStyle?.includes('Manual') ? 'Manual' : 'Automatic') as Car['transmission'],
        }));
      } else {
        throw new Error(data.error || 'No result from decode');
      }
    } catch (error) {
      console.error('Error decoding VIN:', error);
      setError('Failed to decode VIN. Please enter details manually.');
    } finally {
      setIsDecoding(false);
    }
  };

  const handleDecodeEditingVin = async () => {
    if (!editingVehicle?.vin || editingVehicle.vin.length < 11) {
      setError('Please enter a valid VIN (at least 11 characters)');
      return;
    }

    setIsDecoding(true);
    setError(null);
    try {
      const response = await fetch(`/api/decode-vin/${editingVehicle.vin}?price=${editingVehicle.price || ''}&miles=${editingVehicle.mileage || ''}`);
      const data = await response.json();

      if (data.source.startsWith('marketcheck') && data.data) {
        const mc = data.data;
        
        // Detailed console log for debugging
        console.log('Editing API RESPONSE RECEIVED:', mc);
        
        // Extract features with fallbacks for both processed and raw responses
        const comfort = Array.isArray(mc.comfortAndConvenience) ? mc.comfortAndConvenience : (Array.isArray(mc.comfort_and_convenience) ? mc.comfort_and_convenience : []);
        const entertainment = Array.isArray(mc.entertainmentAndMedia) ? mc.entertainmentAndMedia : (Array.isArray(mc.entertainment_and_media) ? mc.entertainment_and_media : []);
        const safety = Array.isArray(mc.safetyAndSecurity) ? mc.safetyAndSecurity : (Array.isArray(mc.safety_and_security) ? mc.safety_and_security : []);
        const extras = Array.isArray(mc.extrasAndPackages) ? mc.extrasAndPackages : (Array.isArray(mc.extras_and_packages) ? mc.extras_and_packages : []);

        const comfortStr = comfort.join(', ');

        if (!editingVehicle) return;

        const updatedVehicle = {
          ...editingVehicle,
          make: mc.make || editingVehicle.make || '',
          model: mc.model || editingVehicle.model || '',
          trim: mc.trim || editingVehicle.trim || '',
          year: mc.year ? parseInt(mc.year.toString()) : editingVehicle.year,
          bodyStyle: (mc.body_type?.includes('SUV') || mc.bodyType?.includes('SUV') ? 'SUV' : 
                      mc.body_type?.includes('Truck') || mc.bodyType?.includes('Truck') ? 'Truck' : 
                      mc.body_type?.includes('Sedan') || mc.bodyType?.includes('Sedan') ? 'Sedan' : 
                      mc.body_type?.includes('Hatchback') || mc.bodyType?.includes('Hatchback') ? 'Hatchback' : 
                      mc.body_type?.includes('Van') || mc.bodyType?.includes('Van') ? 'Van' : 
                      mc.body_type?.includes('Convertible') || mc.bodyType?.includes('Convertible') ? 'Convertible' : (mc.bodyType || mc.body_type || editingVehicle.bodyStyle)) as Car['bodyStyle'],
          fuelType: (mc.fuel_type?.includes('Electric') || mc.fuelType?.includes('Electric') ? 'Electric' : 
                     mc.fuel_type?.includes('Hybrid') || mc.fuelType?.includes('Hybrid') ? 'Hybrid' : 
                     mc.fuel_type?.includes('Diesel') || mc.fuelType?.includes('Diesel') ? 'Diesel' : 'Gasoline') as Car['fuelType'],
          transmission: (mc.transmission?.includes('Manual') ? 'Manual' : 'Automatic') as Car['transmission'],
          exteriorColor: mc.exteriorColorBase || mc.exterior_color_base || mc.exteriorColor || editingVehicle.exteriorColor || '',
          interiorColor: mc.interiorColor || mc.interior_color || editingVehicle.interiorColor || '',
          drivetrain: mc.drivetrain || editingVehicle.drivetrain || '',
          engine: mc.engine || editingVehicle.engine || '',
          engineSize: mc.engine_size || mc.engineSize || editingVehicle.engineSize,
          cylinders: mc.cylinders || editingVehicle.cylinders,
          doors: mc.doors || editingVehicle.doors,
          seats: mc.seating_capacity || mc.seats || mc.seatingCapacity || editingVehicle.seats,
          highwayMpg: mc.highway_mpg || mc.highwayMpg || editingVehicle.highwayMpg,
          cityMpg: mc.city_mpg || mc.cityMpg || editingVehicle.cityMpg,
          powertrainType: mc.powertrain_type || mc.powertrainType || editingVehicle.powertrainType || '',
          featureBadges: Array.from(new Set([...(editingVehicle.featureBadges || []), ...(mc.featureBadges || [])])),
          packages: mc.packages || editingVehicle.packages || [],
          safetySuite: mc.safetySuite || editingVehicle.safetySuite || [],
          baseMsrp: mc.base_msrp || mc.baseMsrp || editingVehicle.baseMsrp,
          totalMsrp: mc.total_msrp || mc.totalMsrp || editingVehicle.totalMsrp,
          manufacturerColor: mc.manufacturerColor || (mc.exterior_color?.name) || (mc.exterior_color) || editingVehicle.manufacturerColor || '',
          transmissionDescription: mc.transmission_description || mc.transmissionDescription || editingVehicle.transmissionDescription || '',
          trimConfidence: mc.trim_confidence !== undefined ? mc.trim_confidence : (mc.trimConfidence !== undefined ? mc.trimConfidence : editingVehicle.trimConfidence),
          comfortAndConvenience: comfort,
          entertainmentAndMedia: entertainment,
          safetyAndSecurity: safety,
          extrasAndPackages: extras,
          width: mc.width || editingVehicle.width,
          height: mc.height || editingVehicle.height,
          length: mc.length || editingVehicle.length,
          wheelbase: mc.wheelbase || editingVehicle.wheelbase,
          curbWeight: mc.curb_weight || mc.curbWeight || editingVehicle.curbWeight,
          manufacturerCode: mc.manufacturer_code || mc.manufacturerCode || editingVehicle.manufacturerCode || '',
          packageCode: mc.package_code || mc.packageCode || editingVehicle.packageCode || '',
          marketPriceRating: mc.marketPriceRating || editingVehicle.marketPriceRating,
          marketPriceDifference: mc.marketPriceDifference ?? editingVehicle.marketPriceDifference,
          marketSampleSize: mc.marketSampleSize ?? editingVehicle.marketSampleSize,
          marketMedian: mc.marketMedian ?? editingVehicle.marketMedian,
          accidents: mc.accidents !== undefined ? mc.accidents : editingVehicle.accidents,
          owners: mc.owners !== undefined ? mc.owners : editingVehicle.owners,
          searchTags: Array.from(new Set([
            ...comfort,
            ...entertainment,
            ...safety,
            ...extras
          ]))
        };

        setEditingVehicle(updatedVehicle);

        // Brute force DOM override as requested
        setTimeout(() => {
          try {
            const fields = ['comfortAndConvenience', 'entertainmentAndMedia', 'safetyAndSecurity', 'extrasAndPackages'];
            fields.forEach(field => {
              const elements = document.getElementsByName(field);
              if (elements && elements.length > 0) {
                (elements[0] as HTMLTextAreaElement).value = comfortStr;
                console.log(`Successfully manual-set editing ${field}`);
              }
            });
          } catch (domErr) {
            console.error('DOM override failed:', domErr);
          }
        }, 300);

        alert('Data received for ' + (mc.make || 'Vehicle') + ' ' + (mc.model || ''));
      } else if (data.source === 'nhtsa' && data.data?.Results?.[0]) {
        const result = data.data.Results[0];
        setEditingVehicle(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            make: toTitleCase(result.Make) || prev.make,
            model: result.Model || prev.model,
            trim: result.Trim || prev.trim,
            year: result.ModelYear ? parseInt(result.ModelYear) : prev.year,
            bodyStyle: (result.BodyClass?.includes('SUV') ? 'SUV' : 
                        result.BodyClass?.includes('Truck') ? 'Truck' : 
                        result.BodyClass?.includes('Sedan') ? 'Sedan' : 
                        result.BodyClass?.includes('Hatchback') ? 'Hatchback' : 
                        result.BodyClass?.includes('Van') ? 'Van' : 
                        result.BodyClass?.includes('Convertible') ? 'Convertible' : prev.bodyStyle) as Car['bodyStyle'],
            fuelType: (result.FuelTypePrimary?.includes('Electric') ? 'Electric' : 
                       result.FuelTypePrimary?.includes('Hybrid') ? 'Hybrid' : 
                       result.FuelTypePrimary?.includes('Diesel') ? 'Diesel' : 'Gasoline') as Car['fuelType'],
            transmission: (result.TransmissionStyle?.includes('Manual') ? 'Manual' : 'Automatic') as Car['transmission'],
          };
        });
      } else {
        throw new Error(data.error || 'No result from decode');
      }
    } catch (error) {
      console.error('Error decoding VIN:', error);
      setError('Failed to decode VIN. Please enter details manually.');
    } finally {
      setIsDecoding(false);
    }
  };

  const handleAddVehicle = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    
    if (!newVehicle.vin) {
      setError('VIN is required');
      return;
    }

    try {
      // Check for duplicates
      const vinQuery = query(collection(db, 'inventory'), where('vin', '==', newVehicle.vin.toUpperCase()));
      const vinSnapshot = await getDocs(vinQuery);
      
      if (!vinSnapshot.empty) {
        setError(`A vehicle with VIN ${newVehicle.vin.toUpperCase()} already exists in the inventory.`);
        return;
      }

      const vehicleData: any = {
        ...newVehicle,
        price: newVehicle.price === 0 ? 19995 : newVehicle.price,
        biWeekly: calculateBiWeekly(newVehicle.price === 0 ? 19995 : newVehicle.price),
        vin: newVehicle.vin.toUpperCase(),
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now()
      };
            
      // Remove any undefined fields to prevent Firestore errors
      Object.keys(vehicleData).forEach(key => vehicleData[key] === undefined && delete vehicleData[key]);
      
      if (newVehicle.status === 'Sold') {
        vehicleData.soldAt = Timestamp.now();
      }

      await addDoc(collection(db, 'inventory'), vehicleData);
      setIsAddVehicleOpen(false);
      setNewVehicle({
        make: '',
        model: '',
        trim: '',
        year: new Date().getFullYear(),
        price: 0,
        mileage: 0,
        bodyStyle: 'Sedan',
        transmission: 'Automatic',
        fuelType: 'Gasoline',
        exteriorColor: '',
        interiorColor: '',
        images: [''],
        features: [],
        description: '',
        isFeatured: false,
        isClearance: false,
        vin: ''
      });
      triggerSync();
    } catch (error) {
      console.error('Error adding vehicle:', error);
      setError(`Error adding vehicle: ${error instanceof Error ? error.message : JSON.stringify(error)}`);
    }
  };

  const calculateBiWeekly = (price: number) => {
    const P = price;
    const annualRate = 0.0699;
    const monthlyRate = annualRate / 12;
    const n = 96;
    const monthlyPayment = P * (monthlyRate * Math.pow(1 + monthlyRate, n)) / (Math.pow(1 + monthlyRate, n) - 1);
    return Math.round((monthlyPayment * 12) / 26);
  };

  const triggerSync = async () => {
    try {
      await fetch('/api/sync-catalog', { method: 'POST' });
      console.log('Automated catalog sync triggered');
    } catch (error) {
      console.error('Failed to trigger automated sync:', error);
    }
  };

  const handleManualSync = async () => {
    const toastId = toast.loading('Syncing with Google Sheets...');
    setIsSyncingCatalog(true);
    try {
      const response = await fetch('/api/sync-catalog', { method: 'POST' });
      const data = await response.json();
      if (data.success) {
        toast.success(`Catalog synced! Updated ${data.count} items.`, { id: toastId });
      } else {
        throw new Error(data.error || 'Unknown error');
      }
    } catch (error: any) {
      console.error('Manual sync failed:', error);
      toast.error(`Sync failed: ${error.message}`, { id: toastId });
    } finally {
      setIsSyncingCatalog(false);
    }
  };

  const seedData = async () => {
    const toastId = toast.loading('Seeding inventory...');
    setIsSeeding(true);
    try {
      for (const car of mockInventory) {
        const { id, ...carData } = car;
        
        // Check for duplicates
        if (carData.vin) {
          const vinQuery = query(collection(db, 'inventory'), where('vin', '==', carData.vin.toUpperCase()));
          const vinSnapshot = await getDocs(vinQuery);
          if (!vinSnapshot.empty) {

            continue;
          }
        }

        await addDoc(collection(db, 'inventory'), {
          ...carData,
          vin: carData.vin?.toUpperCase(),
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now()
        });
      }
      toast.success('Inventory seeded successfully!', { id: toastId });
      triggerSync();
    } catch (error) {
      console.error('Error seeding data:', error);
      toast.error('Error seeding data.', { id: toastId });
    } finally {
      setIsSeeding(false);
    }
  };

  const handleRestoreImages = async () => {
    try {
      const vin = '2T3B1RFV0MC206032';
      const vehicle = inventory.find(v => v.vin === vin);
      if (!vehicle) {
        toast.error("Vehicle not found!");
        return;
      }
      const images = [
        'https://vologous.sirv.com/2T3B1RFV0MC206032/2T3B1RFV0MC206032/2T3B1RFV0MC206032/0.jpg?v=' + Date.now(),
        'https://vologous.sirv.com/2T3B1RFV0MC206032/2T3B1RFV0MC206032/2T3B1RFV0MC206032/1.jpeg',
        'https://vologous.sirv.com/2T3B1RFV0MC206032/2T3B1RFV0MC206032/2T3B1RFV0MC206032/1000036789.jpeg',
        'https://vologous.sirv.com/2T3B1RFV0MC206032/2T3B1RFV0MC206032/2T3B1RFV0MC206032/1000036788.jpeg',
        'https://vologous.sirv.com/2T3B1RFV0MC206032/2T3B1RFV0MC206032/2T3B1RFV0MC206032/1000036787.jpeg',
        'https://vologous.sirv.com/2T3B1RFV0MC206032/2T3B1RFV0MC206032/2T3B1RFV0MC206032/1000036784.jpeg',
        'https://vologous.sirv.com/2T3B1RFV0MC206032/2T3B1RFV0MC206032/2T3B1RFV0MC206032/1000036785.jpeg',
        'https://vologous.sirv.com/2T3B1RFV0MC206032/2T3B1RFV0MC206032/2T3B1RFV0MC206032/1000036786.jpeg',
        'https://vologous.sirv.com/2T3B1RFV0MC206032/2T3B1RFV0MC206032/2T3B1RFV0MC206032/1000036783.jpeg'
      ];
      await updateDoc(doc(db, 'inventory', vehicle.id), { images });
      toast.success("Images restored successfully!");
    } catch (error) {
      console.error(error);
      toast.error("Error restoring images.");
    }
  };

  const handleDelete = (id: string) => {
    setVehicleToDelete(id);
    setIsDeleteConfirmOpen(true);
  };

  const confirmDelete = async () => {
    if (!vehicleToDelete) return;
    try {
      await deleteDoc(doc(db, 'inventory', vehicleToDelete));
      setIsDeleteConfirmOpen(false);
      setVehicleToDelete(null);
      triggerSync();
    } catch (error) {
      console.error('Error deleting car:', error);
      setError('Failed to delete vehicle.');
    }
  };

  const filteredInventory = inventory.filter(car => 
    car.make.toLowerCase().includes(searchQuery.toLowerCase()) ||
    car.model.toLowerCase().includes(searchQuery.toLowerCase()) ||
    car.vin?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    car.stockNumber?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    car.year.toString().includes(searchQuery) ||
    car.trim.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (car.searchTags || []).some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="h-12 w-12 text-brand-primary animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <Card className="w-full max-w-md rounded-[2rem] shadow-2xl border-none p-8">
          <CardHeader className="text-center pb-8">
            <div className="bg-brand-bg h-20 w-20 rounded-full flex items-center justify-center mx-auto mb-6">
              <ShieldCheck className="h-10 w-10 text-brand-primary" />
            </div>
            <CardTitle className="text-3xl font-display font-bold text-brand-primary">Admin Access</CardTitle>
            <CardDescription className="text-lg">Please sign in to manage your inventory.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button 
              onClick={loginWithGoogle}
              className="w-full h-14 bg-brand-primary hover:bg-brand-secondary text-white font-bold rounded-xl shadow-xl shadow-brand-primary/20 transition-all flex items-center justify-center gap-3"
            >
              Sign in with Google
            </Button>
            <div className="mt-8 text-center">
              <Link to="/" className="text-gray-400 hover:text-brand-primary font-medium flex items-center justify-center gap-2 transition-colors">
                <ArrowLeft className="h-4 w-4" /> Back to Website
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <Card className="w-full max-w-md rounded-[2rem] shadow-2xl border-none p-8">
          <CardHeader className="text-center pb-8">
            <div className="bg-red-50 h-20 w-20 rounded-full flex items-center justify-center mx-auto mb-6">
              <AlertCircle className="h-10 w-10 text-red-600" />
            </div>
            <CardTitle className="text-3xl font-display font-bold text-brand-primary">Access Denied</CardTitle>
            <CardDescription className="text-lg">You do not have administrative privileges.</CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <p className="text-gray-500 mb-8">Signed in as: <span className="font-bold text-brand-primary">{user.email}</span></p>
            <Button variant="outline" onClick={handleLogout} className="w-full h-12 rounded-xl border-gray-200 font-bold mb-4">
              Sign Out
            </Button>
            <Link to="/" className="text-brand-primary font-bold hover:underline">Back to Home</Link>
          </CardContent>
        </Card>
      </div>
    );
  }


  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar */}
      <aside className={`${sidebarCollapsed ? 'w-20 px-3 py-6' : 'w-72 p-6'} bg-brand-primary text-white hidden lg:flex flex-col fixed h-full transition-all duration-200`}>
        <div className={`flex items-center mb-10 ${sidebarCollapsed ? 'flex-col gap-3' : 'justify-between px-2'}`}>
          <div className="flex items-center gap-2.5">
            <Logo variant="white" className="h-8 w-auto shrink-0" />
            {!sidebarCollapsed && <span className="text-2xl font-display font-bold tracking-tight">VAC Admin</span>}
          </div>
          <button
            onClick={toggleSidebar}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="text-white/50 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition-colors"
          >
            {sidebarCollapsed ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
          </button>
        </div>

        <nav className="space-y-2 flex-grow">
          {([
            { tab: 'inbox', label: 'Inbox', Icon: Inbox, show: role !== 'sales_rep' },
            { tab: 'crm', label: 'CRM', Icon: Database, show: true },
            { tab: 'pool', label: 'Free to Call Pool', Icon: Power, show: true },
            { tab: 'nurture', label: 'Nurture', Icon: Moon, show: role !== 'sales_rep' },
            { tab: 'salesteam', label: 'Sales Team', Icon: Users, show: role !== 'sales_rep' },
            { tab: 'reports', label: 'Reports', Icon: BarChart3, show: true },
            { tab: 'inventory', label: 'Inventory', Icon: CarIcon, show: role !== 'sales_rep' },
            { tab: 'leads', label: 'Leads', Icon: LayoutDashboard, show: role !== 'sales_rep' },
            { tab: 'team-manager', label: 'Public Team', Icon: Users, show: role === 'super_admin' },
            { tab: 'deliveries', label: 'Manage Deliveries', Icon: Truck, show: role === 'super_admin' },
          ] as { tab: Tab; label: string; Icon: any; show: boolean }[])
            .filter((n) => n.show)
            .map((n) => {
              const active = activeTab === n.tab;
              return (
                <Button
                  key={n.tab}
                  variant="ghost"
                  onClick={() => setActiveTab(n.tab)}
                  title={sidebarCollapsed ? n.label : undefined}
                  className={`w-full h-12 rounded-2xl font-bold transition-all ${sidebarCollapsed ? 'justify-center px-0' : 'justify-start'} ${active ? 'bg-brand-accent text-white shadow-lg shadow-brand-accent/30' : 'text-white/50 hover:text-white hover:bg-white/10'}`}
                >
                  <n.Icon className={`${sidebarCollapsed ? '' : 'mr-3'} h-5 w-5`} />{!sidebarCollapsed && n.label}
                </Button>
              );
            })}
        </nav>

        <div className="mt-auto pt-8 border-t border-white/10">
          {!sidebarCollapsed && realRole === 'super_admin' && (
            <div className="mb-6 p-4 bg-white/5 rounded-2xl border border-white/10">
              <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest mb-3">Role Preview</p>
              <Select 
                value={role} 
                onValueChange={(val: any) => setSimulatedRole(val === realRole ? null : val)}
              >
                <SelectTrigger className="h-9 bg-transparent border-white/10 text-xs font-bold text-white">
                  <SelectValue placeholder="Select Role" />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  <SelectItem value="super_admin">Super Admin (Real)</SelectItem>
                  <SelectItem value="general_manager">General Manager</SelectItem>
                  <SelectItem value="finance_manager">Finance Manager</SelectItem>
                  <SelectItem value="sales_rep">Sales Rep</SelectItem>
                </SelectContent>
              </Select>
              {role !== realRole && (
                <p className="text-[10px] text-brand-secondary mt-2 font-bold animate-pulse">
                  Previewing as {role.replace('_', ' ')}
                </p>
              )}
            </div>
          )}
          <div className={`flex items-center gap-3 mb-6 ${sidebarCollapsed ? 'justify-center' : ''}`}>
            <div className="h-10 w-10 rounded-full bg-brand-secondary flex items-center justify-center font-bold text-brand-primary shrink-0" title={sidebarCollapsed ? (user.displayName || user.email || '') : undefined}>
              {user.displayName?.charAt(0) || user.email?.charAt(0)}
            </div>
            {!sidebarCollapsed && (
              <div className="flex flex-col overflow-hidden">
                <span className="font-bold truncate">{user.displayName || 'Admin'}</span>
                <span className="text-xs text-white/50 truncate">{user.email}</span>
              </div>
            )}
          </div>
          <Button
            variant="ghost"
            onClick={handleLogout}
            title={sidebarCollapsed ? 'Sign Out' : undefined}
            className={`w-full h-12 rounded-xl text-white/60 hover:text-white hover:bg-white/5 font-bold ${sidebarCollapsed ? 'justify-center px-0' : 'justify-start'}`}
          >
            <LogOut className={`${sidebarCollapsed ? '' : 'mr-3'} h-5 w-5`} />{!sidebarCollapsed && 'Sign Out'}
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className={`flex-1 min-w-0 transition-all duration-200 ${sidebarCollapsed ? 'lg:ml-20' : 'lg:ml-72'} ${activeTab === 'crm' ? 'p-4 lg:p-6' : 'p-8 lg:p-12'}`}>
        {/* Top Bar */}
        <div className="flex justify-end items-center mb-8 gap-4">
          <button
            onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-label="Toggle dark mode"
            className="h-10 w-10 inline-flex items-center justify-center rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 transition"
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>

        {activeTab === 'inbox' ? (
          <CrmPanel role={role} mode="inbox" />
        ) : activeTab === 'nurture' ? (
          <CrmNurture />
        ) : activeTab === 'pool' ? (
          <CrmPanel role={role} mode="pool" />
        ) : activeTab === 'reports' ? (
          <CrmReports role={role} />
        ) : activeTab === 'salesteam' ? (
          <CrmTeam />
        ) : activeTab === 'crm' ? (
          <CrmPanel role={role} />
        ) : activeTab === 'inventory' ? (
          <>
            <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-12">
              <div>
                <h1 className="text-4xl font-display font-bold text-brand-primary mb-2">Inventory Management</h1>
                <p className="text-gray-500">Manage your vehicle listings and featured cars.</p>
              </div>
              <div className="flex gap-4">
                {inventory.length === 0 && role === 'super_admin' && (
                  <Button 
                    onClick={seedData} 
                    disabled={isSeeding}
                    variant="outline"
                    className="h-14 px-8 rounded-2xl border-brand-primary text-brand-primary font-bold hover:bg-brand-accent/5"
                  >
                    {isSeeding ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Database className="mr-2 h-5 w-5" />}
                    Seed Initial Data
                  </Button>
                )}
                
                <Button 
                  onClick={() => setIsAddVehicleOpen(true)}
                  className="h-14 px-8 rounded-2xl bg-brand-primary hover:bg-brand-secondary text-white font-bold shadow-xl shadow-brand-primary/20"
                >
                  <Plus className="mr-2 h-5 w-5" /> Add New Vehicle
                </Button>
              </div>
            </header>

            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-12">
              <Card className="rounded-3xl border border-gray-100 shadow-sm p-8">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-1">Total Vehicles</p>
                    <h3 className="text-4xl font-display font-bold text-brand-primary">{inventory.length}</h3>
                  </div>
                  <div className="bg-brand-accent/10 p-4 rounded-2xl">
                    <CarIcon className="h-8 w-8 text-brand-accent" />
                  </div>
                </div>
              </Card>
              <Card className="rounded-3xl border border-gray-100 shadow-sm p-8">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-1">Featured</p>
                    <h3 className="text-4xl font-display font-bold text-brand-primary">
                      {inventory.filter(c => c.isFeatured).length}
                    </h3>
                  </div>
                  <div className="bg-brand-accent/10 p-4 rounded-2xl">
                    <Star className="h-8 w-8 text-brand-accent" />
                  </div>
                </div>
              </Card>
              <Card className="rounded-3xl border border-gray-100 shadow-sm p-8">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-1">Active Listings</p>
                    <h3 className="text-4xl font-display font-bold text-brand-primary">{inventory.length}</h3>
                  </div>
                  <div className="bg-green-50 p-4 rounded-2xl">
                    <CheckCircle2 className="h-8 w-8 text-green-600" />
                  </div>
                </div>
              </Card>
            </div>

            {/* Delete Confirmation Modal */}
            <AnimatePresence>
              {isDeleteConfirmOpen && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={() => setIsDeleteConfirmOpen(false)}
                    className="absolute inset-0 bg-brand-primary/40 backdrop-blur-sm"
                  />
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.9, y: 20 }}
                    className="relative bg-white w-full max-w-md rounded-[2rem] shadow-2xl p-8 text-center"
                  >
                    <div className="bg-red-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6">
                      <Trash2 className="h-8 w-8 text-red-600" />
                    </div>
                    <h3 className="text-2xl font-bold text-brand-primary mb-2">Delete Vehicle?</h3>
                    <p className="text-gray-500 mb-8">This action cannot be undone. Are you sure you want to remove this vehicle from inventory?</p>
                    <div className="flex gap-4">
                      <Button 
                        onClick={confirmDelete}
                        className="flex-1 h-12 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold"
                      >
                        Yes, Delete
                      </Button>
                      <Button 
                        variant="outline" 
                        onClick={() => setIsDeleteConfirmOpen(false)}
                        className="flex-1 h-12 rounded-xl border-gray-200 font-bold"
                      >
                        Cancel
                      </Button>
                    </div>
                  </motion.div>
                </div>
              )}
            </AnimatePresence>

            {/* Error Toast/Modal */}
            <AnimatePresence>
              {error && (
                <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[70]">
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 20 }}
                    className="bg-red-600 text-white px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-3 font-bold"
                  >
                    <AlertCircle className="h-5 w-5" />
                    {error}
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      onClick={() => setError(null)}
                      className="h-8 w-8 rounded-full hover:bg-white/20 text-white ml-4"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </motion.div>
                </div>
              )}
            </AnimatePresence>
            <AnimatePresence>
              {isEditVehicleOpen && editingVehicle && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={() => setIsEditVehicleOpen(false)}
                    className="absolute inset-0 bg-brand-primary/40 backdrop-blur-sm"
                  />
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.9, y: 20 }}
                    className="relative bg-white w-full max-w-4xl rounded-[3rem] shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
                  >
                    <div className="p-8 border-b border-gray-100 flex justify-between items-center bg-white sticky top-0 z-10">
                      <div>
                        <h2 className="text-3xl font-display font-bold text-brand-primary">Edit Vehicle</h2>
                        <p className="text-gray-500">Update vehicle details.</p>
                      </div>
                      <Button variant="ghost" size="icon" onClick={() => setIsEditVehicleOpen(false)} className="rounded-full">
                        <ArrowLeft className="h-6 w-6" />
                      </Button>
                    </div>

                    <div className="p-8 overflow-y-auto">
                      <form onSubmit={handleUpdateVehicle} className="space-y-8">
                        <div className="bg-brand-bg/30 p-6 rounded-3xl border border-brand-bg mb-8">
                          <Label className="text-xs font-bold text-brand-primary uppercase tracking-widest mb-4 block">VIN Decoder & Editor</Label>
                          <div className="flex gap-4">
                            <div className="flex-1">
                              <Input 
                                placeholder="Enter 17-digit VIN" 
                                value={editingVehicle.vin || ''}
                                onChange={(e) => setEditingVehicle({...editingVehicle, vin: e.target.value.toUpperCase()})}
                                className="h-14 rounded-2xl border-brand-bg bg-white text-lg font-mono uppercase"
                                maxLength={17}
                              />
                            </div>
                            <Button 
                              type="button" 
                              onClick={handleDecodeEditingVin}
                              disabled={isDecoding || !editingVehicle.vin}
                              className="h-14 px-8 rounded-2xl bg-brand-secondary hover:bg-brand-secondary/90 font-bold"
                            >
                              {isDecoding ? <Loader2 className="h-5 w-5 animate-spin" /> : "Decode & Update"}
                            </Button>
                          </div>
                          <p className="text-[10px] text-gray-400 mt-3 font-medium italic">
                            Powered by Marketcheck API (with NHTSA fallback). Decodes Year, Make, Model, Trim, Body Style, and more.
                          </p>
                        </div>
                        <div className="space-y-8">
                          {/* 1. Core Identity & Specs */}
                          <div className="border border-gray-200 rounded-[2rem] p-8 bg-white shadow-sm space-y-8">
                            <div className="flex items-center justify-between border-b border-gray-100 pb-4">
                              <h4 className="font-display font-bold text-gray-900 text-xl flex items-center gap-2">
                                <span className="flex items-center justify-center w-8 h-8 rounded-full bg-brand-primary/10 text-brand-primary text-xs font-bold">1</span>
                                Core Identity & Specs
                              </h4>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                              <div className="space-y-2">
                                <Label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Stock Number</Label>
                                <Input value={editingVehicle.stockNumber || ''} onChange={(e) => setEditingVehicle({...editingVehicle, stockNumber: e.target.value.toUpperCase()})} placeholder="e.g. VAC-1234" className="h-12 rounded-xl border-gray-200 font-bold" />
                              </div>
                              <div className="space-y-2">
                                <Label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Year</Label>
                                <Input type="number" value={editingVehicle.year} onChange={(e) => setEditingVehicle({...editingVehicle, year: parseInt(e.target.value)})} className="h-12 rounded-xl border-gray-200" />
                              </div>
                              <div className="space-y-2">
                                <Label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Make</Label>
                                <Input value={editingVehicle.make} onChange={(e) => setEditingVehicle({...editingVehicle, make: e.target.value})} className="h-12 rounded-xl border-gray-200" />
                              </div>
                              <div className="space-y-2">
                                <Label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Model</Label>
                                <Input value={editingVehicle.model} onChange={(e) => setEditingVehicle({...editingVehicle, model: e.target.value})} className="h-12 rounded-xl border-gray-200" />
                              </div>
                              <div className="space-y-2">
                                <Label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Trim</Label>
                                <Input value={editingVehicle.trim} onChange={(e) => setEditingVehicle({...editingVehicle, trim: e.target.value})} className="h-12 rounded-xl border-gray-200" />
                              </div>
                              <div className="space-y-2">
                                <Label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Body Type</Label>
                                <Select value={editingVehicle.bodyStyle} onValueChange={(val: any) => setEditingVehicle({...editingVehicle, bodyStyle: val})}>
                                  <SelectTrigger className="h-12 rounded-xl border-gray-200"><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    {['Sedan', 'SUV', 'Truck', 'Hatchback', 'Van', 'Convertible'].map(style => (
                                      <SelectItem key={style} value={style}>{style}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="space-y-2">
                                <Label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Drivetrain</Label>
                                <Input value={editingVehicle.drivetrain || ''} onChange={(e) => setEditingVehicle({...editingVehicle, drivetrain: e.target.value})} className="h-12 rounded-xl border-gray-200" />
                              </div>
                              <div className="space-y-2">
                                <Label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Engine</Label>
                                <Input value={editingVehicle.engine || ''} onChange={(e) => setEditingVehicle({...editingVehicle, engine: e.target.value})} className="h-12 rounded-xl border-gray-200" />
                              </div>
                              <div className="space-y-2">
                                <Label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Transmission</Label>
                                <Select value={editingVehicle.transmission} onValueChange={(val: any) => setEditingVehicle({...editingVehicle, transmission: val})}>
                                  <SelectTrigger className="h-12 rounded-xl border-gray-200"><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    {['Automatic', 'Manual'].map(t => (
                                      <SelectItem key={t} value={t}>{t}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="space-y-2">
                                <Label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Fuel Type</Label>
                                <Select value={editingVehicle.fuelType} onValueChange={(val: any) => setEditingVehicle({...editingVehicle, fuelType: val})}>
                                  <SelectTrigger className="h-12 rounded-xl border-gray-200"><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    {['Gasoline', 'Diesel', 'Electric', 'Hybrid'].map(f => (
                                      <SelectItem key={f} value={f}>{f}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="space-y-2">
                                <Label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Mileage (km)</Label>
                                <Input type="number" value={editingVehicle.mileage} onChange={(e) => setEditingVehicle({...editingVehicle, mileage: parseInt(e.target.value)})} className="h-12 rounded-xl border-gray-200" />
                              </div>
                              <div className="space-y-2">
                                <Label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Previous Owners</Label>
                                <Input type="number" value={editingVehicle.owners || ''} onChange={(e) => setEditingVehicle({...editingVehicle, owners: parseInt(e.target.value)})} className="h-12 rounded-xl border-gray-200" />
                              </div>
                              <div className="space-y-2">
                                <Label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Accidents</Label>
                                <Input type="number" value={editingVehicle.accidents !== undefined ? editingVehicle.accidents : ''} onChange={(e) => setEditingVehicle({...editingVehicle, accidents: parseInt(e.target.value)})} className="h-12 rounded-xl border-gray-200" placeholder="0 for Accident Free" />
                              </div>
                            </div>
                          </div>

                          {/* 2. Performance & Capacity */}
                          <div className="border border-gray-200 rounded-[2rem] p-8 bg-gray-50/30 shadow-sm space-y-8">
                            <div className="flex items-center justify-between border-b border-gray-200 pb-4">
                              <h4 className="font-display font-bold text-gray-900 text-xl flex items-center gap-2">
                                <span className="flex items-center justify-center w-8 h-8 rounded-full bg-brand-primary/10 text-brand-primary text-xs font-bold">2</span>
                                Performance & Capacity
                              </h4>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-6">
                              <div className="space-y-2">
                                <Label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Seating Capacity</Label>
                                <Input type="number" value={editingVehicle.seats || ''} onChange={(e) => setEditingVehicle({...editingVehicle, seats: parseInt(e.target.value)})} className="h-12 rounded-xl border-gray-200 bg-white" />
                              </div>
                              <div className="space-y-2">
                                <Label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Exterior Color</Label>
                                <Input value={editingVehicle.exteriorColor} onChange={(e) => setEditingVehicle({...editingVehicle, exteriorColor: e.target.value})} className="h-12 rounded-xl border-gray-200 bg-white" />
                              </div>
                            </div>
                          </div>

                          {/* 3. Premium Feature Categorization */}
                          <div className="border border-brand-primary/20 bg-brand-primary/[0.02] rounded-[2rem] p-8 space-y-8">
                            <div className="flex items-center justify-between border-b border-brand-primary/10 pb-4">
                              <h4 className="font-display font-bold text-brand-primary text-xl flex items-center gap-2">
                                <span className="flex items-center justify-center w-8 h-8 rounded-full bg-brand-primary text-white text-xs font-bold">3</span>
                                Premium Feature Categorization
                                <span className="bg-brand-primary/10 text-brand-primary text-[10px] px-2 py-0.5 rounded-full uppercase tracking-widest font-bold ml-2">Extracted via NeoVIN</span>
                              </h4>
                              {editingVehicle.trimConfidence !== undefined && editingVehicle.trimConfidence < 0.8 && (
                                <div className="flex items-center text-amber-600 bg-amber-50 px-3 py-1 rounded-full text-xs font-semibold gap-1.5 shadow-sm border border-amber-200">
                                  <AlertCircle className="w-3.5 h-3.5" />
                                  <span>Verify Trim Accuracy</span>
                                </div>
                              )}
                            </div>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                              <div className="space-y-3">
                                <Label className="text-xs font-bold text-gray-500 uppercase tracking-widest block border-b pb-2 flex items-center gap-2">
                                  <div className="w-2 h-2 rounded-full bg-blue-500" />
                                  Comfort & Convenience
                                </Label>
                                <textarea
                                  name="comfortAndConvenience"
                                  value={(editingVehicle.comfortAndConvenience || []).join(', ')}
                                  onChange={(e) => setEditingVehicle({...editingVehicle, comfortAndConvenience: e.target.value.split(',').map(s => s.trim()).filter(Boolean)})}
                                  className="w-full min-h-[120px] p-4 rounded-2xl border border-gray-200 text-sm focus:ring-2 focus:ring-brand-primary outline-none bg-white"
                                  placeholder="e.g. Heated Seats, Navigation..."
                                />
                              </div>
 
                              <div className="space-y-3">
                                <Label className="text-xs font-bold text-gray-500 uppercase tracking-widest block border-b pb-2 flex items-center gap-2">
                                  <div className="w-2 h-2 rounded-full bg-purple-500" />
                                  Entertainment & Media
                                </Label>
                                <textarea
                                  name="entertainmentAndMedia"
                                  value={(editingVehicle.entertainmentAndMedia || []).join(', ')}
                                  onChange={(e) => setEditingVehicle({...editingVehicle, entertainmentAndMedia: e.target.value.split(',').map(s => s.trim()).filter(Boolean)})}
                                  className="w-full min-h-[120px] p-4 rounded-2xl border border-gray-200 text-sm focus:ring-2 focus:ring-brand-primary outline-none bg-white"
                                  placeholder="e.g. Bluetooth, Apple CarPlay..."
                                />
                              </div>
 
                              <div className="space-y-3">
                                <Label className="text-xs font-bold text-gray-500 uppercase tracking-widest block border-b pb-2 flex items-center gap-2">
                                  <div className="w-2 h-2 rounded-full bg-green-500" />
                                  Safety & Security
                                </Label>
                                <textarea
                                  name="safetyAndSecurity"
                                  value={(editingVehicle.safetyAndSecurity || []).join(', ')}
                                  onChange={(e) => setEditingVehicle({...editingVehicle, safetyAndSecurity: e.target.value.split(',').map(s => s.trim()).filter(Boolean)})}
                                  className="w-full min-h-[120px] p-4 rounded-2xl border border-gray-200 text-sm focus:ring-2 focus:ring-green-500 outline-none bg-white"
                                  placeholder="e.g. Lane Assist, Blind Spot..."
                                />
                              </div>
 
                              <div className="space-y-3">
                                <Label className="text-xs font-bold text-gray-500 uppercase tracking-widest block border-b pb-2 flex items-center gap-2">
                                  <div className="w-2 h-2 rounded-full bg-amber-500" />
                                  Extras & Packages
                                </Label>
                                <textarea
                                  name="extrasAndPackages"
                                  value={(editingVehicle.extrasAndPackages || []).join(', ')}
                                  onChange={(e) => setEditingVehicle({...editingVehicle, extrasAndPackages: e.target.value.split(',').map(s => s.trim()).filter(Boolean)})}
                                  className="w-full min-h-[120px] p-4 rounded-2xl border border-gray-200 text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                                  placeholder="e.g. Tech Package, Sunroof..."
                                />
                              </div>
                            </div>

                            {/* Manual Features Checklist */}
                            <div className="mt-8 pt-8 border-t border-brand-primary/10">
                              <h5 className="text-sm font-bold text-brand-primary uppercase tracking-widest mb-6 flex items-center gap-2">
                                <Plus className="w-4 h-4" />
                                Manual Feature Selection
                                <span className="bg-brand-primary/10 text-brand-primary text-[10px] px-2 py-0.5 rounded-full lowercase tracking-normal font-medium ml-2">Manually select features to display on the VDP</span>
                              </h5>
                              <div className="space-y-8">
                                {FEATURE_CATEGORIES.map((category) => (
                                  <div key={category.name}>
                                    <h6 className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] mb-4">{category.name}</h6>
                                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                                      {category.features.map((feature) => (
                                        <div 
                                          key={feature} 
                                          className={`flex items-center gap-3 p-3 rounded-xl border transition-all cursor-pointer ${
                                            (editingVehicle.features || []).includes(feature)
                                              ? 'border-brand-primary bg-brand-primary/5 shadow-sm'
                                              : 'border-gray-100 hover:border-gray-300'
                                          }`}
                                          onClick={() => {
                                            const currentFeatures = editingVehicle.features || [];
                                            const newFeatures = currentFeatures.includes(feature)
                                              ? currentFeatures.filter(f => f !== feature)
                                              : [...currentFeatures, feature];
                                            setEditingVehicle({ ...editingVehicle, features: newFeatures });
                                          }}
                                        >
                                          <div className={`w-5 h-5 rounded-md border flex items-center justify-center transition-all ${
                                            (editingVehicle.features || []).includes(feature)
                                              ? 'bg-brand-primary border-brand-primary'
                                              : 'border-gray-300 bg-white'
                                          }`}>
                                            {(editingVehicle.features || []).includes(feature) && (
                                              <CheckCircle2 className="w-3.5 h-3.5 text-white" strokeWidth={3} />
                                            )}
                                          </div>
                                          <span className={`text-xs font-bold leading-tight ${
                                            (editingVehicle.features || []).includes(feature) ? 'text-brand-primary' : 'text-gray-600'
                                          }`}>
                                            {feature}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>

                          {/* 4. Financials */}
                          <div className="border border-gray-200 rounded-[2rem] p-8 bg-white shadow-sm space-y-8">
                            <div className="flex items-center justify-between border-b border-gray-100 pb-4">
                              <h4 className="font-display font-bold text-gray-900 text-xl flex items-center gap-2">
                                <span className="flex items-center justify-center w-8 h-8 rounded-full bg-brand-primary/10 text-brand-primary text-xs font-bold">4</span>
                                Financials
                              </h4>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-1 gap-6">
                              <div className="space-y-2">
                                <div className="flex justify-between items-center mb-1">
                                  <Label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Sale Price ($)</Label>
                                  <Button type="button" variant="ghost" size="sm" onClick={() => getMarketPrice(true)} disabled={isGeneratingPrice} className="h-6 text-[10px] text-brand-primary font-bold hover:bg-brand-accent/5 rounded-lg px-2">
                                    {isGeneratingPrice ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <TrendingUp className="h-3 w-3 mr-1" />}
                                    Market Price
                                  </Button>
                                </div>
                                <Input type="number" value={editingVehicle.price} onChange={(e) => setEditingVehicle({...editingVehicle, price: parseInt(e.target.value)})} className="h-12 rounded-xl border-gray-200" />
                              </div>
                            </div>
                          </div>

                        </div>

                        <div className="space-y-2">
                          <div className="flex justify-between items-center mb-1">
                            <Label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Image URLs (one per line)</Label>
                            <Button 
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => handleFetchFromSirv(true)}
                              disabled={isFetchingSirv}
                              className="h-6 text-[10px] text-brand-primary font-bold hover:bg-brand-accent/5 rounded-lg px-2"
                            >
                              {isFetchingSirv ? (
                                <Loader2 className="h-3 w-3 animate-spin mr-1" />
                              ) : (
                                <RotateCw className="h-3 w-3 mr-1" />
                              )}
                              Auto-Fetch from Sirv
                            </Button>
                          </div>
                          <textarea 
                            value={editingVehicle.images?.join('\n') || ''}
                            onChange={(e) => setEditingVehicle({...editingVehicle, images: e.target.value.split('\n').filter(Boolean)})}
                            className="w-full min-h-[150px] p-4 rounded-2xl border border-gray-200 focus:ring-2 focus:ring-brand-primary outline-none text-sm"
                          />
                        </div>

                        <div className="space-y-2">
                          <Label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Sirv 360° URL (Optional)</Label>
                          <Input 
                            value={editingVehicle.sirvUrl || ''}
                            onChange={(e) => setEditingVehicle({...editingVehicle, sirvUrl: e.target.value})}
                            className="h-12 rounded-xl border-gray-200"
                            placeholder="https://your-account.sirv.com/..."
                          />
                        </div>

                        <div className="space-y-2">
                          <Label className="text-xs font-bold text-gray-400 uppercase tracking-widest">360° Interior Photo (Insta360 URL)</Label>
                          <Input 
                            value={editingVehicle.interior360Photo || ''}
                            onChange={(e) => setEditingVehicle({...editingVehicle, interior360Photo: e.target.value})}
                            className="h-12 rounded-xl border-gray-200"
                            placeholder="https://... (Equirectangular JPG URL)"
                          />
                        </div>

                        <div className="space-y-2">
                          <div className="flex justify-between items-center mb-2">
                            <Label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Description</Label>
                            <div className="flex items-center gap-2">
                              <Button 
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => generateAIDescription(true)}
                                disabled={isGeneratingDescription}
                                className="h-8 text-brand-primary font-bold hover:bg-brand-accent/5 rounded-lg"
                              >
                                {isGeneratingDescription ? (
                                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                ) : (
                                  <Zap className="h-4 w-4 mr-2" />
                                )}
                                Generate with AI
                              </Button>
                              {aiStatus === 'disconnected' && typeof window !== 'undefined' && (window as any).aistudio && (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={connectAI}
                                  className="h-8 text-xs font-bold border-brand-primary/20 hover:bg-brand-accent/5 rounded-lg"
                                >
                                  Connect AI
                                </Button>
                              )}
                            </div>
                          </div>
                          <textarea 
                            value={editingVehicle.description}
                            onChange={(e) => setEditingVehicle({...editingVehicle, description: e.target.value})}
                            className="w-full min-h-[120px] p-4 rounded-2xl border border-gray-200 focus:ring-2 focus:ring-brand-primary outline-none text-sm"
                          />
                        </div>

                        <div className="flex gap-4 pt-4">
                          <Button 
                            type="submit" 
                            className="flex-1 h-14 rounded-2xl bg-brand-primary hover:bg-brand-secondary text-white font-bold text-lg shadow-xl shadow-brand-primary/20"
                          >
                            Update Vehicle
                          </Button>
                          <Button 
                            type="button" 
                            variant="outline" 
                            onClick={() => setIsEditVehicleOpen(false)}
                            className="h-14 px-8 rounded-2xl border-gray-200 font-bold"
                          >
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
              {isSirvConfigOpen && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={() => setIsSirvConfigOpen(false)}
                    className="absolute inset-0 bg-brand-primary/40 backdrop-blur-sm"
                  />
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.9, y: 20 }}
                    className="relative bg-white w-full max-w-md rounded-[2rem] shadow-2xl p-8"
                  >
                    <h3 className="text-2xl font-display font-bold text-brand-primary mb-2">Sirv API Setup</h3>
                    <p className="text-sm text-gray-500 mb-6">Enter your Sirv API credentials to automatically fetch 360 spins and photos by VIN. You can find these in your Sirv Settings.</p>
                    
                    <div className="space-y-4 mb-8">
                      <div className="space-y-2">
                        <Label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Account Name</Label>
                        <Input 
                          value={sirvConfig.account}
                          onChange={(e) => setSirvConfig({...sirvConfig, account: e.target.value})}
                          placeholder="e.g. mydealership"
                          className="h-12 rounded-xl border-gray-200"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Client ID</Label>
                        <Input 
                          value={sirvConfig.clientId}
                          onChange={(e) => setSirvConfig({...sirvConfig, clientId: e.target.value})}
                          placeholder="Enter Client ID"
                          className="h-12 rounded-xl border-gray-200"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Client Secret</Label>
                        <Input 
                          type="password"
                          value={sirvConfig.clientSecret}
                          onChange={(e) => setSirvConfig({...sirvConfig, clientSecret: e.target.value})}
                          placeholder="Enter Client Secret"
                          className="h-12 rounded-xl border-gray-200"
                        />
                      </div>
                    </div>

                    <div className="flex gap-3">
                      <Button onClick={saveSirvConfig} className="flex-1 h-12 rounded-xl bg-brand-primary hover:bg-brand-secondary text-white font-bold">
                        Save & Continue
                      </Button>
                      <Button variant="outline" onClick={() => setIsSirvConfigOpen(false)} className="h-12 rounded-xl font-bold">
                        Cancel
                      </Button>
                    </div>
                  </motion.div>
                </div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {isAddVehicleOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={() => setIsAddVehicleOpen(false)}
                    className="absolute inset-0 bg-brand-primary/40 backdrop-blur-sm"
                  />
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.9, y: 20 }}
                    className="relative bg-white w-full max-w-4xl rounded-[3rem] shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
                  >
                    <div className="p-8 border-b border-gray-100 flex justify-between items-center bg-white sticky top-0 z-10">
                      <div>
                        <h2 className="text-3xl font-display font-bold text-brand-primary">Add New Vehicle</h2>
                        <p className="text-gray-500">Enter vehicle details or use the VIN decoder.</p>
                      </div>
                      <Button variant="ghost" size="icon" onClick={() => setIsAddVehicleOpen(false)} className="rounded-full">
                        <ArrowLeft className="h-6 w-6" />
                      </Button>
                    </div>

                    <div className="p-8 overflow-y-auto">
                      <form onSubmit={handleAddVehicle} className="space-y-8">
                        {/* VIN Decoder Section */}
                        <div className="bg-brand-bg/50 p-8 rounded-[2rem] border border-brand-bg">
                          <Label className="text-xs font-bold text-brand-primary uppercase tracking-widest mb-4 block">VIN Decoder</Label>
                          <div className="flex gap-4">
                            <div className="flex-1">
                              <Input 
                                placeholder="Enter 17-digit VIN" 
                                value={newVehicle.vin}
                                onChange={(e) => setNewVehicle({...newVehicle, vin: e.target.value.toUpperCase()})}
                                className="h-14 rounded-2xl border-brand-bg bg-white text-lg font-mono uppercase"
                              />
                            </div>
                            <Button 
                              type="button" 
                              onClick={handleDecodeVin}
                              disabled={isDecoding || !newVehicle.vin}
                              className="h-14 px-8 rounded-2xl bg-brand-secondary hover:bg-brand-secondary/90 font-bold"
                            >
                              {isDecoding ? <Loader2 className="h-5 w-5 animate-spin" /> : "Decode VIN"}
                            </Button>
                          </div>
                          <p className="text-[10px] text-gray-400 mt-3 font-medium italic">
                            Powered by Marketcheck API (with NHTSA fallback). Decodes Year, Make, Model, Trim, Body Style, and more.
                          </p>
                        </div>
                        {/* 1. Core Identity & Specs */}
                        <div className="border border-gray-200 rounded-[2rem] p-8 bg-white shadow-sm space-y-8">
                          <div className="flex items-center justify-between border-b border-gray-100 pb-4">
                            <h4 className="font-display font-bold text-gray-900 text-xl flex items-center gap-2">
                              <span className="flex items-center justify-center w-8 h-8 rounded-full bg-brand-primary/10 text-brand-primary text-xs font-bold">1</span>
                              Core Identity & Specs
                            </h4>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                            <div className="space-y-2">
                              <Label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Stock Number</Label>
                              <Input value={newVehicle.stockNumber || ''} onChange={(e) => setNewVehicle({...newVehicle, stockNumber: e.target.value.toUpperCase()})} placeholder="e.g. VAC-1234" className="h-12 rounded-xl border-gray-200 font-bold" />
                            </div>
                            <div className="space-y-2">
                              <Label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Year</Label>
                              <Input type="number" value={newVehicle.year} onChange={(e) => setNewVehicle({...newVehicle, year: parseInt(e.target.value)})} className="h-12 rounded-xl border-gray-200" />
                            </div>
                            <div className="space-y-2">
                              <Label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Make</Label>
                              <Input value={newVehicle.make} onChange={(e) => setNewVehicle({...newVehicle, make: e.target.value})} className="h-12 rounded-xl border-gray-200" />
                            </div>
                            <div className="space-y-2">
                              <Label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Model</Label>
                              <Input value={newVehicle.model} onChange={(e) => setNewVehicle({...newVehicle, model: e.target.value})} className="h-12 rounded-xl border-gray-200" />
                            </div>
                            <div className="space-y-2">
                              <Label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Trim</Label>
                              <Input value={newVehicle.trim} onChange={(e) => setNewVehicle({...newVehicle, trim: e.target.value})} className="h-12 rounded-xl border-gray-200" />
                            </div>
                            <div className="space-y-2">
                              <Label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Body Type</Label>
                              <Select value={newVehicle.bodyStyle} onValueChange={(val: any) => setNewVehicle({...newVehicle, bodyStyle: val})}>
                                <SelectTrigger className="h-12 rounded-xl border-gray-200"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  {['Sedan', 'SUV', 'Truck', 'Hatchback', 'Van', 'Convertible'].map(style => (
                                    <SelectItem key={style} value={style}>{style}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-2">
                              <Label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Drivetrain</Label>
                              <Input value={newVehicle.drivetrain || ''} onChange={(e) => setNewVehicle({...newVehicle, drivetrain: e.target.value})} className="h-12 rounded-xl border-gray-200" />
                            </div>
                            <div className="space-y-2">
                              <Label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Engine</Label>
                              <Input value={newVehicle.engine || ''} onChange={(e) => setNewVehicle({...newVehicle, engine: e.target.value})} className="h-12 rounded-xl border-gray-200" />
                            </div>
                            <div className="space-y-2">
                              <Label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Transmission</Label>
                              <Select value={newVehicle.transmission} onValueChange={(val: any) => setNewVehicle({...newVehicle, transmission: val})}>
                                <SelectTrigger className="h-12 rounded-xl border-gray-200"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  {['Automatic', 'Manual'].map(t => (
                                    <SelectItem key={t} value={t}>{t}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-2">
                              <Label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Fuel Type</Label>
                              <Select value={newVehicle.fuelType} onValueChange={(val: any) => setNewVehicle({...newVehicle, fuelType: val})}>
                                <SelectTrigger className="h-12 rounded-xl border-gray-200"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  {['Gasoline', 'Diesel', 'Electric', 'Hybrid'].map(f => (
                                    <SelectItem key={f} value={f}>{f}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-2">
                              <Label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Mileage (km)</Label>
                              <Input type="number" value={newVehicle.mileage} onChange={(e) => setNewVehicle({...newVehicle, mileage: parseInt(e.target.value)})} className="h-12 rounded-xl border-gray-200" />
                            </div>
                            <div className="space-y-2">
                              <Label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Previous Owners</Label>
                              <Input type="number" value={newVehicle.owners || ''} onChange={(e) => setNewVehicle({...newVehicle, owners: parseInt(e.target.value)})} className="h-12 rounded-xl border-gray-200" />
                            </div>
                            <div className="space-y-2">
                              <Label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Accidents</Label>
                              <Input type="number" value={newVehicle.accidents !== undefined ? newVehicle.accidents : ''} onChange={(e) => setNewVehicle({...newVehicle, accidents: parseInt(e.target.value)})} className="h-12 rounded-xl border-gray-200" placeholder="0 for Accident Free" />
                            </div>
                          </div>
                        </div>

                        {/* 2. Performance & Capacity */}
                        <div className="border border-gray-200 rounded-[2rem] p-8 bg-gray-50/30 shadow-sm space-y-8">
                          <div className="flex items-center justify-between border-b border-gray-200 pb-4">
                            <h4 className="font-display font-bold text-gray-900 text-xl flex items-center gap-2">
                              <span className="flex items-center justify-center w-8 h-8 rounded-full bg-brand-primary/10 text-brand-primary text-xs font-bold">2</span>
                              Performance & Capacity
                            </h4>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-6">
                            <div className="space-y-2">
                              <Label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Seating Capacity</Label>
                              <Input type="number" value={newVehicle.seats || ''} onChange={(e) => setNewVehicle({...newVehicle, seats: parseInt(e.target.value)})} className="h-12 rounded-xl border-gray-200 bg-white" />
                            </div>
                            <div className="space-y-2">
                              <Label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Exterior Color</Label>
                              <Input value={newVehicle.exteriorColor} onChange={(e) => setNewVehicle({...newVehicle, exteriorColor: e.target.value})} className="h-12 rounded-xl border-gray-200 bg-white" />
                            </div>
                          </div>
                        </div>

                        {/* 3. Premium Feature Categorization */}
                        <div className="border border-brand-primary/20 bg-brand-primary/[0.02] rounded-[2rem] p-8 space-y-8">
                          <div className="flex items-center justify-between border-b border-brand-primary/10 pb-4">
                            <h4 className="font-display font-bold text-brand-primary text-xl flex items-center gap-2">
                              <span className="flex items-center justify-center w-8 h-8 rounded-full bg-brand-primary text-white text-xs font-bold">3</span>
                              Premium Feature Categorization
                              <span className="bg-brand-primary/10 text-brand-primary text-[10px] px-2 py-0.5 rounded-full uppercase tracking-widest font-bold ml-2">Extracted via NeoVIN</span>
                            </h4>
                            {newVehicle.trimConfidence !== undefined && newVehicle.trimConfidence < 0.8 && (
                              <div className="flex items-center text-amber-600 bg-amber-50 px-3 py-1 rounded-full text-xs font-semibold gap-1.5 shadow-sm border border-amber-200">
                                <AlertCircle className="w-3.5 h-3.5" />
                                <span>Verify Trim Accuracy</span>
                              </div>
                            )}
                          </div>
                          
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            <div className="space-y-3">
                              <Label className="text-xs font-bold text-gray-500 uppercase tracking-widest block border-b pb-2 flex items-center gap-2">
                                <div className="w-2 h-2 rounded-full bg-blue-500" />
                                Comfort & Convenience
                              </Label>
                              <textarea
                                name="comfortAndConvenience"
                                value={(newVehicle.comfortAndConvenience || []).join(', ')}
                                onChange={(e) => setNewVehicle({...newVehicle, comfortAndConvenience: e.target.value.split(',').map(s => s.trim()).filter(Boolean)})}
                                className="w-full min-h-[120px] p-4 rounded-2xl border border-gray-200 text-sm focus:ring-2 focus:ring-brand-primary outline-none bg-white"
                                placeholder="e.g. Heated Seats, Navigation..."
                              />
                            </div>
 
                            <div className="space-y-3">
                              <Label className="text-xs font-bold text-gray-500 uppercase tracking-widest block border-b pb-2 flex items-center gap-2">
                                <div className="w-2 h-2 rounded-full bg-purple-500" />
                                Entertainment & Media
                              </Label>
                              <textarea
                                name="entertainmentAndMedia"
                                value={(newVehicle.entertainmentAndMedia || []).join(', ')}
                                onChange={(e) => setNewVehicle({...newVehicle, entertainmentAndMedia: e.target.value.split(',').map(s => s.trim()).filter(Boolean)})}
                                className="w-full min-h-[120px] p-4 rounded-2xl border border-gray-200 text-sm focus:ring-2 focus:ring-brand-primary outline-none bg-white"
                                placeholder="e.g. Bluetooth, Apple CarPlay..."
                              />
                            </div>
 
                            <div className="space-y-3">
                              <Label className="text-xs font-bold text-gray-500 uppercase tracking-widest block border-b pb-2 flex items-center gap-2">
                                <div className="w-2 h-2 rounded-full bg-green-500" />
                                Safety & Security
                              </Label>
                              <textarea
                                name="safetyAndSecurity"
                                value={(newVehicle.safetyAndSecurity || []).join(', ')}
                                onChange={(e) => setNewVehicle({...newVehicle, safetyAndSecurity: e.target.value.split(',').map(s => s.trim()).filter(Boolean)})}
                                className="w-full min-h-[120px] p-4 rounded-2xl border border-gray-200 text-sm focus:ring-2 focus:ring-green-500 outline-none bg-white"
                                placeholder="e.g. Lane Assist, Blind Spot..."
                              />
                            </div>
 
                            <div className="space-y-3">
                              <Label className="text-xs font-bold text-gray-500 uppercase tracking-widest block border-b pb-2 flex items-center gap-2">
                                <div className="w-2 h-2 rounded-full bg-amber-500" />
                                Extras & Packages
                              </Label>
                              <textarea
                                name="extrasAndPackages"
                                value={(newVehicle.extrasAndPackages || []).join(', ')}
                                onChange={(e) => setNewVehicle({...newVehicle, extrasAndPackages: e.target.value.split(',').map(s => s.trim()).filter(Boolean)})}
                                className="w-full min-h-[120px] p-4 rounded-2xl border border-gray-200 text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                                placeholder="e.g. Tech Package, Sunroof..."
                              />
                            </div>
                          </div>

                          {/* Manual Features Checklist */}
                          <div className="mt-8 pt-8 border-t border-brand-primary/10">
                            <h5 className="text-sm font-bold text-brand-primary uppercase tracking-widest mb-6 flex items-center gap-2">
                              <Plus className="w-4 h-4" />
                              Manual Feature Selection
                              <span className="bg-brand-primary/10 text-brand-primary text-[10px] px-2 py-0.5 rounded-full lowercase tracking-normal font-medium ml-2">Manually select features to display on the VDP</span>
                            </h5>
                            <div className="space-y-8">
                              {FEATURE_CATEGORIES.map((category) => (
                                <div key={category.name}>
                                  <h6 className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] mb-4">{category.name}</h6>
                                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                                    {category.features.map((feature) => (
                                      <div 
                                        key={feature} 
                                        className={`flex items-center gap-3 p-3 rounded-xl border transition-all cursor-pointer ${
                                          (newVehicle.features || []).includes(feature)
                                            ? 'border-brand-primary bg-brand-primary/5 shadow-sm'
                                            : 'border-gray-100 hover:border-gray-300'
                                        }`}
                                        onClick={() => {
                                          const currentFeatures = newVehicle.features || [];
                                          const newFeatures = currentFeatures.includes(feature)
                                            ? currentFeatures.filter(f => f !== feature)
                                            : [...currentFeatures, feature];
                                          setNewVehicle({ ...newVehicle, features: newFeatures });
                                        }}
                                      >
                                        <div className={`w-5 h-5 rounded-md border flex items-center justify-center transition-all ${
                                          (newVehicle.features || []).includes(feature)
                                            ? 'bg-brand-primary border-brand-primary'
                                            : 'border-gray-300 bg-white'
                                        }`}>
                                          {(newVehicle.features || []).includes(feature) && (
                                            <CheckCircle2 className="w-3.5 h-3.5 text-white" strokeWidth={3} />
                                          )}
                                        </div>
                                        <span className={`text-xs font-bold leading-tight ${
                                          (newVehicle.features || []).includes(feature) ? 'text-brand-primary' : 'text-gray-600'
                                        }`}>
                                          {feature}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>

                        {/* 4. Financials */}
                        <div className="border border-gray-200 rounded-[2rem] p-8 bg-white shadow-sm space-y-8">
                          <div className="flex items-center justify-between border-b border-gray-100 pb-4">
                            <h4 className="font-display font-bold text-gray-900 text-xl flex items-center gap-2">
                              <span className="flex items-center justify-center w-8 h-8 rounded-full bg-brand-primary/10 text-brand-primary text-xs font-bold">4</span>
                              Financials
                            </h4>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-1 gap-6">
                            <div className="space-y-2">
                              <div className="flex justify-between items-center mb-1">
                                <Label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Sale Price ($)</Label>
                                <Button type="button" variant="ghost" size="sm" onClick={() => getMarketPrice(false)} disabled={isGeneratingPrice} className="h-6 text-[10px] text-brand-primary font-bold hover:bg-brand-accent/5 rounded-lg px-2">
                                  {isGeneratingPrice ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <TrendingUp className="h-3 w-3 mr-1" />}
                                  Market Price
                                </Button>
                              </div>
                              <Input type="number" value={newVehicle.price} onChange={(e) => setNewVehicle({...newVehicle, price: parseInt(e.target.value)})} className="h-12 rounded-xl border-gray-200" />
                            </div>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <div className="flex justify-between items-center mb-1">
                            <Label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Image URLs (one per line)</Label>
                            <Button 
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => handleFetchFromSirv(false)}
                              disabled={isFetchingSirv}
                              className="h-6 text-[10px] text-brand-primary font-bold hover:bg-brand-accent/5 rounded-lg px-2"
                            >
                              {isFetchingSirv ? (
                                <Loader2 className="h-3 w-3 animate-spin mr-1" />
                              ) : (
                                <RotateCw className="h-3 w-3 mr-1" />
                              )}
                              Auto-Fetch from Sirv
                            </Button>
                          </div>
                          <textarea 
                            value={newVehicle.images?.join('\n') || ''}
                            onChange={(e) => setNewVehicle({...newVehicle, images: e.target.value.split('\n').filter(Boolean)})}
                            className="w-full min-h-[150px] p-4 rounded-2xl border border-gray-200 focus:ring-2 focus:ring-brand-primary outline-none text-sm"
                            placeholder="https://..."
                          />
                        </div>

                        <div className="space-y-2">
                          <Label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Sirv 360° URL (Optional)</Label>
                          <Input 
                            value={newVehicle.sirvUrl || ''}
                            onChange={(e) => setNewVehicle({...newVehicle, sirvUrl: e.target.value})}
                            className="h-12 rounded-xl border-gray-200"
                            placeholder="https://your-account.sirv.com/..."
                          />
                        </div>

                        <div className="space-y-2">
                          <Label className="text-xs font-bold text-gray-400 uppercase tracking-widest">360° Interior Photo (Insta360 URL)</Label>
                          <Input 
                            value={newVehicle.interior360Photo || ''}
                            onChange={(e) => setNewVehicle({...newVehicle, interior360Photo: e.target.value})}
                            className="h-12 rounded-xl border-gray-200"
                            placeholder="https://... (Equirectangular JPG URL)"
                          />
                        </div>

                        <div className="space-y-2">
                          <div className="flex justify-between items-center mb-2">
                            <Label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Description</Label>
                            <div className="flex items-center gap-2">
                              <Button 
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => generateAIDescription(false)}
                                disabled={isGeneratingDescription}
                                className="h-8 text-brand-primary font-bold hover:bg-brand-accent/5 rounded-lg"
                              >
                                {isGeneratingDescription ? (
                                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                ) : (
                                  <Zap className="h-4 w-4 mr-2" />
                                )}
                                Generate with AI
                              </Button>
                              {aiStatus === 'disconnected' && typeof window !== 'undefined' && (window as any).aistudio && (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={connectAI}
                                  className="h-8 text-xs font-bold border-brand-primary/20 hover:bg-brand-accent/5 rounded-lg"
                                >
                                  Connect AI
                                </Button>
                              )}
                            </div>
                          </div>
                          <textarea 
                            value={newVehicle.description}
                            onChange={(e) => setNewVehicle({...newVehicle, description: e.target.value})}
                            className="w-full min-h-[120px] p-4 rounded-2xl border border-gray-200 focus:ring-2 focus:ring-brand-primary outline-none text-sm"
                            placeholder="Describe the vehicle..."
                          />
                        </div>

                        <div className="flex gap-4 pt-4">
                          <Button 
                            type="submit" 
                            className="flex-1 h-14 rounded-2xl bg-brand-primary hover:bg-brand-secondary text-white font-bold text-lg shadow-xl shadow-brand-primary/20"
                          >
                            Add Vehicle to Inventory
                          </Button>
                          <Button 
                            type="button" 
                            variant="outline" 
                            onClick={() => setIsAddVehicleOpen(false)}
                            className="h-14 px-8 rounded-2xl border-gray-200 font-bold"
                          >
                            Cancel
                          </Button>
                        </div>
                      </form>
                    </div>
                  </motion.div>
                </div>
              )}
            </AnimatePresence>
            <Card className="rounded-[2.5rem] border-none shadow-sm overflow-hidden">
              <div className="p-8 border-b border-gray-50 flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="flex items-center gap-4">
                  <h2 className="text-2xl font-display font-bold text-brand-primary">All Listings</h2>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleManualSync}
                    disabled={isSyncingCatalog}
                    className="rounded-xl border-brand-primary/20 text-brand-primary hover:bg-brand-primary hover:text-white font-bold h-10 px-4"
                  >
                    {isSyncingCatalog ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <Share2 className="h-4 w-4 mr-2" />
                    )}
                    Sync Google Sheet
                  </Button>
                </div>
                <div className="relative w-full md:w-96 group">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-[#41456B] transition-colors duration-200" />
                  <Input 
                    placeholder="Search by make, model..." 
                    className="h-12 pl-12 rounded-xl bg-white border border-[#CBD5E1] shadow-sm placeholder:text-[#64748B] font-medium text-[16px] transition-all duration-200 hover:border-[#7380FF] hover:shadow-md focus-visible:border-[#7380FF] focus-visible:shadow-md focus-visible:ring-0"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
              </div>

              {selectedVehicleIds.length > 0 && (
                <div className="mx-8 mb-4 p-4 bg-brand-bg rounded-2xl flex items-center justify-between border border-brand-primary/10 animate-in fade-in slide-in-from-top-2">
                  <div className="flex items-center gap-4">
                    <Badge className="bg-brand-primary text-white px-3 py-1 rounded-full font-bold">
                      {selectedVehicleIds.length} Selected
                    </Badge>
                    <p className="text-sm text-brand-primary font-medium">Bulk actions available</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="rounded-xl border-brand-primary/20 text-brand-primary hover:bg-brand-primary hover:text-white font-bold"
                      onClick={handleBulkSirvSync}
                      disabled={isBulkSyncing}
                    >
                      {isBulkSyncing ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <RotateCw className="h-4 w-4 mr-2" />
                      )}
                      Sync Sirv
                    </Button>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="rounded-xl border-red-200 text-red-600 hover:bg-red-600 hover:text-white font-bold"
                      onClick={handleBulkDelete}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="rounded-xl text-gray-400 hover:text-gray-600"
                      onClick={() => setSelectedVehicleIds([])}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}

              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-gray-50/50">
                      <th className="pl-8 py-5 w-10">
                        <input 
                          type="checkbox" 
                          className="h-5 w-5 rounded border-gray-300 text-brand-primary focus:ring-brand-primary cursor-pointer"
                          checked={selectedVehicleIds.length === filteredInventory.length && filteredInventory.length > 0}
                          onChange={toggleSelectAll}
                        />
                      </th>
                      <th className="px-8 py-5 text-sm font-bold text-gray-400 uppercase tracking-widest">Vehicle</th>
                      <th className="px-8 py-5 text-sm font-bold text-gray-400 uppercase tracking-widest">Stock # / VIN</th>
                      <th className="px-8 py-5 text-sm font-bold text-gray-400 uppercase tracking-widest">Price</th>
                      <th className="px-8 py-5 text-sm font-bold text-gray-400 uppercase tracking-widest">Status</th>
                      <th className="px-8 py-5 text-sm font-bold text-gray-400 uppercase tracking-widest">Featured</th>
                      <th className="px-8 py-5 text-sm font-bold text-gray-400 uppercase tracking-widest text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {inventoryLoading ? (
                      <tr>
                        <td colSpan={7} className="px-8 py-20 text-center">
                          <Loader2 className="h-8 w-8 text-brand-primary animate-spin mx-auto mb-4" />
                          <p className="text-gray-500">Loading inventory data...</p>
                        </td>
                      </tr>
                    ) : filteredInventory.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-8 py-20 text-center">
                          <p className="text-gray-500 text-lg">No vehicles found matching your search.</p>
                        </td>
                      </tr>
                    ) : filteredInventory.map((car) => (
                      <tr key={car.id} className={`hover:bg-gray-50/30 transition-colors ${selectedVehicleIds.includes(car.id) ? 'bg-brand-bg/50' : ''}`}>
                        <td className="pl-8 py-6">
                          <input 
                            type="checkbox" 
                            className="h-5 w-5 rounded border-gray-300 text-brand-primary focus:ring-brand-primary cursor-pointer"
                            checked={selectedVehicleIds.includes(car.id)}
                            onChange={() => toggleVehicleSelection(car.id)}
                          />
                        </td>
                        <td className="px-8 py-6">
                          <div className="flex items-center gap-4">
                            <div className="h-16 w-24 rounded-xl overflow-hidden bg-gray-100 flex-shrink-0">
                              <img 
                                src={car.images?.[0] || 'https://picsum.photos/seed/car/800/600'} 
                                alt={car.model} 
                                className="h-full w-full object-cover"
                                referrerPolicy="no-referrer"
                              />
                            </div>
                            <div>
                              <p className="font-bold text-brand-primary text-lg">{car.year} {car.make} {car.model}</p>
                              <p className="text-sm text-gray-400">{car.trim} • {(car.mileage || 0).toLocaleString()} km</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-8 py-6">
                          <div className="flex flex-col">
                            <span className="font-bold text-brand-primary font-mono">{car.stockNumber || 'NO STOCK #'}</span>
                            <span className="text-[10px] text-gray-400 font-mono uppercase truncate max-w-[120px]" title={car.vin}>{car.vin || 'N/A'}</span>
                          </div>
                        </td>
                        <td className="px-8 py-6">
                          <span className="font-bold text-brand-primary text-lg">${(car.price || 0).toLocaleString()}</span>
                        </td>
                        <td className="px-8 py-6">
                          <Select 
                            value={car.status || 'For Sale'} 
                            onValueChange={(val: any) => updateVehicleStatus(car.id, val)}
                            disabled={role === 'sales_rep'}
                          >
                            <SelectTrigger className="h-10 w-32 rounded-xl border-gray-100 bg-white text-xs font-bold">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="rounded-xl">
                              <SelectItem value="For Sale">For Sale</SelectItem>
                              <SelectItem value="Pending Sale">Pending Sale</SelectItem>
                              <SelectItem value="Sold">Sold</SelectItem>
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-8 py-6">
                          <Button 
                            variant="ghost" 
                            size="sm"
                            disabled={role !== 'super_admin' && role !== 'general_manager'}
                            className={`rounded-full h-10 w-10 p-0 ${car.isFeatured ? 'text-brand-secondary bg-brand-secondary/10' : 'text-gray-300 hover:text-brand-secondary'}`}
                            onClick={async () => {
                              await updateDoc(doc(db, 'inventory', car.id), {
                                isFeatured: !car.isFeatured,
                                updatedAt: Timestamp.now()
                              });
                            }}
                          >
                            <Star className={`h-5 w-5 ${car.isFeatured ? 'fill-current' : ''}`} />
                          </Button>
                        </td>
                        <td className="px-8 py-6 text-right">
                          <div className="flex justify-end gap-2">
                            {(role === 'super_admin' || role === 'general_manager') && (
                              <>
                                <Button 
                                  variant="ghost" 
                                  size="icon" 
                                  className="h-10 w-10 rounded-xl text-gray-400 hover:text-brand-primary hover:bg-brand-accent/5"
                                  onClick={() => handleEdit(car)}
                                >
                                  <Edit2 className="h-5 w-5" />
                                </Button>
                                <Button 
                                  variant="ghost" 
                                  size="icon" 
                                  className="h-10 w-10 rounded-xl text-gray-400 hover:text-red-600 hover:bg-red-50"
                                  onClick={() => handleDelete(car.id)}
                                >
                                  <Trash2 className="h-5 w-5" />
                                </Button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        ) : activeTab === 'team-manager' ? (
          <TeamManager />
        ) : activeTab === 'deliveries' ? (
              <div className="space-y-8">
                <h2 className="text-3xl font-display font-bold text-brand-primary">Manage Deliveries</h2>
                <Card className="rounded-3xl border-gray-100 shadow-sm p-6">
                  <form onSubmit={async (e) => {
                    e.preventDefault();
                    if (!newDelivery.photo && !editingDelivery) {
                      toast.error('Please upload a photo');
                      return;
                    }
                    setIsUploadingDelivery(true);
                    try {
                      let photoUrl = newDelivery.photoUrl || '';
                      if (newDelivery.photo) {
                        // Phone photos arrive at 5-6MB. Firebase Storage serves
                        // whatever we upload — it can't resize on the fly — so a
                        // raw upload becomes a 6MB download for every visitor.
                        // Shrink it here, once, instead.
                        const compressed = await compressImage(newDelivery.photo, 1600, 0.82);
                        const photoRef = ref(storage, `deliveries/${Date.now()}_${compressed.name}`);
                        await uploadBytes(photoRef, compressed);
                        photoUrl = await getDownloadURL(photoRef);
                      }
                      
                      const deliveryData = {
                        firstName: newDelivery.firstName,
                        lastInitial: newDelivery.lastInitial,
                        vehicle: newDelivery.vehicle,
                        city: newDelivery.city,
                        province: newDelivery.province,
                        photoUrl,
                        createdAt: editingDelivery ? newDelivery.createdAt : Timestamp.now(),
                      };

                      if (editingDelivery) {
                        await updateDoc(doc(db, 'deliveries', editingDelivery), deliveryData);
                        toast.success('Delivery updated!');
                      } else {
                        await addDoc(collection(db, 'deliveries'), deliveryData);
                        toast.success('Delivery added!');
                      }
                      setNewDelivery({ firstName: '', lastInitial: '', vehicle: '', city: '', province: '', photo: null, photoUrl: '', createdAt: null });
                      setEditingDelivery(null);
                    } catch (error) {
                      handleFirestoreError(error, editingDelivery ? OperationType.UPDATE : OperationType.CREATE, 'deliveries');
                    } finally {
                      setIsUploadingDelivery(false);
                    }
                  }} className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <Input placeholder="First Name" value={newDelivery.firstName} onChange={(e) => setNewDelivery({...newDelivery, firstName: e.target.value})} required />
                      <Input placeholder="Last Initial" value={newDelivery.lastInitial} onChange={(e) => setNewDelivery({...newDelivery, lastInitial: e.target.value})} required />
                    </div>
                    <Input placeholder="Year/Make/Model" value={newDelivery.vehicle} onChange={(e) => setNewDelivery({...newDelivery, vehicle: e.target.value})} required />
                    <div className="grid grid-cols-2 gap-4">
                      <Input placeholder="City" value={newDelivery.city} onChange={(e) => setNewDelivery({...newDelivery, city: e.target.value})} required />
                      <Input placeholder="Province" value={newDelivery.province} onChange={(e) => setNewDelivery({...newDelivery, province: e.target.value})} required />
                    </div>
                    <Input type="file" onChange={(e) => setNewDelivery({...newDelivery, photo: e.target.files?.[0] || null})} required={!editingDelivery} />
                    <Button type="submit" className="w-full" disabled={isUploadingDelivery}>{isUploadingDelivery ? 'Uploading...' : editingDelivery ? 'Update Delivery' : 'Add Delivery'}</Button>
                  </form>
                </Card>
                
                <div className="mt-8">
                  <h3 className="text-xl font-bold text-brand-primary mb-4">Existing Deliveries</h3>
                  <div className="space-y-4">
                    {deliveries.map(delivery => (
                      <Card key={delivery.id} className="p-4 flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <img src={delivery.photoUrl} alt={delivery.firstName} className="h-16 w-16 rounded-lg object-cover" />
                          <div>
                            <p className="font-bold">{delivery.firstName} {delivery.lastInitial}</p>
                            <p className="text-sm text-gray-500">{delivery.vehicle}</p>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button variant="outline" onClick={() => {
                            setEditingDelivery(delivery.id);
                            setNewDelivery({ ...delivery, photo: null });
                          }}>Edit</Button>
                          <Button variant="destructive" onClick={() => {
                            toast('Are you sure you want to delete this delivery?', {
                              action: {
                                label: 'Delete',
                                onClick: async () => {
                                  try {
                                    await deleteDoc(doc(db, 'deliveries', delivery.id));
                                    const photoRef = ref(storage, delivery.photoUrl);
                                    await deleteObject(photoRef);
                                    toast.success('Delivery deleted!');
                                  } catch (error) {
                                    handleFirestoreError(error, OperationType.DELETE, 'deliveries');
                                  }
                                }
                              }
                            });
                          }}>Delete</Button>
                        </div>
                      </Card>
                    ))}
                  </div>
                </div>
              </div>
            ) : activeTab === 'leads' ? (
              <LeadsPanel />
            ) : (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="h-20 w-20 bg-gray-100 rounded-full flex items-center justify-center mb-6">
                  <LayoutDashboard className="h-10 w-10 text-gray-400" />
                </div>
                <h3 className="text-2xl font-display font-bold text-brand-primary mb-2">Select a Tab</h3>
                <p className="text-gray-500 max-w-sm">Please select a section from the navigation above to manage your dealership.</p>
              </div>
            )}
          </main>
        </div>
      );
    }
