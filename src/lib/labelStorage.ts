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

export async function getLabelPdfUrl(id: string): Promise<string> {
  // Returns original PDF URL (no cropping)
  return `${API_BASE}/labels/${id}/pdf`;
}

export interface PrintOptions {
  cropH?: number;
  cropV?: number;
}

export async function getLabelPdfUrlForPrint(id: string, options?: PrintOptions): Promise<string> {
  // Returns cropped PDF URL for printing
  const cropH = options?.cropH ?? 5;
  const cropV = options?.cropV ?? 5;
  return `${API_BASE}/labels/${id}/pdf?print=1&cropH=${cropH}&cropV=${cropV}`;
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
  const url = await getLabelPdfUrlForPrint(id, options);
  
  // Open PDF in new window for printing
  const printWindow = window.open(url, '_blank');
  if (printWindow) {
    printWindow.addEventListener('load', () => {
      printWindow.print();
    });
  }
}
