import { DirectPrintConfig } from '@/lib/printConfig';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

/**
 * Result of a label purchase operation.
 */
export interface PurchaseResult {
  success: boolean;
  pdfUrl?: string;
  trackingNumber?: string;
  voucherId?: string;
  newBalance?: number;
  error?: string;
  details?: string;
}

/**
 * Parameters for purchasing a label.
 */
export interface PurchaseParams {
  sender: {
    name: string;
    additionalName?: string;
    addressLine1: string;
    postalCode: string;
    city: string;
    country: string;
  };
  receiver: {
    name: string;
    additionalName?: string;
    addressLine1: string;
    addressLine2?: string;
    postalCode: string;
    city: string;
    country: string;
  };
  productCode: string;
  priceInCents: number;
  paperFormatName: string;
}

/**
 * Purchases a shipping label from the API.
 * 
 * @param params - Purchase parameters
 * @returns Purchase result
 */
export async function purchaseLabel(params: PurchaseParams): Promise<PurchaseResult> {
  const response = await fetch(`${API_BASE}/labels/purchase`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  });
  
  const data = await response.json();
  
  if (!response.ok || !data.success) {
    return { 
      success: false, 
      error: data.error || 'Purchase failed',
      details: data.details 
    };
  }
  
  return {
    success: true,
    pdfUrl: data.pdfUrl,
    trackingNumber: data.trackingNumber,
    voucherId: data.voucherId,
    newBalance: data.newBalance
  };
}

/**
 * Fetches a PDF via proxy and returns as base64.
 * 
 * @param pdfUrl - Original DHL PDF URL
 * @returns Base64-encoded PDF content
 */
export async function fetchPdfAsBase64(pdfUrl: string): Promise<string> {
  const proxyUrl = `${API_BASE}/proxy-pdf?url=${encodeURIComponent(pdfUrl)}`;
  const response = await fetch(proxyUrl);
  
  if (!response.ok) {
    throw new Error(`PDF fetch failed: ${response.status}`);
  }
  
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = (reader.result as string).split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Parameters for direct printing.
 */
export interface PrintParams {
  labelId: string;
  cupsUrl: string;
  printerName: string;
  orientation: 'portrait' | 'landscape';
  cropH: number;
  cropV: number;
  disableCropping: boolean;
  paperWidthMm: number;
  paperHeightMm: number;
  endlessRoll: boolean;
}

/**
 * Sends a label to a CUPS printer.
 * 
 * @param params - Print parameters
 * @throws Error if print fails
 */
export async function printLabelDirect(params: PrintParams): Promise<void> {
  const response = await fetch(`${API_BASE}/print`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  });
  
  const result = await response.json();
  
  if (!response.ok || !result.success) {
    throw new Error(result.error || 'Print failed');
  }
}

/**
 * Builds print parameters from config.
 * 
 * @param labelId - Label ID to print
 * @param config - Direct print configuration
 * @param cropH - Horizontal crop margin in mm
 * @param cropV - Vertical crop margin in mm
 * @returns Print parameters
 */
export function buildPrintParams(
  labelId: string, 
  config: DirectPrintConfig,
  cropH: number,
  cropV: number
): PrintParams {
  return {
    labelId,
    cupsUrl: config.cupsUrl,
    printerName: config.printerName,
    orientation: config.orientation,
    cropH,
    cropV,
    disableCropping: config.disableCropping,
    paperWidthMm: config.paperWidthMm,
    paperHeightMm: config.paperHeightMm,
    endlessRoll: config.endlessRoll
  };
}

/**
 * Downloads a cropped label PDF.
 * 
 * @param labelId - Label ID
 * @param cropH - Horizontal crop margin in mm
 * @param cropV - Vertical crop margin in mm
 */
export async function downloadLabel(labelId: string, cropH: number, cropV: number): Promise<void> {
  const pdfUrl = `${API_BASE}/labels/${labelId}/pdf?print=1&cropH=${cropH}&cropV=${cropV}`;
  const response = await fetch(pdfUrl);
  
  if (!response.ok) {
    throw new Error('Download failed');
  }
  
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `label-${labelId}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}
