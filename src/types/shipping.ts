export interface ShippingProduct {
  code: string;
  name: string;
  cost: number;
  domestic: boolean;
  maxWeight: number; // in grams
  group: 'standard' | 'kompakt' | 'gross' | 'maxi';
  tracked?: boolean;
}

export interface ShippingAddon {
  id: string;
  name: string;
  price: string;
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
  paperFormatName: string; // selection from paper formats file
  orientation: 'portrait' | 'landscape';
  cropMarginHorizontal: number; // in mm
  cropMarginVertical: number;   // in mm
}

export interface ApiCredentials {
  apiKey: string;
  apiSecret: string;
  portokasseLogin: string;
  portokassePassword: string;
}

export interface AppConfig {
  apiCredentials: ApiCredentials;
  printerConfig: PrinterConfig;
  senderAddress: SenderAddress;
  favoriteProducts: string[];
}

export const PAPER_FORMATS = [
  { id: 'a4', name: 'A4 (210 × 297 mm)' },
  { id: 'a6', name: 'A6 (105 × 148 mm)' },
  { id: '4x6', name: '4" × 6" (102 × 152 mm)' },
  { id: 'label-103x199', name: 'Label 103 × 199 mm' },
];
