export interface StoredLabel {
  id: string;
  filename: string;
  recipientAddress: string;
  productCode: string;
  productName: string;
  voucherId?: string;
  trackId?: string;
  createdAt: string;
}

const API_BASE = import.meta.env.VITE_API_URL || '/api';

export async function saveLabel(data: {
  pdfBase64: string;
  recipientAddress: string;
  productCode: string;
  productName: string;
  voucherId?: string;
  trackId?: string;
}): Promise<StoredLabel> {
  const response = await fetch(`${API_BASE}/labels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  
  if (!response.ok) {
    throw new Error('Failed to save label');
  }
  
  const result = await response.json();
  return result.label;
}

export async function getLabels(): Promise<StoredLabel[]> {
  const response = await fetch(`${API_BASE}/labels`);
  
  if (!response.ok) {
    throw new Error('Failed to fetch labels');
  }
  
  return response.json();
}

export function getLabelPdfUrl(id: string): string {
  return `${API_BASE}/labels/${id}/pdf`;
}

interface PrintOptions {
  cropTop?: number;
  cropRight?: number;
  cropBottom?: number;
  cropLeft?: number;
}

function getLabelPdfUrlForPrint(id: string, options?: PrintOptions): string {
  const cropTop = options?.cropTop ?? 5;
  const cropRight = options?.cropRight ?? 5;
  const cropBottom = options?.cropBottom ?? 5;
  const cropLeft = options?.cropLeft ?? 5;
  return `${API_BASE}/labels/${id}/pdf?print=1&cropTop=${cropTop}&cropRight=${cropRight}&cropBottom=${cropBottom}&cropLeft=${cropLeft}`;
}

export async function deleteLabel(id: string): Promise<void> {
  const response = await fetch(`${API_BASE}/labels/${id}`, {
    method: 'DELETE',
  });
  
  if (!response.ok) {
    throw new Error('Failed to delete label');
  }
}

export async function printLabel(id: string, options?: PrintOptions): Promise<void> {
  const url = getLabelPdfUrlForPrint(id, options);
  
  // Open PDF in new window for printing
  const printWindow = window.open(url, '_blank');
  if (printWindow) {
    printWindow.addEventListener('load', () => {
      printWindow.print();
    });
  }
}
