export interface Car {
  id: string;
  vin?: string;
  stockNumber?: string;
  make: string;
  model: string;
  trim: string;
  year: number;
  price: number;
  mileage: number;
  bodyStyle: 'Sedan' | 'SUV' | 'Truck' | 'Hatchback' | 'Van' | 'Convertible';
  transmission: 'Automatic' | 'Manual';
  fuelType: 'Gasoline' | 'Diesel' | 'Electric' | 'Hybrid';
  exteriorColor: string;
  interiorColor: string;
  images: string[];
  features: string[];
  description: string;
  isFeatured?: boolean;
  isClearance?: boolean;
  biWeekly?: number;
  marketPriceRating?: 'Great Price' | 'Good Price' | 'Fair Price' | 'High Price';
  marketPriceDifference?: number;
  sirvUrl?: string;
  interior360Photo?: string;
  interior360Url?: string;
  engine?: string;
  engineSize?: number;
  cylinders?: number;
  drivetrain?: string;
  doors?: number;
  seats?: number;
  highwayMpg?: number;
  cityMpg?: number;
  powertrainType?: string;
  featureBadges?: string[];
  packages?: { name: string; msrp?: number }[];
  safetySuite?: string[];
  manufacturerColor?: string;
  transmissionDescription?: string;
  trimConfidence?: number;
  comfortAndConvenience?: string[];
  entertainmentAndMedia?: string[];
  safetyAndSecurity?: string[];
  extrasAndPackages?: string[];
  searchTags?: string[];
  baseMsrp?: number;
  totalMsrp?: number;
  width?: string;
  height?: string;
  length?: string;
  wheelbase?: string;
  curbWeight?: string;
  manufacturerCode?: string;
  packageCode?: string;
  accidents?: number;
  owners?: number;
  status?: 'For Sale' | 'Pending Sale' | 'Sold';
  updatedAt?: any;
  createdAt?: any;
  soldAt?: any;
}

export interface FinancingApplication {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  employmentStatus: string;
  monthlyIncome: number;
  creditScoreRange: string;
  preferredVehicleId?: string;
}

export interface SoldStory {
  id: string;
  imageUrl: string;
  customerName: string;
  location: string;
  vehicleInfo: string;
  timestamp: any;
}

export interface Delivery {
  id: string;
  firstName: string;
  lastInitial: string;
  vehicle: string;
  city: string;
  province: string;
  photoUrl: string;
  createdAt: any;
}
