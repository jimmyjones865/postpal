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
  printerName: string;
  paperFormatName: string; // display name for the UI dropdown
  paperFormatId: number;   // DHL API format ID, used in purchase calls
  orientation: 'portrait' | 'landscape';
  // 4-direction independent crop margins (in mm)
  cropMarginTop: number;
  cropMarginRight: number;
  cropMarginBottom: number;
  cropMarginLeft: number;
  disableCropping: boolean; // Skip PDF cropping entirely
  cupsUrl: string; // CUPS server URL (e.g., http://192.168.1.100:631)
  enableDirectPrint: boolean; // Enable direct IPP printing vs download
  // Explicit paper settings
  paperWidthMm: number;   // Paper width in mm
  paperHeightMm: number;  // Paper height in mm (used when endlessRoll=false)
  endlessRoll: boolean;   // Height from content (true) or fixed (false)
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

