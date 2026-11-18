import { PrinterConfig } from '@/types/shipping';
import { ParsedAddress } from '@/lib/address';

const API_BASE = '/api';

export async function json<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error([data.error, data.details].filter(Boolean).join(' — ') || `HTTP ${response.status}`);
  return data as T;
}

export const post = (path: string, body?: unknown, init?: RequestInit) => fetch(`${API_BASE}${path}`, {
  method: 'POST',
  ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  ...init,
});

export interface StoredLabel {
  id: string;
  filename: string;
  recipientAddress: string;
  productCode: string;
  productName: string;
  voucherId?: string;
  trackId?: string;
  createdAt: string;
  provider?: 'dhl-paket';
  refund?: { shopRetoureId: string; retoureTransactionId: string; requestedAt: string };
}

interface DhlAddress {
  name: string;
  email?: string;
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
  const response = await post(`/labels/${path}`, body);
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
  return json(await fetch(`${API_BASE}/labels`));
}

export async function deleteLabel(id: string): Promise<void> {
  await json(await fetch(`${API_BASE}/labels/${id}`, { method: 'DELETE' }));
}

export async function refundLabel(id: string): Promise<StoredLabel> {
  return (await json<{ label: StoredLabel }>(await post(`/labels/${id}/refund`))).label;
}

/** @returns new balance in cents, null when DHL didn't report it */
export async function chargeWallet(amountCents: number): Promise<number | null> {
  return (await json<{ balance: number | null }>(await post('/wallet/charge', { amountCents }))).balance;
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
  return json(await post('/parse-address', { address }));
}

/** Portokasse balance in cents (forces a token refresh server-side). */
export async function getWalletBalance(): Promise<number | null> {
  return (await json<{ balance?: number | null }>(await post('/wallet/balance'))).balance ?? null;
}

export interface PaketProduct {
  productId: string;
  insurance: string | null;
  name: string;
  price: number;
}

/** null = DHL catalog unavailable */
export async function getPaketProducts(country: string): Promise<PaketProduct[] | null> {
  const response = await fetch(`${API_BASE}/paket/products?country=${encodeURIComponent(country)}`);
  if (response.status === 502) return null;
  return (await json<{ products: PaketProduct[] }>(response)).products;
}

export async function createPaketOrder(params: { productId: string; insurance: string | null; receiver: DhlAddress; recipientAddress: string }): Promise<{ payUrl: string }> {
  return json(await post('/paket/orders', params));
}

/** Warenkorb-Nr from DHL's thank-you page → label, when the confirmation mail doesn't come. */
export async function submitPaketCart(cartId: string): Promise<{ status: string; state?: string; orderId?: string; reason?: string; error?: string }> {
  return json(await post(`/paket/carts/${encodeURIComponent(cartId)}`));
}

export interface IntakeOrder {
  id: string;
  source: 'cm' | 'ui';
  at: string;
  status: string;
  buyer?: string;
  summary?: string;
  productName?: string;
  recipientAddress?: string;
  items: string[];
  note?: string;
  tracking: { id: string; url: string }[];
  payUrl?: string;
  price?: number | null;
  carts?: number;
}

export async function getIntake(): Promise<{ dryRun: boolean; orders: IntakeOrder[] }> {
  return json(await fetch(`${API_BASE}/intake`));
}
