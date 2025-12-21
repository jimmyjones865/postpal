import { useMemo, useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { parseAddress, ParsedAddress, formatParsedAddress } from '@/lib/addressParser';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ParsedAddressEditorProps {
  rawAddress: string;
  onAddressChange: (newRaw: string) => void;
}

export function ParsedAddressEditor({ rawAddress, onAddressChange }: ParsedAddressEditorProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [localParsed, setLocalParsed] = useState<ParsedAddress | null>(null);

  const autoParsed = useMemo(() => parseAddress(rawAddress), [rawAddress]);

  // Sync local state when raw address changes significantly
  useEffect(() => {
    setLocalParsed(autoParsed);
  }, [rawAddress]);

  const parsed = localParsed || autoParsed;

  const handleFieldChange = (field: keyof ParsedAddress, value: string) => {
    const updated = { ...parsed, [field]: value };
    setLocalParsed(updated);
    onAddressChange(formatParsedAddress(updated));
  };

  const hasContent = rawAddress.trim().length > 0;

  if (!hasContent) {
    return null;
  }

  return (
    <div className="bg-muted/30 border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted/50 transition-colors"
      >
        <span>Parsed Address Fields</span>
        {isExpanded ? (
          <ChevronUp className="w-4 h-4" />
        ) : (
          <ChevronDown className="w-4 h-4" />
        )}
      </button>

      {isExpanded && (
        <div className="px-3 pb-3 space-y-2">
          <div className="grid gap-2">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Name</Label>
              <Input
                value={parsed.name}
                onChange={(e) => handleFieldChange('name', e.target.value)}
                placeholder="First & Last Name"
                className="h-8 text-sm"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">
                Additional Name <span className="opacity-60">(optional: company, c/o)</span>
              </Label>
              <Input
                value={parsed.additionalName}
                onChange={(e) => handleFieldChange('additionalName', e.target.value)}
                placeholder="Company, c/o, etc."
                className="h-8 text-sm"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Street & Number</Label>
              <Input
                value={parsed.street}
                onChange={(e) => handleFieldChange('street', e.target.value)}
                placeholder="Musterstraße 123"
                className="h-8 text-sm"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">
                Address Line 2 <span className="opacity-60">(optional: apt, floor)</span>
              </Label>
              <Input
                value={parsed.addressLine2}
                onChange={(e) => handleFieldChange('addressLine2', e.target.value)}
                placeholder="Apartment, Floor, etc."
                className="h-8 text-sm"
              />
            </div>

            <div className="grid grid-cols-[100px_1fr] gap-2">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">ZIP</Label>
                <Input
                  value={parsed.zip}
                  onChange={(e) => handleFieldChange('zip', e.target.value)}
                  placeholder="12345"
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">City</Label>
                <Input
                  value={parsed.city}
                  onChange={(e) => handleFieldChange('city', e.target.value)}
                  placeholder="Berlin"
                  className="h-8 text-sm"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Country</Label>
              <Input
                value={parsed.country}
                onChange={(e) => handleFieldChange('country', e.target.value)}
                placeholder="Deutschland"
                className="h-8 text-sm"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
