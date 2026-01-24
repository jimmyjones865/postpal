import { useState } from 'react';
import { History, Printer, Trash2, RefreshCw, Calendar, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { StoredLabel, printLabel, getLabelPdfUrl, PrintOptions } from '@/lib/labelStorage';
import { formatDistanceToNow } from 'date-fns';

interface LabelHistoryProps {
  labels: StoredLabel[];
  isLoading: boolean;
  error: string | null;
  onRefresh: () => void;
  onDelete: (id: string) => Promise<void>;
  printOptions?: PrintOptions;
  directPrintConfig?: {
    cupsUrl: string;
    printerName: string;
    orientation: 'portrait' | 'landscape';
    paperFormatName: string;
    enableDirectPrint: boolean;
    disableCropping?: boolean;
    // Explicit paper settings
    paperWidthMm?: number;
    paperHeightMm?: number;
    endlessRoll?: boolean;
  };
}

export function LabelHistory({ labels, isLoading, error, onRefresh, onDelete, printOptions, directPrintConfig }: LabelHistoryProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [printingId, setPrintingId] = useState<string | null>(null);

  const handlePrint = async (label: StoredLabel) => {
    setPrintingId(label.id);
    try {
      if (directPrintConfig?.enableDirectPrint && directPrintConfig.cupsUrl) {
        // Direct print via CUPS
        const API_BASE = '/api';
        const response = await fetch(`${API_BASE}/print`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            labelId: label.id,
            cupsUrl: directPrintConfig.cupsUrl,
            printerName: directPrintConfig.printerName,
            orientation: directPrintConfig.orientation,
            cropH: printOptions?.cropH ?? 5,
            cropV: printOptions?.cropV ?? 5,
            disableCropping: directPrintConfig.disableCropping || false,
            // Explicit paper settings
            paperWidthMm: directPrintConfig.paperWidthMm ?? 62,
            paperHeightMm: directPrintConfig.paperHeightMm ?? 100,
            endlessRoll: directPrintConfig.endlessRoll ?? true,
          })
        });
        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || 'Print failed');
        }
      } else {
        await printLabel(label.id, printOptions);
      }
    } finally {
      setPrintingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await onDelete(id);
    } finally {
      setDeletingId(null);
    }
  };

  const handleDownload = async (label: StoredLabel) => {
    const url = await getLabelPdfUrl(label.id);
    const a = document.createElement('a');
    a.href = url;
    a.download = label.filename;
    a.click();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground">
        <RefreshCw className="w-4 h-4 animate-spin mr-2" />
        Loading history...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-muted-foreground gap-2">
        <p>{error}</p>
        <Button variant="outline" size="sm" onClick={onRefresh}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Retry
        </Button>
      </div>
    );
  }

  if (labels.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-muted-foreground gap-2">
        <History className="w-8 h-8 opacity-50" />
        <p>No labels printed yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{labels.length} labels</span>
        <Button variant="ghost" size="sm" onClick={onRefresh}>
          <RefreshCw className="w-3 h-3" />
        </Button>
      </div>
      
      <ScrollArea className="h-[400px]">
        <div className="space-y-2 pr-4">
          {labels.map((label) => (
            <div
              key={label.id}
              className="bg-muted/50 border border-border rounded-lg p-3 space-y-2"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                    <Package className="w-3 h-3" />
                    <span className="font-medium">{label.productName}</span>
                  </div>
                  <pre className="text-xs whitespace-pre-wrap font-mono leading-relaxed overflow-hidden text-ellipsis">
                    {label.recipientAddress.split('\n').slice(0, 3).join('\n')}
                    {label.recipientAddress.split('\n').length > 3 && '...'}
                  </pre>
                </div>
              </div>
              
              <div className="flex items-center justify-between text-xs text-muted-foreground pt-1 border-t border-border/50">
                <div className="flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  {formatDistanceToNow(new Date(label.createdAt), { addSuffix: true })}
                </div>
                
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2"
                    onClick={() => handleDownload(label)}
                  >
                    Download
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2"
                    onClick={() => handlePrint(label)}
                    disabled={printingId === label.id}
                  >
                    <Printer className="w-3 h-3 mr-1" />
                    Print
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-destructive hover:text-destructive"
                    onClick={() => handleDelete(label.id)}
                    disabled={deletingId === label.id}
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
