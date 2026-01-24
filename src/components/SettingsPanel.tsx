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
        <h2 className="font-semibold text-sm">Settings</h2>
      </div>

      <Tabs defaultValue="sender" className="w-full">
        <TabsList className="w-full grid grid-cols-3 mb-4">
          <TabsTrigger value="sender" className="text-xs gap-1">
            <User className="w-3 h-3" /> Sender
          </TabsTrigger>
          <TabsTrigger value="printer" className="text-xs gap-1">
            <Printer className="w-3 h-3" /> Printer
          </TabsTrigger>
          <TabsTrigger value="products" className="text-xs gap-1">
            <Package className="w-3 h-3" /> Products
          </TabsTrigger>
        </TabsList>

        {/* ----- SENDER TAB ----- */}
        <TabsContent value="sender" className="space-y-3 mt-0">
          <div className="config-field">
            <Label className="config-label">Name</Label>
            <Input 
              type="text"
              placeholder="Full Name"
              value={config.senderAddress.name}
              onChange={e => onUpdateSenderAddress({ name: e.target.value })}
              className="h-9 text-sm"
            />
          </div>
          <div className="config-field">
            <Label className="config-label">Company (optional)</Label>
            <Input
              type="text"
              placeholder="Company Name"
              value={config.senderAddress.company || ''}
              onChange={e => onUpdateSenderAddress({ company: e.target.value })}
              className="h-9 text-sm"
            />
          </div>
          <div className="config-field">
            <Label className="config-label">Street & Number</Label>
            <Input
              type="text"
              placeholder="Musterstraße 123"
              value={config.senderAddress.street}
              onChange={e => onUpdateSenderAddress({ street: e.target.value })}
              className="h-9 text-sm"
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="config-field">
              <Label className="config-label">Postal Code</Label>
              <Input
                type="text"
                placeholder="12345"
                value={config.senderAddress.postalCode}
                onChange={e => onUpdateSenderAddress({ postalCode: e.target.value })}
                className="h-9 text-sm"
              />
            </div>
            <div className="config-field col-span-2">
              <Label className="config-label">City</Label>
              <Input
                type="text"
                placeholder="Berlin"
                value={config.senderAddress.city}
                onChange={e => onUpdateSenderAddress({ city: e.target.value })}
                className="h-9 text-sm"
              />
            </div>
          </div>
          <div className="config-field">
            <Label className="config-label">Country</Label>
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
            <Label className="config-label">Paper Format</Label>
            {paperFormatsError ? (
              <p className="text-xs text-destructive">{paperFormatsError}</p>
            ) : (
              <Select
                value={config.printerConfig.paperFormatName || ''}
                onValueChange={value =>
                  onUpdatePrinterConfig({ paperFormatName: value })
                }
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Select paper format" />
                </SelectTrigger>
                <SelectContent>
                  {paperFormats.map(format => (
                    <SelectItem key={format.id} value={format.name}>
                      {format.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {(() => {
              const selected = paperFormats.find(
                f => f.name === config.printerConfig.paperFormatName
              );
              if (!selected) return null;

              const isRoll = selected.roll?.endless;

              return (
                <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
                  <div>{selected.description}</div>
                  {isRoll ? (
                    <div>
                      Endless roll · Width {selected.roll!.widthMm} mm
                    </div>
                  ) : (
                    <div>
                      Sheet {selected.pageLayout.size.x}×
                      {selected.pageLayout.size.y} mm ·{' '}
                      {selected.pageLayout.labelCount?.labelX ?? 1}×
                      {selected.pageLayout.labelCount?.labelY ?? 1} labels
                    </div>
                  )}
                </div>
              );
            })()}
          </div>

          <div className="config-field">
            <Label className="config-label">Orientation</Label>
            <Select
              value={config.printerConfig.orientation}
              onValueChange={(value: 'portrait' | 'landscape') =>
                onUpdatePrinterConfig({ orientation: value })
              }
            >
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="Select orientation" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="portrait">Portrait</SelectItem>
                <SelectItem value="landscape">Landscape</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
              Use Landscape to rotate labels 90° for narrow rolls.
            </p>
          </div>

          {/* Paper Size Section */}
          <div className="border-t border-border pt-3 mt-3">
            <Label className="config-label mb-2 block">
              Paper Size
            </Label>
            
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div className="config-field">
                <Label className="config-label text-xs">Paper width (mm)</Label>
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
                <Label className="config-label text-xs">Paper height (mm)</Label>
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
              <span className="text-sm">Endless roll (height from content)</span>
            </label>
            
            <p className="text-xs text-muted-foreground mt-2">
              When using endless roll, height is calculated automatically from the cropped label content.
            </p>
          </div>

          {/* CUPS Direct Printing Section */}
          <div className="border-t border-border pt-3 mt-3">
            <Label className="config-label mb-2 block">
              Direct Printing (CUPS)
            </Label>
            
            <div className="config-field mb-3">
              <Label className="config-label text-xs">CUPS Server URL</Label>
              <Input
                type="text"
                placeholder="http://192.168.1.100:631"
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
              <span className="text-sm">Enable direct print to CUPS</span>
            </label>
            
            <p className="text-xs text-muted-foreground mt-2">
              When enabled, labels will be sent directly to the CUPS server via IPP protocol without opening the browser print dialog.
            </p>
          </div>

          <div className="config-field">
            <Label className="config-label">Printer Name</Label>
            <Input
              type="text"
              placeholder="DYMO_LabelWriter_450"
              value={config.printerConfig.printerName}
              onChange={e => onUpdatePrinterConfig({ printerName: e.target.value })}
              className="h-9 text-sm"
            />
            <p className="text-xs text-muted-foreground mt-1">
              The printer queue name as shown in CUPS (e.g., DYMO_LabelWriter_450)
            </p>
          </div>

          <div className="border-t border-border pt-3 mt-3">
            <Label className="config-label mb-2 block">
              Label Cropping (minimize paper usage)
            </Label>
            
            <label className="flex items-center gap-2 cursor-pointer mb-3">
              <Checkbox
                checked={config.printerConfig.disableCropping || false}
                onCheckedChange={checked => 
                  onUpdatePrinterConfig({ disableCropping: checked === true })
                }
              />
              <span className="text-sm">Disable cropping (use original PDF)</span>
            </label>
            
            {!config.printerConfig.disableCropping && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="config-field">
                    <Label className="config-label text-xs">Horizontal Margin (mm)</Label>
                    <Input
                      type="number"
                      min={0}
                      max={50}
                      value={config.printerConfig.cropMarginHorizontal ?? 5}
                      onChange={e =>
                        onUpdatePrinterConfig({ cropMarginHorizontal: parseInt(e.target.value) || 0 })
                      }
                      className="h-9 text-sm"
                    />
                  </div>
                  <div className="config-field">
                    <Label className="config-label text-xs">Vertical Margin (mm)</Label>
                    <Input
                      type="number"
                      min={0}
                      max={50}
                      value={config.printerConfig.cropMarginVertical ?? 5}
                      onChange={e =>
                        onUpdatePrinterConfig({ cropMarginVertical: parseInt(e.target.value) || 0 })
                      }
                      className="h-9 text-sm"
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Crops whitespace from labels, keeping the specified margins around the content.
                </p>
                
                <DimensionsPreview 
                  cropH={config.printerConfig.cropMarginHorizontal ?? 5}
                  cropV={config.printerConfig.cropMarginVertical ?? 5}
                  disableCropping={config.printerConfig.disableCropping || false}
                />
              </>
            )}
          </div>
        </TabsContent>

        {/* ----- PRODUCTS TAB ----- */}
        <TabsContent value="products" className="space-y-4 mt-0">
          <p className="text-xs text-muted-foreground">
            Uncheck products to hide them from the main screen
          </p>

          <div>
            <Label className="config-label mb-2 block">Domestic (DE)</Label>
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
            <Label className="config-label mb-2 block">International</Label>
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
