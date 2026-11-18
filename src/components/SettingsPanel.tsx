import { useState, useEffect } from 'react';
import { Settings, User, Printer, Package, Ruler, Bot } from 'lucide-react';
import { toast } from 'sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  Select
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { AppConfig, IntakeSettings, ShippingProduct } from '@/types/shipping';
import { useTranslation } from '@/hooks/useTranslation';

interface SettingsPanelProps {
  config: AppConfig;
  defaults: AppConfig;
  storedIntake: Partial<IntakeSettings>;
  intakeEnabled: boolean;
  products: ShippingProduct[];
  onUpdatePrinterConfig: (printer: Partial<AppConfig['printerConfig']>) => void;
  onUpdateSenderAddress: (address: Partial<AppConfig['senderAddress']>) => void;
  onUpdateHiddenProducts: (hidden: string[]) => void;
  onUpdateIntake: (values: Partial<{ [K in keyof IntakeSettings]: IntakeSettings[K] | null }>) => Promise<void>;
}

type IntakeTextKey = Exclude<keyof IntakeSettings, 'dryRun'>;

/** Empty = env value (shown as placeholder). Saved on blur or Enter; a rejected value reverts. */
function IntakeField({ name, label, hint, stored, envValue, numeric, onSave }: {
  name: IntakeTextKey;
  label: string;
  hint?: string;
  stored: IntakeSettings[IntakeTextKey] | undefined;
  envValue: IntakeSettings[IntakeTextKey];
  numeric?: boolean;
  onSave: SettingsPanelProps['onUpdateIntake'];
}) {
  const { t } = useTranslation();
  const shown = stored === undefined ? '' : String(stored);
  const [draft, setDraft] = useState(shown);
  useEffect(() => setDraft(shown), [shown]);

  const commit = async () => {
    const text = draft.trim();
    if (text === shown) return;
    const value = text === '' ? null : numeric ? Number(text.replace(',', '.')) : text;
    try {
      await onSave({ [name]: value });
    } catch (e) {
      toast.error(t('settings.saveFailed'), { description: (e as Error).message });
      setDraft(shown);
    }
  };

  return (
    <div className="config-field">
      <Label className="config-label">{label}</Label>
      <Input
        type="text"
        inputMode={numeric ? 'decimal' : undefined}
        placeholder={`${envValue === '' ? '24h' : envValue} (${t('settings.envDefault')})`}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        className="h-9 text-sm font-mono"
      />
      {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
    </div>
  );
}

// Paper formats interfaces
interface PaperFormat {
  id: number;
  name: string;
  description: string;
  pageType: string;
  pageLayout: {
    size: { x: number; y: number };
    orientation: 'PORTRAIT' | 'LANDSCAPE';
    labelSpacing: { x: number; y: number };
    labelCount: { labelX: number; labelY: number };
    margin: { top: number; bottom: number; left: number; right: number };
  };
  roll?: { endless: boolean; widthMm: number };
}

interface PaperFormatsJson {
  LABELPAGE?: PaperFormat[];
  [key: string]: PaperFormat[] | undefined;
}

export function SettingsPanel({
  config,
  defaults,
  storedIntake,
  intakeEnabled,
  products,
  onUpdatePrinterConfig,
  onUpdateSenderAddress,
  onUpdateHiddenProducts,
  onUpdateIntake
}: SettingsPanelProps) {
  const { t } = useTranslation();

  // --- PAPER FORMATS STATE AND EFFECT ---
  const [paperFormats, setPaperFormats] = useState<PaperFormat[]>([]);
  const [paperFormatsError, setPaperFormatsError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/paper-formats.json')
      .then(async r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<PaperFormatsJson>;
      })
      .then((data: PaperFormatsJson) => {
        const allFormats = Object.values(data).flat().filter(Boolean) as PaperFormat[];
        // Deduplicate by name to avoid duplicate entries in dropdown
        const seenNames = new Set<string>();
        const formats = allFormats.filter(format => {
          if (seenNames.has(format.name)) return false;
          seenNames.add(format.name);
          return true;
        });
        setPaperFormats(formats);
      })
      .catch(err => {
        console.error('Failed to load paper formats:', err);
        setPaperFormatsError('Failed to load paper formats');
      });
  }, []);
  // --- END PAPER FORMATS ---

  const domesticProducts = products.filter(p => p.domestic);
  const internationalProducts = products.filter(p => !p.domestic);

  const toggleHidden = (productCode: string) => {
    const current = config.hiddenProducts;
    onUpdateHiddenProducts(current.includes(productCode)
      ? current.filter(code => code !== productCode)
      : [...current, productCode]);
  };

  const intake = config.intake;
  const setLive = async (live: boolean) => {
    try {
      await onUpdateIntake({ dryRun: !live });
    } catch (e) {
      toast.error(t('settings.saveFailed'), { description: (e as Error).message });
    }
  };
  const field = (name: IntakeTextKey, label: string, hint?: string, numeric = true) => (
    <IntakeField name={name} label={label} hint={hint} numeric={numeric}
      stored={storedIntake[name]} envValue={defaults.intake[name]} onSave={onUpdateIntake} />
  );

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center gap-2 mb-4">
        <Settings className="w-4 h-4 text-primary" />
        <h2 className="font-semibold text-sm">{t('settings.title')}</h2>
      </div>

      <Tabs defaultValue="sender" className="w-full">
        <TabsList className="w-full grid grid-cols-4 mb-4">
          <TabsTrigger value="sender" className="text-xs gap-1">
            <User className="w-3 h-3" /> {t('settings.sender')}
          </TabsTrigger>
          <TabsTrigger value="printer" className="text-xs gap-1">
            <Printer className="w-3 h-3" /> {t('settings.printer')}
          </TabsTrigger>
          <TabsTrigger value="products" className="text-xs gap-1">
            <Package className="w-3 h-3" /> {t('settings.products')}
          </TabsTrigger>
          <TabsTrigger value="intake" className="text-xs gap-1">
            <Bot className="w-3 h-3" /> {t('settings.intake')}
          </TabsTrigger>
        </TabsList>

        {/* ----- SENDER TAB ----- */}
        <TabsContent value="sender" className="space-y-3 mt-0">
          <div className="config-field">
            <Label className="config-label">{t('settings.fullName')}</Label>
            <Input
              type="text"
              placeholder={t('settings.fullNamePlaceholder')}
              value={config.senderAddress.name}
              onChange={e => onUpdateSenderAddress({ name: e.target.value })}
              className="h-9 text-sm font-mono"
            />
          </div>
          <div className="config-field">
            <Label className="config-label">{t('settings.companyOptional')}</Label>
            <Input
              type="text"
              placeholder={t('settings.companyPlaceholder')}
              value={config.senderAddress.company ?? ''}
              onChange={e => onUpdateSenderAddress({ company: e.target.value })}
              className="h-9 text-sm font-mono"
            />
          </div>
          <div className="config-field">
            <Label className="config-label">{t('settings.streetNumber')}</Label>
            <Input
              type="text"
              placeholder={t('address.streetPlaceholder')}
              value={config.senderAddress.street}
              onChange={e => onUpdateSenderAddress({ street: e.target.value })}
              className="h-9 text-sm font-mono"
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="config-field">
              <Label className="config-label">{t('settings.postalCode')}</Label>
              <Input
                type="text"
                placeholder={t('address.zipPlaceholder')}
                value={config.senderAddress.postalCode}
                onChange={e => onUpdateSenderAddress({ postalCode: e.target.value })}
                className="h-9 text-sm font-mono"
              />
            </div>
            <div className="config-field col-span-2">
              <Label className="config-label">{t('address.city')}</Label>
              <Input
                type="text"
                placeholder={t('address.cityPlaceholder')}
                value={config.senderAddress.city}
                onChange={e => onUpdateSenderAddress({ city: e.target.value })}
                className="h-9 text-sm font-mono"
              />
            </div>
          </div>
          <div className="config-field">
            <Label className="config-label">{t('address.country')}</Label>
            <Input
              type="text"
              placeholder="DE"
              value={config.senderAddress.country}
              onChange={e => onUpdateSenderAddress({ country: e.target.value })}
              className="h-9 text-sm font-mono"
            />
          </div>
        </TabsContent>

        {/* ----- PRINTER TAB ----- */}
        <TabsContent value="printer" className="space-y-3 mt-0">
          <div className="config-field">
            <Label className="config-label">{t('settings.paperFormat')}</Label>
            {paperFormatsError ? (
              <p className="text-xs text-destructive">{paperFormatsError}</p>
            ) : (
              <Select
                className="h-9 text-sm"
                value={config.printerConfig.paperFormatId ? String(config.printerConfig.paperFormatId) : ''}
                onChange={e => {
                  const fmt = paperFormats.find(f => f.id === parseInt(e.target.value));
                  onUpdatePrinterConfig({ paperFormatName: fmt?.name ?? '', paperFormatId: parseInt(e.target.value) });
                }}
              >
                <option value="" disabled>{t('settings.selectPaperFormat')}</option>
                {paperFormats.map(format => (
                  <option key={format.id} value={String(format.id)}>{format.name}</option>
                ))}
              </Select>
            )}

            {(() => {
              const selected = paperFormats.find(
                f => f.id === config.printerConfig.paperFormatId
              );
              if (!selected) return null;

              const isRoll = selected.roll?.endless;

              return (
                <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
                  <div>{selected.description}</div>
                  {isRoll ? (
                    <div>
                      {t('settings.endlessRoll', { width: selected.roll!.widthMm })}
                    </div>
                  ) : (
                    <div>
                      {t('settings.sheetInfo', {
                        width: selected.pageLayout.size.x,
                        height: selected.pageLayout.size.y,
                        labelX: selected.pageLayout.labelCount?.labelX ?? 1,
                        labelY: selected.pageLayout.labelCount?.labelY ?? 1
                      })}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>

          <div className="config-field">
            <Label className="config-label">{t('settings.orientation')}</Label>
            <Select
              className="h-9 text-sm"
              value={config.printerConfig.orientation}
              onChange={e => onUpdatePrinterConfig({ orientation: e.target.value as 'portrait' | 'landscape' })}
            >
              <option value="portrait">{t('settings.portrait')}</option>
              <option value="landscape">{t('settings.landscape')}</option>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
              {t('settings.landscapeHint')}
            </p>
          </div>

          {/* Paper Size Section */}
          <div className="border-t border-border pt-3 mt-3">
            <Label className="config-label mb-2 block">
              {t('settings.paperSize')}
            </Label>
            
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div className="config-field">
                <Label className="config-label text-xs">{t('settings.paperWidth')}</Label>
                <Input
                  type="number"
                  min={10}
                  max={300}
                  value={config.printerConfig.paperWidthMm}
                  onChange={e =>
                    onUpdatePrinterConfig({ paperWidthMm: parseInt(e.target.value) || 62 })
                  }
                  className="h-9 text-sm"
                />
              </div>
              <div className="config-field">
                <Label className="config-label text-xs">{t('settings.paperHeight')}</Label>
                <Input
                  type="number"
                  min={10}
                  max={500}
                  value={config.printerConfig.paperHeightMm}
                  onChange={e =>
                    onUpdatePrinterConfig({ paperHeightMm: parseInt(e.target.value) || 100 })
                  }
                  disabled={config.printerConfig.endlessRoll}
                  className="h-9 text-sm"
                />
              </div>
            </div>
            
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox
                checked={config.printerConfig.endlessRoll}
                onCheckedChange={checked => 
                  onUpdatePrinterConfig({ endlessRoll: checked === true })
                }
              />
              <span className="text-sm">{t('settings.endlessRollLabel')}</span>
            </label>
            
            <p className="text-xs text-muted-foreground mt-2">
              {t('settings.endlessRollHint')}
            </p>
          </div>

          {/* CUPS Direct Printing Section */}
          <div className="border-t border-border pt-3 mt-3">
            <Label className="config-label mb-2 block">
              {t('settings.directPrinting')}
            </Label>
            
            <div className="config-field mb-3">
              <Label className="config-label text-xs">{t('settings.cupsServerUrl')}</Label>
              <Input
                type="text"
                placeholder={t('settings.cupsPlaceholder')}
                value={config.printerConfig.cupsUrl}
                onChange={e => onUpdatePrinterConfig({ cupsUrl: e.target.value })}
                className="h-9 text-sm"
              />
            </div>
            
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox
                checked={config.printerConfig.enableDirectPrint}
                onCheckedChange={checked => 
                  onUpdatePrinterConfig({ enableDirectPrint: checked === true })
                }
              />
              <span className="text-sm">{t('settings.enableDirectPrint')}</span>
            </label>
            
            <p className="text-xs text-muted-foreground mt-2">
              {t('settings.cupsHint')}
            </p>
          </div>

          <div className="config-field">
            <Label className="config-label">{t('settings.printerName')}</Label>
            <Input
              type="text"
              placeholder={t('settings.printerNamePlaceholder')}
              value={config.printerConfig.printerName}
              onChange={e => onUpdatePrinterConfig({ printerName: e.target.value })}
              className="h-9 text-sm"
            />
            <p className="text-xs text-muted-foreground mt-1">
              {t('settings.printerNameHint')}
            </p>
          </div>

          <div className="border-t border-border pt-3 mt-3">
            <Label className="config-label mb-2 block">
              {t('settings.labelCropping')}
            </Label>
            
            <label className="flex items-center gap-2 cursor-pointer mb-3">
              <Checkbox
                checked={config.printerConfig.disableCropping}
                onCheckedChange={checked => 
                  onUpdatePrinterConfig({ disableCropping: checked === true })
                }
              />
              <span className="text-sm">{t('settings.disableCropping')}</span>
            </label>
            
            {!config.printerConfig.disableCropping && (
              <>
                <p className="text-xs text-muted-foreground mb-3">
                  {t('settings.croppingHint')}
                </p>
                
                <div className="grid grid-cols-3 gap-2 items-center">
                  {/* Top - centered */}
                  <div />
                  <div className="config-field">
                    <Label className="config-label text-xs text-center block">{t('settings.top')}</Label>
                    <Input
                      type="number"
                      min={0}
                      max={50}
                      value={config.printerConfig.cropMarginTop}
                      onChange={e => onUpdatePrinterConfig({ cropMarginTop: parseInt(e.target.value) || 0 })}
                      className="h-9 text-sm text-center"
                    />
                  </div>
                  <div />
                  
                  {/* Left and Right */}
                  <div className="config-field">
                    <Label className="config-label text-xs text-center block">{t('settings.left')}</Label>
                    <Input
                      type="number"
                      min={0}
                      max={50}
                      value={config.printerConfig.cropMarginLeft}
                      onChange={e => onUpdatePrinterConfig({ cropMarginLeft: parseInt(e.target.value) || 0 })}
                      className="h-9 text-sm text-center"
                    />
                  </div>
                  <div className="flex items-center justify-center">
                    <Ruler className="w-6 h-6 text-muted-foreground" />
                  </div>
                  <div className="config-field">
                    <Label className="config-label text-xs text-center block">{t('settings.right')}</Label>
                    <Input
                      type="number"
                      min={0}
                      max={50}
                      value={config.printerConfig.cropMarginRight}
                      onChange={e => onUpdatePrinterConfig({ cropMarginRight: parseInt(e.target.value) || 0 })}
                      className="h-9 text-sm text-center"
                    />
                  </div>
                  
                  {/* Bottom - centered */}
                  <div />
                  <div className="config-field">
                    <Label className="config-label text-xs text-center block">{t('settings.bottom')}</Label>
                    <Input
                      type="number"
                      min={0}
                      max={50}
                      value={config.printerConfig.cropMarginBottom}
                      onChange={e => onUpdatePrinterConfig({ cropMarginBottom: parseInt(e.target.value) || 0 })}
                      className="h-9 text-sm text-center"
                    />
                  </div>
                  <div />
                </div>
                
              </>
            )}
          </div>
        </TabsContent>

        {/* ----- PRODUCTS TAB ----- */}
        <TabsContent value="products" className="space-y-4 mt-0">
          <p className="text-xs text-muted-foreground">
            {t('settings.uncheckToHide')}
          </p>

          <div>
            <Label className="config-label mb-2 block">{t('product.domestic')}</Label>
            <div className="space-y-2">
              {domesticProducts.map(product => {
                const isExcluded = config.hiddenProducts.includes(product.code);
                return (
                  <label key={product.code} className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      checked={!isExcluded}
                      onCheckedChange={() => toggleHidden(product.code)}
                    />
                    <span className="text-sm">{product.name}</span>
                    <span className="text-xs text-muted-foreground">{product.cost.toFixed(2)}€</span>
                  </label>
                );
              })}
            </div>
          </div>

          <div>
            <Label className="config-label mb-2 block">{t('product.international')}</Label>
            <div className="space-y-2">
              {internationalProducts.map(product => {
                const isExcluded = config.hiddenProducts.includes(product.code);
                return (
                  <label key={product.code} className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      checked={!isExcluded}
                      onCheckedChange={() => toggleHidden(product.code)}
                    />
                    <span className="text-sm">{product.name}</span>
                    <span className="text-xs text-muted-foreground">{product.cost.toFixed(2)}€</span>
                  </label>
                );
              })}
            </div>
          </div>
        </TabsContent>

        {/* ----- EMAIL INTAKE TAB ----- */}
        <TabsContent value="intake" className="space-y-3 mt-0">
          {!intakeEnabled && (
            <p className="text-xs text-amber-500">{t('settings.intakeOff')}</p>
          )}
          <div className={`rounded-md border p-3 ${intake.dryRun ? 'border-border' : 'border-destructive'}`}>
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox checked={!intake.dryRun} onCheckedChange={checked => setLive(checked === true)} />
              <span className="text-sm font-medium">{t('settings.live')}</span>
            </label>
            <p className={`text-xs mt-2 ${intake.dryRun ? 'text-muted-foreground' : 'text-destructive'}`}>
              {intake.dryRun ? t('settings.dryRunHint') : t('settings.liveHint')}
            </p>
          </div>
          {field('maxLabelsPerDay', t('settings.maxLabelsPerDay'))}
          <div className="grid grid-cols-2 gap-2">
            {field('autoTopupEur', t('settings.autoTopupEur'))}
            {field('autoTopupDailyMaxEur', t('settings.autoTopupDailyMaxEur'))}
          </div>
          <p className="text-xs text-muted-foreground">{t('settings.autoTopupHint')}</p>
          <div className="grid grid-cols-2 gap-2">
            {field('printWindowWeekday', t('settings.printWindowWeekday'), undefined, false)}
            {field('printWindowWeekend', t('settings.printWindowWeekend'), undefined, false)}
          </div>
          <p className="text-xs text-muted-foreground">{t('settings.printWindowHint')}</p>
          <p className="text-xs text-muted-foreground border-t border-border pt-3">{t('settings.intakeHint')}</p>
        </TabsContent>
      </Tabs>
    </div>
  );
}
