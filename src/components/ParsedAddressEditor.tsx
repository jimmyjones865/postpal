import { useMemo, useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { parseAddress, ParsedAddress, formatParsedAddress } from '@/lib/addressParser';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface ParsedAddressEditorProps {
  rawAddress: string;
  onAddressChange: (newRaw: string) => void;
}

type OptionalLineType = 'none' | 'additionalName' | 'addressLine2';

export function ParsedAddressEditor({ rawAddress, onAddressChange }: ParsedAddressEditorProps) {
  const [localParsed, setLocalParsed] = useState<ParsedAddress | null>(null);
  const [optionalLineType, setOptionalLineType] = useState<OptionalLineType>('none');

  const autoParsed = useMemo(() => parseAddress(rawAddress), [rawAddress]);

  // Sync local state when raw address changes significantly
  useEffect(() => {
    setLocalParsed(autoParsed);
    
    // Determine which optional line type is in use
    if (autoParsed.additionalName && autoParsed.additionalName.trim()) {
      setOptionalLineType('additionalName');
    } else if (autoParsed.addressLine2 && autoParsed.addressLine2.trim()) {
      setOptionalLineType('addressLine2');
    } else {
      setOptionalLineType('none');
    }
  }, [rawAddress]);

  const parsed = localParsed || autoParsed;

  const handleFieldChange = (field: keyof ParsedAddress, value: string) => {
    const updated = { ...parsed, [field]: value };
    
    // Enforce mutual exclusivity: if setting one optional line, clear the other
    if (field === 'additionalName' && value.trim()) {
      updated.addressLine2 = '';
    } else if (field === 'addressLine2' && value.trim()) {
      updated.additionalName = '';
    }
    
    setLocalParsed(updated);
    onAddressChange(formatParsedAddress(updated));
  };

  const handleOptionalLineTypeChange = (type: OptionalLineType) => {
    setOptionalLineType(type);
    
    // Clear both optional fields when switching
    const updated = { 
      ...parsed, 
      additionalName: '', 
      addressLine2: '' 
    };
    setLocalParsed(updated);
    onAddressChange(formatParsedAddress(updated));
  };

  const optionalLineValue = optionalLineType === 'additionalName' 
    ? parsed.additionalName 
    : optionalLineType === 'addressLine2' 
      ? parsed.addressLine2 
      : '';

  const handleOptionalLineValue = (value: string) => {
    if (optionalLineType === 'additionalName') {
      handleFieldChange('additionalName', value);
    } else if (optionalLineType === 'addressLine2') {
      handleFieldChange('addressLine2', value);
    }
  };

  return (
    <div className="space-y-2">
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

      {/* Optional Line: Either additionalName OR addressLine2 */}
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Select value={optionalLineType} onValueChange={(v) => handleOptionalLineTypeChange(v as OptionalLineType)}>
            <SelectTrigger className="h-6 text-xs w-auto min-w-[140px] border-dashed">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No extra line</SelectItem>
              <SelectItem value="additionalName">Company / c/o</SelectItem>
              <SelectItem value="addressLine2">Apt / Floor</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">(optional)</span>
        </div>
        {optionalLineType !== 'none' && (
          <Input
            value={optionalLineValue}
            onChange={(e) => handleOptionalLineValue(e.target.value)}
            placeholder={optionalLineType === 'additionalName' ? 'Company, c/o, etc.' : 'Apartment, Floor, etc.'}
            className="h-8 text-sm font-mono"
          />
        )}
      </div>

      {/* Line 2: Street & Number (required) */}
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Street & Number</Label>
        <Input
          value={parsed.street}
          onChange={(e) => handleFieldChange('street', e.target.value)}
          placeholder="Musterstraße 123"
          className="h-8 text-sm font-mono"
        />
      </div>

      {/* Line 3: ZIP & City (required) */}
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

      {/* Line 4: Country (required, defaults to Deutschland) */}
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
