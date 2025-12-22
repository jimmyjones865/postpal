import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TrackingNumberProps {
  trackingNumber: string | null;
  isTracked: boolean;
}

export function TrackingNumber({ trackingNumber, isTracked }: TrackingNumberProps) {
  const [copied, setCopied] = useState(false);

  // Only show for tracked products
  if (!isTracked) return null;

  const handleCopy = async () => {
    if (!trackingNumber) return;
    
    try {
      await navigator.clipboard.writeText(trackingNumber);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <div className="mt-3">
      <div className="text-xs text-muted-foreground mb-1">Tracking Number</div>
      <button
        onClick={handleCopy}
        disabled={!trackingNumber}
        className={cn(
          "w-full flex items-center justify-between gap-2 px-3 py-2 rounded-md border transition-colors",
          "font-mono text-sm",
          trackingNumber 
            ? "bg-muted/50 border-border hover:bg-muted cursor-pointer" 
            : "bg-muted/20 border-dashed border-border/50 cursor-default text-muted-foreground"
        )}
      >
        <span className="truncate">
          {trackingNumber || 'Will appear after purchase'}
        </span>
        {trackingNumber && (
          <span className="flex-shrink-0">
            {copied ? (
              <Check className="w-4 h-4 text-green-500" />
            ) : (
              <Copy className="w-4 h-4 text-muted-foreground" />
            )}
          </span>
        )}
      </button>
    </div>
  );
}
