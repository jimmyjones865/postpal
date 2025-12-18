export interface ShippingProduct {
  id: string;
  name: string;
  description: string;
  price: string;
  type: 'domestic' | 'international';
}

export interface SenderAddress {
  name: string;
  company?: string;
  street: string;
  city: string;
  postalCode: string;
  country: string;
}

export interface PrinterConfig {
  paperFormat: string;
  printerName: string;
}

export interface ApiCredentials {
  username: string;
  password: string;
  ekp: string; // EKP number for Deutsche Post
}

export interface AppConfig {
  apiCredentials: ApiCredentials;
  printerConfig: PrinterConfig;
  senderAddress: SenderAddress;
}

export const SHIPPING_PRODUCTS: ShippingProduct[] = [
  // Domestic
  { id: 'brief-standard', name: 'Brief Standard', description: 'Up to 20g', price: '0.85€', type: 'domestic' },
  { id: 'brief-kompakt', name: 'Brief Kompakt', description: 'Up to 50g', price: '1.00€', type: 'domestic' },
  { id: 'brief-gross', name: 'Großbrief', description: 'Up to 500g', price: '1.60€', type: 'domestic' },
  { id: 'brief-maxi', name: 'Maxibrief', description: 'Up to 1000g', price: '2.75€', type: 'domestic' },
  { id: 'paket-s', name: 'Päckchen S', description: 'Up to 2kg', price: '3.99€', type: 'domestic' },
  { id: 'paket-m', name: 'Päckchen M', description: 'Up to 2kg', price: '4.79€', type: 'domestic' },
  { id: 'paket', name: 'Paket', description: 'Up to 31.5kg', price: '6.99€', type: 'domestic' },
  
  // International
  { id: 'int-brief-standard', name: 'Brief International', description: 'Up to 20g', price: '1.10€', type: 'international' },
  { id: 'int-brief-kompakt', name: 'Kompaktbrief Int.', description: 'Up to 50g', price: '1.70€', type: 'international' },
  { id: 'int-brief-gross', name: 'Großbrief Int.', description: 'Up to 500g', price: '3.70€', type: 'international' },
  { id: 'int-paket-xs', name: 'Päckchen XS Int.', description: 'Up to 500g', price: '4.89€', type: 'international' },
  { id: 'int-paket-s', name: 'Päckchen S Int.', description: 'Up to 2kg', price: '9.49€', type: 'international' },
  { id: 'int-paket-m', name: 'Päckchen M Int.', description: 'Up to 2kg', price: '17.49€', type: 'international' },
  { id: 'int-paket-l', name: 'Paket Int. L', description: 'Up to 5kg', price: '18.99€', type: 'international' },
];

export const PAPER_FORMATS = [
  { id: 'a4', name: 'A4 (210 × 297 mm)' },
  { id: 'a6', name: 'A6 (105 × 148 mm)' },
  { id: '4x6', name: '4" × 6" (102 × 152 mm)' },
  { id: 'label-103x199', name: 'Label 103 × 199 mm' },
];
