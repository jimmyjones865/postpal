import { MapPin } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';

interface AddressInputProps {
  value: string;
  onChange: (value: string) => void;
}

export function AddressInput({ value, onChange }: AddressInputProps) {
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
        className="address-input min-h-[140px] resize-none bg-muted/50 border-border"
      />
      <p className="text-xs text-muted-foreground mt-2">
        Enter the complete address as it should appear on the label
      </p>
    </div>
  );
}
