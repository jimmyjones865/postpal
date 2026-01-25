import { useState } from 'react';
import { Download, Printer, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ParsedAddress } from '@/lib/address';
import { PrintOptions, DirectPrintConfig } from '@/lib/printConfig';
import { printLabelDirect, buildPrintParams, downloadLabel } from '@/services/labelService';
import { printLabel } from '@/lib/labelStorage';
import { cn } from '@/lib/utils';

interface LabelResultProps {
  parsedRecipient: ParsedAddress;
  purchasedLabelId: string | null;
  voucherId: string | null;
  trackId: string | null;
  paperFormat: { widthMm: number; heightMm: number } | null;
  printOptions: PrintOptions;
  directPrintConfig: DirectPrintConfig;
}

/**
 * Formats the parsed recipient address for display.
 */
function formatRecipientForDisplay(parsed: ParsedAddress): string {
  const lines: string[] = [];
  
  if (parsed.additionalName) lines.push(parsed.additionalName);
  if (parsed.name) lines.push(parsed.name);
  if (parsed.street) lines.push(parsed.street);
  if (parsed.addressLine2) lines.push(parsed.addressLine2);
  if (parsed.zip || parsed.city) {
    lines.push(`${parsed.zip} ${parsed.city}`.trim());
  }
  // Only show country if not Germany
  const country = parsed.country;
  if (country && country !== 'Deutschland' && country !== 'Germany' && country !== 'DE') {
    lines.push(country);
  }
  
  return lines.join('\n');
}

/**
 * Computes preview container style for landscape orientation (longer axis horizontal).
 */
function computePreviewStyle(format: { widthMm: number; heightMm: number } | null): React.CSSProperties {
  if (!format) return { height: '120px' };
  
  // Display with longer axis horizontal
  const isLandscape = format.widthMm >= format.heightMm;
  const aspectRatio = isLandscape 
    ? format.widthMm / format.heightMm 
    : format.heightMm / format.widthMm;
  
  return { aspectRatio: String(aspectRatio) };
}

const API_BASE = import.meta.env.VITE_API_URL || '/api';

export function LabelResult({
  parsedRecipient,
  purchasedLabelId,
  voucherId,
  trackId,
  paperFormat,
  printOptions,
  directPrintConfig
}: LabelResultProps) {
  const [isPrinting, setIsPrinting] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [copied, setCopied] = useState(false);

  const formattedAddress = formatRecipientForDisplay(parsedRecipient);
  const hasAddress = formattedAddress.trim().length > 0;
  
  // PDF embed URL (only when purchased) - with params to hide toolbar
  const pdfUrl = purchasedLabelId 
    ? `${API_BASE}/labels/${purchasedLabelId}/pdf#toolbar=0&navpanes=0&scrollbar=0&view=Fit` 
    : null;
  
  // Display ID (trackId preferred, else voucherId)
  const displayId = trackId || voucherId;
  
  // Compute landscape dimensions for preview
  const previewStyle = computePreviewStyle(paperFormat);

  const handleDownload = async () => {
    if (!purchasedLabelId) return;
    setIsDownloading(true);
    try {
      await downloadLabel(purchasedLabelId, printOptions.cropH ?? 5, printOptions.cropV ?? 5);
    } finally {
      setIsDownloading(false);
    }
  };

  const handlePrint = async () => {
    if (!purchasedLabelId) return;
    setIsPrinting(true);
    try {
      if (directPrintConfig.enableDirectPrint && directPrintConfig.cupsUrl) {
        const params = buildPrintParams(
          purchasedLabelId,
          directPrintConfig,
          printOptions.cropH ?? 5,
          printOptions.cropV ?? 5
        );
        await printLabelDirect(params);
      } else {
        await printLabel(purchasedLabelId, printOptions);
      }
    } finally {
      setIsPrinting(false);
    }
  };

  const handleCopyId = async () => {
    if (!displayId) return;
    try {
      await navigator.clipboard.writeText(displayId);
      setCopied(true);
      setTimeout(() => setCopied(false), 300);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <div className="space-y-3">
      {/* Section 1: Parsed recipient address */}
      <div className="bg-card border border-border rounded-lg p-3">
        <div className="text-xs text-muted-foreground mb-1">Recipient</div>
        <pre className="font-mono text-sm whitespace-pre-wrap leading-relaxed min-h-[80px]">
          {hasAddress ? formattedAddress : 'Enter address to preview'}
        </pre>
      </div>

      {/* Section 2: Purchased label PDF */}
      <div className="bg-card border border-border rounded-lg p-3">
        <div className="text-xs text-muted-foreground mb-2">Purchased Label</div>
        {pdfUrl ? (
          <iframe 
            src={pdfUrl}
            className="w-full rounded border border-border bg-white"
            style={previewStyle}
            title="Purchased Label PDF"
          />
        ) : (
          <div 
            className="flex items-center justify-center text-muted-foreground text-sm border border-dashed border-border/50 rounded bg-muted/20"
            style={previewStyle}
          >
            Label appears after purchase
          </div>
        )}
      </div>

      {/* Section 3: Action buttons */}
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          disabled={!purchasedLabelId || isDownloading}
          onClick={handleDownload}
        >
          <Download className="w-4 h-4 mr-1" />
          {isDownloading ? 'Downloading...' : 'Download'}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          disabled={!purchasedLabelId || isPrinting}
          onClick={handlePrint}
        >
          <Printer className="w-4 h-4 mr-1" />
          {isPrinting ? 'Printing...' : 'Print'}
        </Button>
      </div>

      {/* Section 4: Voucher/Track ID */}
      <button
        onClick={handleCopyId}
        disabled={!displayId}
        className={cn(
          "w-full flex items-center justify-between px-3 py-2 rounded-md border transition-all",
          "font-mono text-sm",
          displayId 
            ? "bg-muted/50 border-border hover:bg-muted cursor-pointer" 
            : "bg-muted/20 border-dashed border-border/50 cursor-default text-muted-foreground",
          copied && "animate-flash"
        )}
      >
        <span className="text-xs text-muted-foreground mr-2">ID:</span>
        <span className="truncate flex-1 text-left">
          {displayId || 'After purchase'}
        </span>
        {displayId && <Copy className="w-4 h-4 ml-2 flex-shrink-0 text-muted-foreground" />}
      </button>
    </div>
  );
}
