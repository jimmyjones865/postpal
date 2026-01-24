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

