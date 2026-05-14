import { MapPin, Printer, Download, AlertTriangle } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { validateAddress, getValidationSummary, MAX_LINE_LENGTH } from '@/lib/addressValidation';
import { useMemo } from 'react';
import { useTranslation } from '@/hooks/useTranslation';

export type PrintMode = 'print' | 'download';

interface AddressInputProps {
  value: string;
  onChange: (value: string) => void;
  onPrint: () => void;
  isPrinting: boolean;
  canPrint: boolean;
  printMode: PrintMode;
  onPrintModeChange: (mode: PrintMode) => void;
}

export function AddressInput({ value, onChange, onPrint, isPrinting, canPrint, printMode, onPrintModeChange }: AddressInputProps) {
  const { t } = useTranslation();
  const validation = useMemo(() => validateAddress(value), [value]);
  const validationSummary = useMemo(() => getValidationSummary(validation), [validation]);
  
  const isValid = validation.isValid;
  const canActuallyPrint = canPrint && isValid;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && canActuallyPrint) {
      e.preventDefault();
      onPrint();
    }
  };

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center gap-2 mb-3">
        <MapPin className="w-4 h-4 text-primary" />
        <h2 className="font-semibold text-sm">{t('address.recipientAddress')}</h2>
        <span className="text-xs text-muted-foreground ml-auto">{t('address.maxCharsPerLine', { max: MAX_LINE_LENGTH })}</span>
      </div>
      <Textarea
        placeholder={t('address.placeholder')}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        className={`address-input min-h-[120px] resize-none bg-muted/50 border-border ${
          !isValid && value.trim() ? 'border-destructive' : ''
        }`}
      />
      
      {/* Validation errors */}
      {!isValid && value.trim() && (
        <div className="mt-2 p-2 bg-destructive/10 border border-destructive/30 rounded-md">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
            <div className="text-xs text-destructive space-y-1">
              <p className="font-medium">{validationSummary}</p>
              <ul className="list-disc list-inside space-y-0.5 text-destructive/80">
                {validation.errors.slice(0, 3).map((err, i) => (
                  <li key={i}>{err.details}</li>
                ))}
                {validation.errors.length > 3 && (
                  <li>...and {validation.errors.length - 3} more</li>
                )}
              </ul>
            </div>
          </div>
        </div>
      )}
      
      {/* Print/Download toggle */}
      <div className="flex items-center gap-2 mt-3 mb-3">
        <div className="flex bg-muted rounded-md p-0.5">
          <button
            type="button"
            onClick={() => onPrintModeChange('print')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              printMode === 'print'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Printer className="w-3 h-3" />
            {t('print.print')}
          </button>
          <button
            type="button"
            onClick={() => onPrintModeChange('download')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              printMode === 'download'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Download className="w-3 h-3" />
            {t('print.download')}
          </button>
        </div>
      </div>
      
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {t('print.ctrlEnter', { action: printMode === 'print' ? t('print.print').toLowerCase() : t('print.download').toLowerCase() })}
        </p>
        <Button
          onClick={onPrint}
          disabled={isPrinting || !canActuallyPrint}
          size="sm"
          className="h-9"
        >
          {isPrinting ? (
            <span className="flex items-center gap-2">
              <span className="animate-spin">⏳</span>
              {printMode === 'print' ? t('print.printing') : t('print.downloading')}
            </span>
          ) : (
            <span className="flex items-center gap-2">
              {printMode === 'print' ? (
                <Printer className="w-4 h-4" />
              ) : (
                <Download className="w-4 h-4" />
              )}
              {printMode === 'print' ? t('print.printLabel') : t('print.downloadLabel')}
            </span>
          )}
        </Button>
      </div>
    </div>
  );
}
