import { useState } from 'react';
import { Settings, User, Printer, Package, Lock, ChevronDown, ChevronRight } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { AppConfig, PAPER_FORMATS, ShippingProduct } from '@/types/shipping';

interface SettingsPanelProps {
  config: AppConfig;
  products: ShippingProduct[];
  onUpdateApiCredentials: (creds: Partial<AppConfig['apiCredentials']>) => void;
  onUpdatePrinterConfig: (printer: Partial<AppConfig['printerConfig']>) => void;
  onUpdateSenderAddress: (address: Partial<AppConfig['senderAddress']>) => void;
  onUpdateFavoriteProducts: (favorites: string[]) => void;
}

export function SettingsPanel({
  config,
  products,
  onUpdateApiCredentials,
  onUpdatePrinterConfig,
  onUpdateSenderAddress,
  onUpdateFavoriteProducts
}: SettingsPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  
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
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <CollapsibleTrigger className="w-full flex items-center justify-between p-3 hover:bg-muted/50 transition-colors">
          <div className="flex items-center gap-2">
            <Settings className="w-4 h-4 text-primary" />
            <span className="font-semibold text-sm">Settings</span>
          </div>
          {isOpen ? (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          )}
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="p-4 pt-0">
            <Tabs defaultValue="api" className="w-full">
              <TabsList className="w-full grid grid-cols-4 mb-4">
                <TabsTrigger value="api" className="text-xs gap-1">
                  <Lock className="w-3 h-3" />
                  API
                </TabsTrigger>
                <TabsTrigger value="sender" className="text-xs gap-1">
                  <User className="w-3 h-3" />
                  Sender
                </TabsTrigger>
                <TabsTrigger value="printer" className="text-xs gap-1">
                  <Printer className="w-3 h-3" />
                  Printer
                </TabsTrigger>
                <TabsTrigger value="products" className="text-xs gap-1">
                  <Package className="w-3 h-3" />
                  Products
                </TabsTrigger>
              </TabsList>

              <TabsContent value="api" className="space-y-3 mt-0">
                <div className="config-field">
                  <Label className="config-label">API Key</Label>
                  <Input 
                    type="text" 
                    placeholder="Partner ID / API Key" 
                    value={config.apiCredentials.apiKey} 
                    onChange={e => onUpdateApiCredentials({ apiKey: e.target.value })} 
                    className="h-9 text-sm" 
                  />
                </div>
                <div className="config-field">
                  <Label className="config-label">API Secret</Label>
                  <Input 
                    type="password" 
                    placeholder="Partner Secret" 
                    value={config.apiCredentials.apiSecret} 
                    onChange={e => onUpdateApiCredentials({ apiSecret: e.target.value })} 
                    className="h-9 text-sm" 
                  />
                </div>
                <div className="config-field">
                  <Label className="config-label">Portokasse Login</Label>
                  <Input 
                    type="text" 
                    placeholder="Email / Username" 
                    value={config.apiCredentials.portokasseLogin} 
                    onChange={e => onUpdateApiCredentials({ portokasseLogin: e.target.value })} 
                    className="h-9 text-sm" 
                  />
                </div>
                <div className="config-field">
                  <Label className="config-label">Portokasse Password</Label>
                  <Input 
                    type="password" 
                    placeholder="Password" 
                    value={config.apiCredentials.portokassePassword} 
                    onChange={e => onUpdateApiCredentials({ portokassePassword: e.target.value })} 
                    className="h-9 text-sm" 
                  />
                </div>
              </TabsContent>

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

              <TabsContent value="printer" className="space-y-3 mt-0">
                <div className="config-field">
                  <Label className="config-label">Paper Format</Label>
                  <Select 
                    value={config.printerConfig.paperFormat} 
                    onValueChange={value => onUpdatePrinterConfig({ paperFormat: value })}
                  >
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="Select format" />
                    </SelectTrigger>
                    <SelectContent>
                      {PAPER_FORMATS.map(format => (
                        <SelectItem key={format.id} value={format.id}>
                          {format.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="config-field">
                  <Label className="config-label">Orientation</Label>
                  <Select 
                    value={config.printerConfig.orientation} 
                    onValueChange={(value: 'portrait' | 'landscape') => onUpdatePrinterConfig({ orientation: value })}
                  >
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="Select orientation" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="portrait">Portrait</SelectItem>
                      <SelectItem value="landscape">Landscape</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="config-field">
                  <Label className="config-label">Printer Name</Label>
                  <Input 
                    type="text" 
                    placeholder="DYMO LabelWriter 450" 
                    value={config.printerConfig.printerName} 
                    onChange={e => onUpdatePrinterConfig({ printerName: e.target.value })} 
                    className="h-9 text-sm" 
                  />
                </div>
                <p className="text-xs text-muted-foreground bg-muted/50 p-2 rounded">
                  <strong>Note:</strong> Printer selection uses the browser's print dialog. 
                  The printer name here is for reference only.
                </p>
              </TabsContent>

              <TabsContent value="products" className="space-y-4 mt-0">
                <p className="text-xs text-muted-foreground">
                  Select products to show on the main screen
                </p>
                
                <div>
                  <Label className="config-label mb-2 block">Domestic (DE)</Label>
                  <div className="space-y-2">
                    {domesticProducts.map(product => (
                      <label key={product.code} className="flex items-center gap-2 cursor-pointer">
                        <Checkbox 
                          checked={(config.favoriteProducts || []).includes(product.code)} 
                          onCheckedChange={() => toggleFavorite(product.code)} 
                        />
                        <span className="text-sm">{product.name}</span>
                        <span className="text-xs text-muted-foreground">{product.cost.toFixed(2)}€</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <Label className="config-label mb-2 block">International</Label>
                  <div className="space-y-2">
                    {internationalProducts.map(product => (
                      <label key={product.code} className="flex items-center gap-2 cursor-pointer">
                        <Checkbox 
                          checked={(config.favoriteProducts || []).includes(product.code)} 
                          onCheckedChange={() => toggleFavorite(product.code)} 
                        />
                        <span className="text-sm">{product.name}</span>
                        <span className="text-xs text-muted-foreground">{product.cost.toFixed(2)}€</span>
                      </label>
                    ))}
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
