import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, CreditCard, ExternalLink, Mail, Package, RefreshCw, Truck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { TrackedShipment, getTracked, markTrackedDone } from '@/services/labelService';
import { copyToClipboard } from '@/lib/clipboard';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';

const REFRESH_MS = 30_000;

const when = (iso: string) => new Date(iso).toLocaleString('de-DE', {
  timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
});

/** Tracked shipments until marked done: CM tracked letters + Paket orders. Refreshes every 30 s while open. */
export function TrackedView() {
  const { t } = useTranslation();
  const [shipments, setShipments] = useState<TrackedShipment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setShipments((await getTracked()).shipments);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const copy = async (id: string) => {
    if (await copyToClipboard(id)) {
      setCopiedId(id);
      toast.success(t('toast.copiedToClipboard'), { description: id });
      setTimeout(() => setCopiedId(null), 300);
    } else {
      toast.error(t('toast.copyFailed'));
    }
  };

  const done = async (key: string) => {
    try {
      await markTrackedDone(key);
      setShipments(s => s?.filter(x => x.key !== key) ?? null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const toPay = shipments?.filter(s => s.payUrl).length ?? 0;

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center gap-2 mb-4">
        <Truck className="w-4 h-4 text-primary" />
        <h2 className="font-semibold text-sm">{t('tracked.title')}{shipments && ` (${shipments.length})`}</h2>
        {toPay > 1 && (
          <Button asChild size="sm" className="h-8 ml-auto">
            <a href="/api/paket/pay-all" target="_blank" rel="noopener noreferrer">
              {t('intake.payAll', { count: toPay })}
            </a>
          </Button>
        )}
        <Button variant="ghost" size="sm" className={cn('h-7 px-2', toPay <= 1 && 'ml-auto')} onClick={load} disabled={loading} title={t('history.retry')}>
          <RefreshCw className={cn('w-3 h-3', loading && 'animate-spin')} />
        </Button>
      </div>
      {error && <p className="text-xs text-destructive mb-3">{error}</p>}
      {shipments?.length === 0 && <p className="text-xs text-muted-foreground">{t('tracked.none')}</p>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {shipments?.map(s => {
          const Icon = s.kind === 'parcel' ? Package : Mail;
          return (
            <div key={s.key} className="border border-border rounded-md p-3 flex flex-col gap-2">
              <div className="flex items-start gap-2">
                <Icon className="w-4 h-4 mt-0.5 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">
                    {s.flag && <span className="mr-1.5">{s.flag}</span>}
                    {s.buyer || s.recipient || s.key}
                  </div>
                  {s.buyer && s.recipient && <div className="text-sm truncate">{s.recipient}</div>}
                  <div className="text-xs text-muted-foreground">
                    {t(s.kind === 'parcel' ? 'tracked.parcel' : 'tracked.letter')} · {when(s.at)}
                    {s.productName && ` · ${s.productName}`}
                  </div>
                </div>
              </div>

              {s.tracking.map(tr => (
                <div key={tr.id} className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => copy(tr.id)}
                    className={cn(
                      'flex-1 min-w-0 flex items-center justify-between px-3 py-2 rounded-md border font-mono text-sm',
                      'bg-muted/50 border-border hover:bg-muted transition-all',
                      copiedId === tr.id && 'animate-flash',
                    )}
                  >
                    <span className="truncate">{tr.id}</span>
                    <Copy className="w-4 h-4 ml-2 shrink-0 text-muted-foreground" />
                  </button>
                  <Button asChild variant="ghost" size="sm" className="h-auto px-2" title="Tracking">
                    <a href={tr.url} target="_blank" rel="noopener noreferrer"><ExternalLink className="w-4 h-4" /></a>
                  </Button>
                </div>
              ))}

              <div className="flex items-center gap-2 mt-auto">
                {s.payUrl ? (
                  <Button asChild size="sm" className="h-9 flex-1">
                    <a href={s.payUrl} target="_blank" rel="noopener noreferrer">
                      <CreditCard className="w-4 h-4 mr-2" />
                      {t('intake.pay')}
                    </a>
                  </Button>
                ) : (
                  <>
                    {!s.tracking.length && <span className="text-xs font-mono text-destructive">{s.status}</span>}
                    <Button variant="secondary" size="sm" className="h-9 ml-auto" onClick={() => done(s.key)}>
                      <Check className="w-4 h-4 mr-2" />
                      {t('tracked.done')}
                    </Button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
