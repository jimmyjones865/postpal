import { useState, useCallback } from 'react';
import { Wallet, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface WalletBalanceProps {
  onBalanceChange?: (balance: number) => void;
}

export function WalletBalance({ onBalanceChange }: WalletBalanceProps) {
  const [balance, setBalance] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchBalance = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      // TODO: Replace with actual API call to Deutsche Post/Portokasse
      // const response = await fetch('/api/wallet/balance');
      // const data = await response.json();
      // setBalance(data.balance);
      
      // Simulated balance for now
      await new Promise(resolve => setTimeout(resolve, 500));
      const mockBalance = 25.50;
      setBalance(mockBalance);
      onBalanceChange?.(mockBalance);
    } catch (err) {
      setError('Failed to fetch balance');
      console.error('Wallet balance error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [onBalanceChange]);

  const formatBalance = (amount: number) => {
    return new Intl.NumberFormat('de-DE', {
      style: 'currency',
      currency: 'EUR',
    }).format(amount);
  };

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-card border border-border rounded-lg">
      <Wallet className="w-4 h-4 text-muted-foreground" />
      <div className="flex items-center gap-2">
        {balance !== null ? (
          <span className={cn(
            "font-mono text-sm font-medium",
            balance < 5 ? "text-destructive" : "text-foreground"
          )}>
            {formatBalance(balance)}
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">
            {error ? 'Error' : '—'}
          </span>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={fetchBalance}
          disabled={isLoading}
        >
          <RefreshCw className={cn("w-3 h-3", isLoading && "animate-spin")} />
        </Button>
      </div>
    </div>
  );
}