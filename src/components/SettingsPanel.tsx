import { useState, useEffect } from 'react';
import { Settings, User, Printer, Package, Ruler, Loader2 } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { AppConfig, ShippingProduct } from '@/types/shipping';
import { DimensionsPreview } from './DimensionsPreview';
import { useTranslation } from '@/hooks/useTranslation';

interface SettingsPanelProps {
  config: AppConfig;
  products: ShippingProduct[];
  onUpdatePrinterConfig: (printer: Partial<AppConfig['printerConfig']>) => void;
  onUpdateSenderAddress: (address: Partial<AppConfig['senderAddress']>) => void;
  onUpdateFavoriteProducts: (favorites: string[]) => void;
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
  products,
  onUpdatePrinterConfig,
  onUpdateSenderAddress,
  onUpdateFavoriteProducts
}: SettingsPanelProps) {
  const { t } = useTranslation();

  // --- PAPER FORMATS STATE AND EFFECT ---
  const [paperFormats, setPaperFormats] = useState<PaperFormat[]>([]);
  const [paperFormatsError, setPaperFormatsError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/paper-formats.json')
      .then(async r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const json = await r.json();
        console.log('Raw paper-formats.json loaded:', json);
        return json as PaperFormatsJson;
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
        console.log('Processed paper formats array:', formats.length, 'unique formats');
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

  const toggleFavorite = (productCode: string) => {
    const current = config.favoriteProducts || [];
    if (current.includes(productCode)) {
      onUpdateFavoriteProducts(current.filter(code => code !== productCode));
    } else {
      onUpdateFavoriteProducts([...current, productCode]);
    }
  };

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center gap-2 mb-4">
        <Settings className="w-4 h-4 text-primary" />
        <h2 className="font-semibold text-sm">{t('settings.title')}</h2>
      </div>

      <Tabs defaultValue="sender" className="w-full">
        <TabsList className="w-full grid grid-cols-3 mb-4">
          <TabsTrigger value="sender" className="text-xs gap-1">
            <User className="w-3 h-3" /> {t('settings.sender')}
          </TabsTrigger>
          <TabsTrigger value="printer" className="text-xs gap-1">
            <Printer className="w-3 h-3" /> {t('settings.printer')}
          </TabsTrigger>
          <TabsTrigger value="products" className="text-xs gap-1">
            <Package className="w-3 h-3" /> {t('settings.products')}
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
              className="h-9 text-sm"
            />
          </div>
          <div className="config-field">
            <Label className="config-label">{t('settings.companyOptional')}</Label>
            <Input
              type="text"
              placeholder={t('settings.companyPlaceholder')}
              value={config.senderAddress.company || ''}
              onChange={e => onUpdateSenderAddress({ company: e.target.value })}
              className="h-9 text-sm"
            />
          </div>
          <div className="config-field">
            <Label className="config-label">{t('settings.streetNumber')}</Label>
            <Input
              type="text"
              placeholder={t('address.streetPlaceholder')}
              value={config.senderAddress.street}
              onChange={e => onUpdateSenderAddress({ street: e.target.value })}
              className="h-9 text-sm"
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
                className="h-9 text-sm"
              />
            </div>
            <div className="config-field col-span-2">
              <Label className="config-label">{t('address.city')}</Label>
              <Input
                type="text"
                placeholder={t('address.cityPlaceholder')}
                value={config.senderAddress.city}
                onChange={e => onUpdateSenderAddress({ city: e.target.value })}
                className="h-9 text-sm"
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
              className="h-9 text-sm"
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
                value={config.printerConfig.paperFormatId ? String(config.printerConfig.paperFormatId) : ''}
                onValueChange={value => {
                  const fmt = paperFormats.find(f => f.id === parseInt(value));
                  onUpdatePrinterConfig({ paperFormatName: fmt?.name ?? '', paperFormatId: parseInt(value) });
                }}
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder={t('settings.selectPaperFormat')} />
                </SelectTrigger>
                <SelectContent>
                  {paperFormats.map(format => (
                    <SelectItem key={format.id} value={String(format.id)}>
                      {format.name}
                    </SelectItem>
                  ))}
                </SelectContent>
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
              value={config.printerConfig.orientation}
              onValueChange={(value: 'portrait' | 'landscape') =>
                onUpdatePrinterConfig({ orientation: value })
              }
            >
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder={t('settings.orientation')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="portrait">{t('settings.portrait')}</SelectItem>
                <SelectItem value="landscape">{t('settings.landscape')}</SelectItem>
              </SelectContent>
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
                  value={config.printerConfig.paperWidthMm ?? 62}
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
                  value={config.printerConfig.paperHeightMm ?? 100}
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
                checked={config.printerConfig.endlessRoll ?? true}
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
                value={config.printerConfig.cupsUrl || ''}
                onChange={e => onUpdatePrinterConfig({ cupsUrl: e.target.value })}
                className="h-9 text-sm"
              />
            </div>
            
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox
                checked={config.printerConfig.enableDirectPrint || false}
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
                checked={config.printerConfig.disableCropping || false}
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
                      value={config.printerConfig.cropMarginTop ?? 5}
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
                      value={config.printerConfig.cropMarginLeft ?? 5}
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
                      value={config.printerConfig.cropMarginRight ?? 5}
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
                      value={config.printerConfig.cropMarginBottom ?? 5}
                      onChange={e => onUpdatePrinterConfig({ cropMarginBottom: parseInt(e.target.value) || 0 })}
                      className="h-9 text-sm text-center"
                    />
                  </div>
                  <div />
                </div>
                
                <DimensionsPreview 
                  cropTop={config.printerConfig.cropMarginTop ?? 5}
                  cropRight={config.printerConfig.cropMarginRight ?? 5}
                  cropBottom={config.printerConfig.cropMarginBottom ?? 5}
                  cropLeft={config.printerConfig.cropMarginLeft ?? 5}
                  disableCropping={config.printerConfig.disableCropping || false}
                />
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
                const isExcluded = (config.favoriteProducts || []).includes(product.code);
                return (
                  <label key={product.code} className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      checked={!isExcluded}
                      onCheckedChange={() => toggleFavorite(product.code)}
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
                const isExcluded = (config.favoriteProducts || []).includes(product.code);
                return (
                  <label key={product.code} className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      checked={!isExcluded}
                      onCheckedChange={() => toggleFavorite(product.code)}
                    />
                    <span className="text-sm">{product.name}</span>
                    <span className="text-xs text-muted-foreground">{product.cost.toFixed(2)}€</span>
                  </label>
                );
              })}
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
