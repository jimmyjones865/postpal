import { useState } from 'react';
import { History, Printer, Trash2, RefreshCw, Calendar, Package, Copy, ExternalLink, Undo2 } from 'lucide-react';
import { copyToClipboard } from '@/lib/clipboard';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { StoredLabel, printLabel, getLabelPdfUrl } from '@/services/labelService';
import { PrinterConfig } from '@/types/shipping';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';
import { language } from '@/lib/i18n';

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [['year', 31_536_000], ['month', 2_592_000], ['day', 86_400], ['hour', 3600], ['minute', 60]];
function timeAgo(iso: string) {
  const s = (Date.parse(iso) - Date.now()) / 1000;
  const [unit, sec] = UNITS.find(([, sec]) => Math.abs(s) >= sec) ?? ['second', 1];
  return new Intl.RelativeTimeFormat(language, { numeric: 'auto' }).format(Math.round(s / sec), unit);
}

interface LabelHistoryProps {
  labels: StoredLabel[];
  isLoading: boolean;
  error: string | null;
  onRefresh: () => void;
  onDelete: (id: string) => Promise<void>;
  onRefund: (id: string) => Promise<void>;
  printerConfig: PrinterConfig;
  trackedCodes: Set<string>;
}

export function LabelHistory({ labels, isLoading, error, onRefresh, onDelete, onRefund, printerConfig, trackedCodes }: LabelHistoryProps) {
  const { t } = useTranslation();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [printingId, setPrintingId] = useState<string | null>(null);
  const [refundingId, setRefundingId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'refund' | 'delete'; label: StoredLabel } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handlePrint = async (label: StoredLabel) => {
    setPrintingId(label.id);
    try {
      await printLabel(label.id, printerConfig);
    } catch (err) {
      toast.error(t('toast.printFailed'), { description: err instanceof Error ? err.message : t('toast.printFailedDesc') });
    } finally {
      setPrintingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    setConfirm(null);
    setDeletingId(id);
    try {
      await onDelete(id);
    } catch {
      toast.error(t('toast.deleteFailed'));
    } finally {
      setDeletingId(null);
    }
  };

  const handleRefund = async (label: StoredLabel) => {
    setConfirm(null);
    setRefundingId(label.id);
    try {
      await onRefund(label.id);
      toast.success(t('toast.refundRequested'));
    } catch (err) {
      toast.error(t('toast.refundFailed'), { description: err instanceof Error ? err.message : undefined });
    } finally {
      setRefundingId(null);
    }
  };

  const handleDownload = (label: StoredLabel) => {
    const url = getLabelPdfUrl(label.id);
    const a = document.createElement('a');
    a.href = url;
    a.download = label.filename;
    a.click();
  };

  const handleCopyId = async (id: string, labelId: string) => {
    const success = await copyToClipboard(id);
    if (success) {
      setCopiedId(labelId);
      toast.success(t('toast.copiedToClipboard'));
      setTimeout(() => setCopiedId(null), 300);
    } else {
      toast.error(t('toast.copyFailed'));
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground">
        <RefreshCw className="w-4 h-4 animate-spin mr-2" />
        {t('history.loadingHistory')}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-muted-foreground gap-2">
        <p>{error}</p>
        <Button variant="outline" size="sm" onClick={onRefresh}>
          <RefreshCw className="w-4 h-4 mr-2" />
          {t('history.retry')}
        </Button>
      </div>
    );
  }

  if (labels.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-muted-foreground gap-2">
        <History className="w-8 h-8 opacity-50" />
        <p>{t('history.noLabels')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{t('history.labels', { count: labels.length })}</span>
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
                    {label.refund && <span className="text-accent-foreground">· {t('history.refundRequested')}</span>}
                  </div>
                  <pre className="text-xs whitespace-pre-wrap font-mono leading-relaxed">
                    {label.recipientAddress.trim()}
                  </pre>
                </div>
              </div>
              
              <div className="flex items-center justify-between text-xs text-muted-foreground pt-1 border-t border-border/50">
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    {timeAgo(label.createdAt)}
                  </div>
                  {(label.trackId || label.voucherId) && (
                    <div className="flex items-center gap-1">
                      <button 
                        type="button"
                        onClick={() => handleCopyId(label.trackId || label.voucherId!, label.id)}
                        className={cn(
                          "font-mono hover:bg-muted px-1 rounded flex items-center gap-1 max-w-[220px]",
                          copiedId === label.id && "animate-flash"
                        )}
                        title="Click to copy ID"
                      >
                        <span className="truncate">
                          {label.trackId || label.voucherId}
                        </span>
                        <Copy className="w-3 h-3 flex-shrink-0" />
                      </button>
                      {(label.trackId || (label.voucherId && trackedCodes.has(label.productCode))) && (
                        <a
                          href={label.provider === 'dhl-paket'
                            ? `https://www.dhl.de/de/privatkunden/pakete-empfangen/verfolgen.html?piececode=${label.trackId}`
                            : `https://www.deutschepost.de/en/s/shipment-tracking.html?piececode=${label.trackId || label.voucherId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:text-primary"
                          title="Track shipment"
                        >
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  )}
                </div>
                
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2"
                    onClick={() => handleDownload(label)}
                  >
                    {t('print.download')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2"
                    onClick={() => handlePrint(label)}
                    disabled={printingId === label.id}
                  >
                    <Printer className="w-3 h-3 mr-1" />
                    {t('print.print')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2"
                    onClick={() => setConfirm({ kind: 'delete', label })}
                    disabled={deletingId === label.id}
                    title={t('history.delete')}
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                  {label.voucherId && !label.refund && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-destructive hover:text-destructive"
                      onClick={() => setConfirm({ kind: 'refund', label })}
                      disabled={refundingId === label.id}
                      title={t('history.refund')}
                    >
                      <Undo2 className="w-3 h-3" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
      <ConfirmDialog
        open={confirm !== null}
        destructive={confirm?.kind === 'refund'}
        title={t(confirm?.kind === 'delete' ? 'history.deleteTitle' : 'history.refundTitle')}
        description={confirm?.kind === 'delete'
          ? t('history.deleteConfirm')
          : t('history.refundConfirm', { id: confirm?.label.voucherId ?? '' })}
        confirmLabel={t(confirm?.kind === 'delete' ? 'history.delete' : 'history.refund')}
        cancelLabel={t('history.cancel')}
        onConfirm={() => {
          if (confirm?.kind === 'delete') handleDelete(confirm.label.id);
          else if (confirm) handleRefund(confirm.label);
        }}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
