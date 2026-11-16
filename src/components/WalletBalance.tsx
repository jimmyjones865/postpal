import { useState, useCallback, useEffect } from 'react';
import { Wallet, RefreshCw, AlertCircle, Plus, Check } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';
import { getWalletBalance, chargeWallet } from '@/services/labelService';

interface WalletBalanceProps {
  balance: number | null;
  onBalanceChange: (balance: number | null) => void;
  /** Server-side DHL credentials present; null while unknown */
  isConfigured: boolean | null;
}

export function WalletBalance({ balance, onBalanceChange, isConfigured }: WalletBalanceProps) {
  const { t } = useTranslation();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [topUpOpen, setTopUpOpen] = useState(false);
  const [topUpAmount, setTopUpAmount] = useState('');
  const [isCharging, setIsCharging] = useState(false);

  const fetchBalance = useCallback(async () => {
    if (!isConfigured) return;

    setIsLoading(true);
    setError(null);
    try {
      onBalanceChange(await getWalletBalance());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch balance');
      onBalanceChange(null);
      console.error('Wallet balance error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [isConfigured, onBalanceChange]);

  useEffect(() => {
    fetchBalance();
  }, [fetchBalance]);

  const formatBalance = (amountInCents: number) => {
    return new Intl.NumberFormat('de-DE', {
      style: 'currency',
      currency: 'EUR'
    }).format(amountInCents / 100);
  };

  const handleTopUp = async () => {
    const cents = Math.round(parseFloat(topUpAmount.replace(',', '.')) * 100);
    if (!Number.isFinite(cents) || cents < 1) {
      toast.error(t('wallet.amountInvalid'));
      return;
    }
    if (!window.confirm(t('wallet.topUpConfirm', { amount: formatBalance(cents) }))) return;

    setIsCharging(true);
    try {
      onBalanceChange(await chargeWallet(cents));
      toast.success(t('toast.topUpDone'));
      setTopUpOpen(false);
      setTopUpAmount('');
    } catch (err) {
      toast.error(t('toast.topUpFailed'), { description: err instanceof Error ? err.message : undefined });
    } finally {
      setIsCharging(false);
    }
  };

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-card border border-border rounded-lg">
      <Wallet className="w-4 h-4 text-muted-foreground" />

      <div className="flex items-center gap-2">
        {isConfigured === false ? (
          <span className="text-sm text-muted-foreground">
            {t('wallet.notConfigured')}
          </span>
        ) : balance !== null ? (
          <span
            className={cn(
              'text-sm font-medium',
              balance < 500 ? 'text-destructive' : 'text-foreground'
            )}
          >
            {formatBalance(balance)}
          </span>
        ) : error ? (
          <span className="text-sm text-destructive flex items-center gap-1">
            <AlertCircle className="w-3 h-3" />
            {t('wallet.error')}
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        )}

        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={fetchBalance}
          disabled={isLoading || isConfigured !== true}
          title={
            isConfigured
              ? t('wallet.refreshBalance')
              : t('wallet.configureFirst')
          }
        >
          <RefreshCw
            className={cn('w-3 h-3', isLoading && 'animate-spin')}
          />
        </Button>

        {isConfigured === true && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => setTopUpOpen(o => !o)}
            title={t('wallet.topUp')}
          >
            <Plus className="w-3 h-3" />
          </Button>
        )}

        {topUpOpen && (
          <form
            className="flex items-center gap-1"
            onSubmit={e => { e.preventDefault(); handleTopUp(); }}
          >
            <Input
              autoFocus
              inputMode="decimal"
              placeholder="€"
              value={topUpAmount}
              onChange={e => setTopUpAmount(e.target.value)}
              className="h-6 w-20 px-2 text-sm font-mono"
            />
            <Button type="submit" variant="ghost" size="icon" className="h-6 w-6" disabled={isCharging} title={t('wallet.topUp')}>
              <Check className="w-3 h-3" />
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
