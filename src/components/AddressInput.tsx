import { MapPin, Printer } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';

interface AddressInputProps {
  value: string;
  onChange: (value: string) => void;
  onPrint: () => void;
  isPrinting: boolean;
  canPrint: boolean;
}

export function AddressInput({ value, onChange, onPrint, isPrinting, canPrint }: AddressInputProps) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && canPrint) {
      e.preventDefault();
      onPrint();
    }
  };

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center gap-2 mb-3">
        <MapPin className="w-4 h-4 text-primary" />
        <h2 className="font-semibold text-sm">Recipient Address</h2>
      </div>
      <Textarea
        placeholder={`Max Mustermann
Musterstraße 123
12345 Berlin
Deutschland`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        className="address-input min-h-[120px] resize-none bg-muted/50 border-border"
      />
      <div className="flex items-center justify-between mt-3">
        <p className="text-xs text-muted-foreground">
          Ctrl+Enter to print
        </p>
        <Button
          onClick={onPrint}
          disabled={isPrinting || !canPrint}
          size="sm"
          className="h-9"
        >
          {isPrinting ? (
            <span className="flex items-center gap-2">
              <span className="animate-spin">⏳</span>
              Printing...
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <Printer className="w-4 h-4" />
              Print Label
            </span>
          )}
        </Button>
      </div>
    </div>
  );
}
