import { useEffect, useState, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { emptyAddress, ParsedAddress, formatParsedAddress } from '@/lib/address';
import { useAddressParser } from '@/hooks/useAddressParser';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { useDebouncedCallback } from '@/hooks/useDebounce';

interface ParsedAddressEditorProps {
  rawAddress: string;
  onAddressChange: (newRaw: string) => void;
  onParsedChange?: (parsed: ParsedAddress) => void;
}

export function ParsedAddressEditor({ rawAddress, onAddressChange, onParsedChange }: ParsedAddressEditorProps) {
  const [parsed, setParsed] = useState<ParsedAddress>(emptyAddress);
  const lastRawRef = useRef('');
  const { parseAddress, isLoading } = useAddressParser();

  // Debounced parse function
  const debouncedParse = useDebouncedCallback(async (address: string) => {
    if (!address.trim()) {
      const empty = emptyAddress();
      setParsed(empty);
      onParsedChange?.(empty);
      return;
    }
    
    const result = await parseAddress(address);
    console.log('Parse result:', result);
    if (result) {
      setParsed(result);
      onParsedChange?.(result);
    }
  }, 500);

  // Parse when rawAddress changes externally
  useEffect(() => {
    if (rawAddress !== lastRawRef.current) {
      lastRawRef.current = rawAddress;
      debouncedParse(rawAddress);
    }
  }, [rawAddress, debouncedParse]);

  // Warning: both optional lines are filled
  const hasBothOptionalLines = Boolean(parsed.additionalName?.trim() && parsed.addressLine2?.trim());

  const handleFieldChange = (field: keyof ParsedAddress, value: string) => {
    const updated = { ...parsed, [field]: value };
    setParsed(updated);
    onParsedChange?.(updated);
    const newRaw = formatParsedAddress(updated);
    lastRawRef.current = newRaw;
    onAddressChange(newRaw);
  };

  return (
    <div className="space-y-2">
      {/* Loading indicator */}
      {isLoading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="w-3 h-3 animate-spin" />
          <span>Parsing address...</span>
        </div>
      )}
      
      {/* Warning if both optional lines are filled */}
      {hasBothOptionalLines && (
        <div className="flex items-center gap-2 p-2 bg-amber-500/10 border border-amber-500/30 rounded text-amber-600 text-xs">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>Only 4 address lines allowed. Remove either Company/c/o or Apt/Floor.</span>
        </div>
      )}

      {/* Line 1: Name (required) */}
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Name</Label>
        <Input
          value={parsed.name}
          onChange={(e) => handleFieldChange('name', e.target.value)}
          placeholder="First & Last Name"
          className="h-8 text-sm font-mono"
        />
      </div>

      {/* Line 2: Additional Name (optional - Company, c/o) */}
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Company / c/o <span className="opacity-50">(optional)</span></Label>
        <Input
          value={parsed.additionalName}
          onChange={(e) => handleFieldChange('additionalName', e.target.value)}
          placeholder="Company, c/o, etc."
          className={`h-8 text-sm font-mono ${hasBothOptionalLines ? 'border-amber-500/50' : ''}`}
        />
      </div>

      {/* Line 3: Street & Number (required) */}
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Street & Number</Label>
        <Input
          value={parsed.street}
          onChange={(e) => handleFieldChange('street', e.target.value)}
          placeholder="Musterstraße 123"
          className="h-8 text-sm font-mono"
        />
      </div>

      {/* Line 4: Address Line 2 (optional - Apt, Floor) */}
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Apt / Floor <span className="opacity-50">(optional)</span></Label>
        <Input
          value={parsed.addressLine2}
          onChange={(e) => handleFieldChange('addressLine2', e.target.value)}
          placeholder="Apartment, Floor, etc."
          className={`h-8 text-sm font-mono ${hasBothOptionalLines ? 'border-amber-500/50' : ''}`}
        />
      </div>

      {/* Line 5: ZIP & City (required) */}
      <div className="grid grid-cols-[100px_1fr] gap-2">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">ZIP</Label>
          <Input
            value={parsed.zip}
            onChange={(e) => handleFieldChange('zip', e.target.value)}
            placeholder="12345"
            className="h-8 text-sm font-mono"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">City</Label>
          <Input
            value={parsed.city}
            onChange={(e) => handleFieldChange('city', e.target.value)}
            placeholder="Berlin"
            className="h-8 text-sm font-mono"
          />
        </div>
      </div>

      {/* Line 6: Country (required, defaults to Deutschland) */}
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Country</Label>
        <Input
          value={parsed.country}
          onChange={(e) => handleFieldChange('country', e.target.value)}
          placeholder="Deutschland"
          className="h-8 text-sm font-mono"
        />
      </div>
    </div>
  );
}
