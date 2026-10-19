import { useState, useCallback, useEffect } from 'react';
import { Wallet, RefreshCw, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';
import { getWalletBalance } from '@/services/labelService';

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
      </div>
    </div>
  );
}
