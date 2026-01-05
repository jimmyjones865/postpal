import { useState, useCallback, useEffect } from 'react';
import { Wallet, RefreshCw, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ApiCredentials } from '@/types/shipping';

interface WalletBalanceProps {
  credentials: ApiCredentials;
  onBalanceChange?: (balance: number) => void;
}

const API_BASE = import.meta.env.VITE_API_URL || '/api';

export function WalletBalance({ credentials, onBalanceChange }: WalletBalanceProps) {
  const [balance, setBalance] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasCredentials = Boolean(
    credentials.apiKey && 
    credentials.apiSecret && 
    credentials.portokasseLogin && 
    credentials.portokassePassword
  );

  const fetchBalance = useCallback(async () => {
    if (!hasCredentials) {
      setError('API credentials not configured');
      return;
    }

    setIsLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`${API_BASE}/wallet/balance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credentials })
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }
      
      const data = await response.json();
      setBalance(data.balance);
      onBalanceChange?.(data.balance);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch balance';
      setError(message);
      console.error('Wallet balance error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [credentials, hasCredentials, onBalanceChange]);

  // Auto-fetch on mount if credentials are configured
  useEffect(() => {
    if (hasCredentials && balance === null && !error) {
      fetchBalance();
    }
  }, [hasCredentials, balance, error, fetchBalance]);

  const formatBalance = (amountInCents: number) => {
    // API returns balance in cents, convert to EUR
    return new Intl.NumberFormat('de-DE', {
      style: 'currency',
      currency: 'EUR',
    }).format(amountInCents / 100);
  };

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-card border border-border rounded-lg">
      <Wallet className="w-4 h-4 text-muted-foreground" />
      <div className="flex items-center gap-2">
        {!hasCredentials ? (
          <span className="text-sm text-muted-foreground">Not configured</span>
        ) : balance !== null ? (
          <span className={cn(
            "font-mono text-sm font-medium",
            balance < 5 ? "text-destructive" : "text-foreground"
          )}>
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
          disabled={isLoading || !hasCredentials}
          title={hasCredentials ? "Refresh balance" : "Configure API credentials first"}
        >
          <RefreshCw className={cn("w-3 h-3", isLoading && "animate-spin")} />
        </Button>
      </div>
    </div>
  );
}