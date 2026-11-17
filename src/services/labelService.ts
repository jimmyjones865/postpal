import { PrinterConfig } from '@/types/shipping';
import { ParsedAddress } from '@/lib/address';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

export interface StoredLabel {
  id: string;
  filename: string;
  recipientAddress: string;
  productCode: string;
  productName: string;
  voucherId?: string;
  trackId?: string;
  createdAt: string;
  refund?: { shopRetoureId: string; retoureTransactionId: string; requestedAt: string };
}

interface DhlAddress {
  name: string;
  additionalName?: string;
  addressLine1: string;
  addressLine2?: string;
  postalCode: string;
  city: string;
  country: string;
}

export interface PurchaseParams {
  sender: DhlAddress;
  receiver: DhlAddress;
  productCode: string;
  productName: string;
  priceInCents: number;
  pageFormatId: number;
  recipientAddress: string;
}

export interface PurchaseResult {
  success: boolean;
  label?: StoredLabel;
  /** Set on failure after DHL already charged — the label must not be re-bought */
  paid?: boolean;
  /** May be charged; retrieve by shopOrderId before buying again */
  uncertain?: boolean;
  /** Not bought at DHL (retrieve found no order) */
  notFound?: boolean;
  shopOrderId?: string;
  newBalance?: number;
  error?: string;
  details?: string;
}

async function postLabel(path: string, body: unknown): Promise<PurchaseResult> {
  const response = await fetch(`${API_BASE}/labels/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data.success) {
    return {
      success: false,
      error: data.error || `Request failed: HTTP ${response.status}`,
      details: data.details,
      paid: data.paid,
      uncertain: data.uncertain,
      notFound: data.notFound,
      shopOrderId: data.shopOrderId,
      newBalance: data.newBalance
    };
  }
  return { success: true, label: data.label, newBalance: data.newBalance };
}

/**
 * Purchases a label; the server downloads and stores the PDF before responding.
 */
export function purchaseLabel(params: PurchaseParams): Promise<PurchaseResult> {
  return postLabel('purchase', params);
}

/** Fetches and stores the label of an earlier checkout whose outcome was unclear. */
export function recoverLabel(params: { shopOrderId: string; productCode: string; productName: string; recipientAddress: string }): Promise<PurchaseResult> {
  return postLabel('recover', params);
}

export async function getLabels(): Promise<StoredLabel[]> {
  const response = await fetch(`${API_BASE}/labels`);
  if (!response.ok) {
    throw new Error('Failed to fetch labels');
  }
  return response.json();
}

export async function deleteLabel(id: string): Promise<void> {
  const response = await fetch(`${API_BASE}/labels/${id}`, { method: 'DELETE' });
  if (!response.ok) {
    throw new Error('Failed to delete label');
  }
}

export async function refundLabel(id: string): Promise<StoredLabel> {
  const response = await fetch(`${API_BASE}/labels/${id}/refund`, { method: 'POST' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.details || data.error || 'Refund failed');
  }
  return data.label;
}

/** @returns new balance in cents, null when DHL didn't report it */
export async function chargeWallet(amountCents: number): Promise<number | null> {
  const response = await fetch(`${API_BASE}/wallet/charge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amountCents })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'Top-up failed');
  }
  return data.balance;
}

/** Original, uncropped PDF. */
export function getLabelPdfUrl(id: string): string {
  return `${API_BASE}/labels/${id}/pdf`;
}

function getCroppedPdfUrl(id: string, config: PrinterConfig): string {
  const { cropMarginTop, cropMarginRight, cropMarginBottom, cropMarginLeft } = config;
  return `${API_BASE}/labels/${id}/pdf?print=1&cropTop=${cropMarginTop}&cropRight=${cropMarginRight}&cropBottom=${cropMarginBottom}&cropLeft=${cropMarginLeft}`;
}

/**
 * Prints a stored label: direct to CUPS if configured, otherwise via the browser print dialog.
 *
 * @throws Error if the CUPS print job fails
 */
export async function printLabel(labelId: string, config: PrinterConfig): Promise<void> {
  if (!config.enableDirectPrint || !config.cupsUrl) {
    const printWindow = window.open(getCroppedPdfUrl(labelId, config), '_blank');
    printWindow?.addEventListener('load', () => printWindow.print());
    return;
  }

  const response = await fetch(`${API_BASE}/print`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      labelId,
      cupsUrl: config.cupsUrl,
      printerName: config.printerName,
      orientation: config.orientation,
      cropTop: config.cropMarginTop,
      cropRight: config.cropMarginRight,
      cropBottom: config.cropMarginBottom,
      cropLeft: config.cropMarginLeft,
      disableCropping: config.disableCropping,
      paperWidthMm: config.paperWidthMm,
      paperHeightMm: config.paperHeightMm,
      endlessRoll: config.endlessRoll
    })
  });
  const result = await response.json().catch(() => ({}));

  if (!response.ok || !result.success) {
    throw new Error(result.error || 'Print failed');
  }
}

/**
 * Downloads the cropped label PDF.
 */
export async function downloadLabel(labelId: string, config: PrinterConfig): Promise<void> {
  const response = await fetch(getCroppedPdfUrl(labelId, config));
  if (!response.ok) {
    throw new Error('Download failed');
  }

  const url = URL.createObjectURL(await response.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = `label-${labelId}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function parseAddress(address: string): Promise<ParsedAddress> {
  const response = await fetch(`${API_BASE}/parse-address`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address }),
  });
  if (!response.ok) {
    throw new Error('Failed to parse address');
  }
  return response.json();
}

/**
 * Fetches the Portokasse balance in cents (forces a token refresh server-side).
 */
export async function getWalletBalance(): Promise<number | null> {
  const response = await fetch(`${API_BASE}/wallet/balance`, { method: 'POST' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return data.balance ?? null;
}
