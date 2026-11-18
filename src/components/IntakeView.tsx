import { useCallback, useEffect, useState } from 'react';
import { CreditCard, ExternalLink, Inbox, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { IntakeOrder, getIntake, submitPaketCart } from '@/services/labelService';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';

const REFRESH_MS = 30_000;

const STATUS_COLOR: Record<string, string> = {
  bought: 'text-[#a3be8c] border-[#a3be8c]/40',
  done: 'text-[#a3be8c] border-[#a3be8c]/40',
  'awaiting-pay': 'text-[#ebcb8b] border-[#ebcb8b]/40',
  failed: 'text-destructive border-destructive/40',
  error: 'text-destructive border-destructive/40',
  'check-manually': 'text-destructive border-destructive/40',
  skipped: 'text-muted-foreground border-border',
  'dry-run': 'text-primary border-primary/40',
};
// Everything else (uncertain, retry, queued, processing, …) = in progress
const statusColor = (s: string) => STATUS_COLOR[s] || 'text-[#ebcb8b] border-[#ebcb8b]/40';

const when = (iso: string) => new Date(iso).toLocaleString('de-DE', {
  timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
});

function OrderDetails({ order }: { order: IntakeOrder }) {
  if (!order.recipientAddress && !order.items.length) return null;
  return (
    <div className="mt-2 grid gap-2 sm:grid-cols-2 text-xs font-mono text-muted-foreground">
      {order.recipientAddress && <pre className="whitespace-pre-wrap">{order.recipientAddress}</pre>}
      {order.items.length > 0 && <pre className="whitespace-pre-wrap">{order.items.join('\n')}</pre>}
    </div>
  );
}

/** CM intake + Paket orders. Refreshes every 30 s while the tab is open (Radix unmounts inactive tabs). */
export function IntakeView() {
  const { t } = useTranslation();
  const [data, setData] = useState<{ dryRun: boolean; orders: IntakeOrder[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [cartId, setCartId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await getIntake());
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

  const submitCart = async () => {
    setSubmitting(true);
    try {
      const r = await submitPaketCart(cartId.trim());
      if (r.status === 'done') {
        toast.success(t('intake.cartDone'), { description: r.orderId });
        setCartId('');
      } else if (r.status === 'not-paid') {
        toast.error(t('intake.cartNotPaid'), { description: r.state });
      } else {
        toast.error(t('intake.cartFailed'), { description: [r.status, r.reason || r.error].filter(Boolean).join(' — ') });
      }
      load();
    } catch (err) {
      toast.error(t('intake.cartFailed'), { description: err instanceof Error ? err.message : undefined });
    } finally {
      setSubmitting(false);
    }
  };

  const toPay = data?.orders.filter(o => o.payUrl) ?? [];
  const recent = data?.orders.filter(o => !o.payUrl) ?? [];

  return (
    <div className="space-y-6">
      <div className="bg-card border border-border rounded-lg p-4">
        <div className="flex items-center gap-2 mb-4">
          <CreditCard className="w-4 h-4 text-primary" />
          <h2 className="font-semibold text-sm">{t('intake.toPay')} ({toPay.length})</h2>
          <Button variant="ghost" size="sm" className="h-7 px-2 ml-auto" onClick={load} disabled={loading} title={t('history.retry')}>
            <RefreshCw className={cn('w-3 h-3', loading && 'animate-spin')} />
          </Button>
        </div>
        {error && <p className="text-xs text-destructive mb-3">{error}</p>}
        {toPay.length === 0 && <p className="text-xs text-muted-foreground">{t('intake.nothingToPay')}</p>}
        <div className="space-y-3">
          {toPay.map(o => (
            <div key={o.id} className="border border-border rounded-md p-3">
              <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{o.summary || o.buyer || o.id}</div>
                  <div className="text-xs text-muted-foreground">
                    {when(o.at)} · {o.productName}{o.price != null && ` · ${o.price.toFixed(2)} €`}
                    {!!o.carts && ` · ${t('intake.cartsOpened', { count: o.carts })}`}
                  </div>
                </div>
                <Button asChild size="sm" className="h-9">
                  <a href={o.payUrl} target="_blank" rel="noopener noreferrer">
                    <CreditCard className="w-4 h-4 mr-2" />
                    {t('intake.pay')}
                  </a>
                </Button>
              </div>
              <OrderDetails order={o} />
            </div>
          ))}
        </div>
        <div className="mt-4 pt-4 border-t border-border">
          <p className="text-xs text-muted-foreground mb-2">{t('intake.cartHint')}</p>
          <div className="flex gap-2 max-w-sm">
            <Input
              value={cartId}
              onChange={e => setCartId(e.target.value.toUpperCase())}
              onKeyDown={e => { if (e.key === 'Enter' && cartId.trim().length === 12) submitCart(); }}
              placeholder="Warenkorb-Nr."
              maxLength={12}
              className="font-mono"
            />
            <Button variant="secondary" onClick={submitCart} disabled={submitting || cartId.trim().length !== 12}>
              {t('intake.fetchLabel')}
            </Button>
          </div>
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg p-4">
        <div className="flex items-center gap-2 mb-4">
          <Inbox className="w-4 h-4 text-primary" />
          <h2 className="font-semibold text-sm">{t('intake.recent')}</h2>
          {data && (
            <span className={cn('text-xs px-2 py-0.5 rounded border', data.dryRun ? statusColor('dry-run') : statusColor('bought'))}>
              {data.dryRun ? t('intake.dryRun') : t('intake.live')}
            </span>
          )}
        </div>
        {data && recent.length === 0 && <p className="text-xs text-muted-foreground">{t('intake.noOrders')}</p>}
        <div className="divide-y divide-border">
          {recent.map(o => (
            <details key={o.id} className="py-2 group">
              <summary className="flex flex-wrap items-center gap-x-3 gap-y-1 cursor-pointer list-none">
                <span className="text-xs text-muted-foreground font-mono whitespace-nowrap sm:w-24 shrink-0">{when(o.at)}</span>
                <span className={cn('text-xs px-2 py-0.5 rounded border font-mono', statusColor(o.status))}>{o.status}</span>
                <span className="text-sm min-w-0 basis-full sm:basis-auto sm:flex-1 order-last sm:order-none">{o.summary || o.buyer || o.id}</span>
                {o.tracking.map(tr => (
                  <a key={tr.id} href={tr.url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
                    className="text-xs font-mono text-muted-foreground hover:text-primary flex items-center gap-1">
                    {tr.id}
                    <ExternalLink className="w-3 h-3" />
                  </a>
                ))}
              </summary>
              <div className="pl-0 sm:pl-[6.75rem] mt-1 text-xs text-muted-foreground">
                {[o.source === 'cm' ? `CM ${o.id}` : o.id, o.productName, o.note].filter(Boolean).join(' · ')}
              </div>
              <div className="sm:pl-[6.75rem]">
                <OrderDetails order={o} />
              </div>
            </details>
          ))}
        </div>
      </div>
    </div>
  );
}
