import { Settings, User, Printer, Key, Package } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { AppConfig, PAPER_FORMATS, SHIPPING_PRODUCTS } from '@/types/shipping';

interface SettingsPanelProps {
  config: AppConfig;
  onUpdateApiCredentials: (creds: Partial<AppConfig['apiCredentials']>) => void;
  onUpdatePrinterConfig: (printer: Partial<AppConfig['printerConfig']>) => void;
  onUpdateSenderAddress: (address: Partial<AppConfig['senderAddress']>) => void;
  onUpdateFavoriteProducts: (favorites: string[]) => void;
}

export function SettingsPanel({
  config,
  onUpdateApiCredentials,
  onUpdatePrinterConfig,
  onUpdateSenderAddress,
  onUpdateFavoriteProducts,
}: SettingsPanelProps) {
  const domesticProducts = SHIPPING_PRODUCTS.filter((p) => p.type === 'domestic');
  const internationalProducts = SHIPPING_PRODUCTS.filter((p) => p.type === 'international');

  const toggleFavorite = (productId: string) => {
    const current = config.favoriteProducts || [];
    if (current.includes(productId)) {
      onUpdateFavoriteProducts(current.filter((id) => id !== productId));
    } else {
      onUpdateFavoriteProducts([...current, productId]);
    }
  };

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center gap-2 mb-4">
        <Settings className="w-4 h-4 text-primary" />
        <h2 className="font-semibold text-sm">Configuration</h2>
      </div>

      <Tabs defaultValue="api" className="w-full">
        <TabsList className="w-full grid grid-cols-4 mb-4">
          <TabsTrigger value="api" className="text-xs gap-1">
            <Key className="w-3 h-3" />
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
            <Label className="config-label">Username</Label>
            <Input
              type="text"
              placeholder="API Username"
              value={config.apiCredentials.username}
              onChange={(e) => onUpdateApiCredentials({ username: e.target.value })}
              className="h-9 text-sm"
            />
          </div>
          <div className="config-field">
            <Label className="config-label">Password</Label>
            <Input
              type="password"
              placeholder="API Password"
              value={config.apiCredentials.password}
              onChange={(e) => onUpdateApiCredentials({ password: e.target.value })}
              className="h-9 text-sm"
            />
          </div>
          <div className="config-field">
            <Label className="config-label">EKP Number</Label>
            <Input
              type="text"
              placeholder="EKP-Nummer"
              value={config.apiCredentials.ekp}
              onChange={(e) => onUpdateApiCredentials({ ekp: e.target.value })}
              className="h-9 text-sm"
            />
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Uses <a href="https://github.com/schaechinger/internetmarke" target="_blank" rel="noopener" className="text-primary hover:underline">internetmarke</a> library
          </p>
        </TabsContent>

        <TabsContent value="sender" className="space-y-3 mt-0">
          <div className="config-field">
            <Label className="config-label">Name</Label>
            <Input
              type="text"
              placeholder="Full Name"
              value={config.senderAddress.name}
              onChange={(e) => onUpdateSenderAddress({ name: e.target.value })}
              className="h-9 text-sm"
            />
          </div>
          <div className="config-field">
            <Label className="config-label">Company (optional)</Label>
            <Input
              type="text"
              placeholder="Company Name"
              value={config.senderAddress.company || ''}
              onChange={(e) => onUpdateSenderAddress({ company: e.target.value })}
              className="h-9 text-sm"
            />
          </div>
          <div className="config-field">
            <Label className="config-label">Street & Number</Label>
            <Input
              type="text"
              placeholder="Musterstraße 123"
              value={config.senderAddress.street}
              onChange={(e) => onUpdateSenderAddress({ street: e.target.value })}
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
                onChange={(e) => onUpdateSenderAddress({ postalCode: e.target.value })}
                className="h-9 text-sm"
              />
            </div>
            <div className="config-field col-span-2">
              <Label className="config-label">City</Label>
              <Input
                type="text"
                placeholder="Berlin"
                value={config.senderAddress.city}
                onChange={(e) => onUpdateSenderAddress({ city: e.target.value })}
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
              onChange={(e) => onUpdateSenderAddress({ country: e.target.value })}
              className="h-9 text-sm"
            />
          </div>
        </TabsContent>

        <TabsContent value="printer" className="space-y-3 mt-0">
          <div className="config-field">
            <Label className="config-label">Paper Format</Label>
            <Select
              value={config.printerConfig.paperFormat}
              onValueChange={(value) => onUpdatePrinterConfig({ paperFormat: value })}
            >
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="Select format" />
              </SelectTrigger>
              <SelectContent>
                {PAPER_FORMATS.map((format) => (
                  <SelectItem key={format.id} value={format.id}>
                    {format.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="config-field">
            <Label className="config-label">Printer Name</Label>
            <Input
              type="text"
              placeholder="DYMO LabelWriter 450"
              value={config.printerConfig.printerName}
              onChange={(e) => onUpdatePrinterConfig({ printerName: e.target.value })}
              className="h-9 text-sm"
            />
          </div>
        </TabsContent>

        <TabsContent value="products" className="space-y-4 mt-0">
          <p className="text-xs text-muted-foreground">
            Select products to show on the main screen
          </p>
          
          <div>
            <Label className="config-label mb-2 block">Domestic (DE)</Label>
            <div className="space-y-2">
              {domesticProducts.map((product) => (
                <label key={product.id} className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    checked={(config.favoriteProducts || []).includes(product.id)}
                    onCheckedChange={() => toggleFavorite(product.id)}
                  />
                  <span className="text-sm">{product.name}</span>
                  <span className="text-xs text-muted-foreground">{product.price}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <Label className="config-label mb-2 block">International</Label>
            <div className="space-y-2">
              {internationalProducts.map((product) => (
                <label key={product.id} className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    checked={(config.favoriteProducts || []).includes(product.id)}
                    onCheckedChange={() => toggleFavorite(product.id)}
                  />
                  <span className="text-sm">{product.name}</span>
                  <span className="text-xs text-muted-foreground">{product.price}</span>
                </label>
              ))}
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
