import { useState, useCallback, useEffect } from 'react';
import { Wallet, RefreshCw, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

interface WalletBalanceProps {
  balance?: number | null;
  onBalanceChange?: (balance: number | null) => void;
}

export function WalletBalance({ balance: externalBalance, onBalanceChange }: WalletBalanceProps) {
  const [isConfigured, setIsConfigured] = useState<boolean | null>(null);
  const [internalBalance, setInternalBalance] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Use external balance if provided, otherwise use internal state
  const balance = externalBalance !== undefined ? externalBalance : internalBalance;

  /**
   * Fetch server-side configuration status
   */
  useEffect(() => {
    fetch(`${API_BASE}/credentials/status`)
      .then(r => r.json())
      .then(data => setIsConfigured(Boolean(data.configured)))
      .catch(() => setIsConfigured(false));
  }, []);

  /**
   * Explicit balance refresh (requests new token server-side)
   */
  const fetchBalance = useCallback(async () => {
    if (!isConfigured) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/wallet/balance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const data = await response.json();

      // balance may legitimately be null (unknown)
      setInternalBalance(data.balance ?? null);
      onBalanceChange?.(data.balance ?? null);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to fetch balance';
      setError(message);
      console.error('Wallet balance error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [isConfigured, onBalanceChange]);

  /**
   * Initial balance fetch once configuration is known
   */
  useEffect(() => {
    if (isConfigured === true) {
      fetchBalance();
    }
  }, [isConfigured, fetchBalance]);

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
            Not configured
          </span>
        ) : balance !== null ? (
          <span
            className={cn(
              'font-mono text-sm font-medium',
              balance < 500 ? 'text-destructive' : 'text-foreground'
            )}
          >
            {formatBalance(balance)}
          </span>
        ) : error ? (
          <span className="text-sm text-destructive flex items-center gap-1">
            <AlertCircle className="w-3 h-3" />
            Error
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
              ? 'Refresh balance'
              : 'Configure API credentials first'
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
