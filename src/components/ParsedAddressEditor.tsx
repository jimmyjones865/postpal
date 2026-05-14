import { useEffect, useState, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { emptyAddress, ParsedAddress, formatParsedAddress } from '@/lib/address';
import { useAddressParser } from '@/hooks/useAddressParser';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { useDebouncedCallback } from '@/hooks/useDebounce';
import { useTranslation } from '@/hooks/useTranslation';

interface ParsedAddressEditorProps {
  rawAddress: string;
  onAddressChange: (newRaw: string) => void;
  onParsedChange?: (parsed: ParsedAddress) => void;
}

export function ParsedAddressEditor({ rawAddress, onAddressChange, onParsedChange }: ParsedAddressEditorProps) {
  const { t } = useTranslation();
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

  // Confidence indicator color
  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 80) return 'text-primary';
    if (confidence >= 50) return 'text-muted-foreground';
    return 'text-destructive';
  };

  return (
    <div className="space-y-2">
      {/* Loading indicator */}
      {isLoading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="w-3 h-3 animate-spin" />
          <span>{t('parser.parsing')}</span>
        </div>
      )}

      {/* Confidence + Warnings */}
      {!isLoading && parsed.name && (
        <div className="space-y-1">
          {/* Confidence score */}
          {parsed.confidence !== undefined && (
            <div className={`flex items-center gap-2 text-xs ${getConfidenceColor(parsed.confidence)}`}>
              <span className="font-medium">{t('validation.confidence', { percent: parsed.confidence })}</span>
            </div>
          )}
          
          {/* Warnings */}
          {parsed.warnings && parsed.warnings.length > 0 && (
            <div className="flex items-start gap-2 p-2 bg-muted border border-border rounded text-muted-foreground text-xs">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                {parsed.warnings.map((warning, i) => (
                  <div key={i}>{warning}</div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      
      {/* Warning if both optional lines are filled */}
      {hasBothOptionalLines && (
        <div className="flex items-center gap-2 p-2 bg-muted border border-border rounded text-muted-foreground text-xs">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>{t('validation.onlyFourLinesAllowed')}</span>
        </div>
      )}

      {/* Line 1: Name (required) */}
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">{t('address.name')}</Label>
        <Input
          value={parsed.name}
          onChange={(e) => handleFieldChange('name', e.target.value)}
          placeholder={t('address.namePlaceholder')}
          className="h-8 text-sm font-mono"
        />
      </div>

      {/* Line 2: Additional Name (optional - Company, c/o) */}
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">{t('address.company')} <span className="opacity-50">{t('address.optional')}</span></Label>
        <Input
          value={parsed.additionalName}
          onChange={(e) => handleFieldChange('additionalName', e.target.value)}
          placeholder={t('address.companyPlaceholder')}
          className={`h-8 text-sm font-mono ${hasBothOptionalLines ? 'border-amber-500/50' : ''}`}
        />
      </div>

      {/* Line 3: Street & Number (required) */}
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">{t('address.street')}</Label>
        <Input
          value={parsed.street}
          onChange={(e) => handleFieldChange('street', e.target.value)}
          placeholder={t('address.streetPlaceholder')}
          className="h-8 text-sm font-mono"
        />
      </div>

      {/* Line 4: Address Line 2 (optional - Apt, Floor) */}
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">{t('address.apt')} <span className="opacity-50">{t('address.optional')}</span></Label>
        <Input
          value={parsed.addressLine2}
          onChange={(e) => handleFieldChange('addressLine2', e.target.value)}
          placeholder={t('address.aptPlaceholder')}
          className={`h-8 text-sm font-mono ${hasBothOptionalLines ? 'border-amber-500/50' : ''}`}
        />
      </div>

      {/* Line 5: ZIP & City (required) */}
      <div className="grid grid-cols-[100px_1fr] gap-2">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">{t('address.zip')}</Label>
          <Input
            value={parsed.zip}
            onChange={(e) => handleFieldChange('zip', e.target.value)}
            placeholder={t('address.zipPlaceholder')}
            className="h-8 text-sm font-mono"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">{t('address.city')}</Label>
          <Input
            value={parsed.city}
            onChange={(e) => handleFieldChange('city', e.target.value)}
            placeholder={t('address.cityPlaceholder')}
            className="h-8 text-sm font-mono"
          />
        </div>
      </div>

      {/* Line 6: Country (required, defaults to Deutschland) */}
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">{t('address.country')}</Label>
        <Input
          value={parsed.country}
          onChange={(e) => handleFieldChange('country', e.target.value)}
          placeholder={t('address.countryPlaceholder')}
          className="h-8 text-sm font-mono"
        />
      </div>
    </div>
  );
}
