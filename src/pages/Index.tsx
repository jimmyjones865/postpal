import { useState } from 'react';
import { Printer, AlertCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useConfig } from '@/hooks/useConfig';
import { SettingsPanel } from '@/components/SettingsPanel';
import { ProductSelector } from '@/components/ProductSelector';
import { AddressInput } from '@/components/AddressInput';
import { LabelPreview } from '@/components/LabelPreview';
import { SHIPPING_PRODUCTS } from '@/types/shipping';

const Index = () => {
  const { toast } = useToast();
  const {
    config,
    isLoaded,
    isConfigured,
    updateApiCredentials,
    updatePrinterConfig,
    updateSenderAddress,
    updateFavoriteProducts,
  } = useConfig();

  const [recipientAddress, setRecipientAddress] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<string | null>(null);
  const [isPrinting, setIsPrinting] = useState(false);

  const canPrint = isConfigured && !!recipientAddress.trim() && !!selectedProduct;

  const handlePrint = async () => {
    if (!isConfigured) {
      toast({
        title: 'Configuration Required',
        description: 'Please complete the API and sender address configuration.',
        variant: 'destructive',
      });
      return;
    }

    if (!recipientAddress.trim()) {
      toast({
        title: 'Address Required',
        description: 'Please enter a recipient address.',
        variant: 'destructive',
      });
      return;
    }

    if (!selectedProduct) {
      toast({
        title: 'Product Required',
        description: 'Please select a shipping product.',
        variant: 'destructive',
      });
      return;
    }

    setIsPrinting(true);
    
    // Simulate API call - in production this would call Deutsche Post API
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    const product = SHIPPING_PRODUCTS.find(p => p.id === selectedProduct);
    toast({
      title: 'Label Generated',
      description: `${product?.name} label ready to print.`,
    });
    
    setIsPrinting(false);
  };

  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center">
              <Printer className="w-4 h-4 text-primary-foreground" />
            </div>
            <div>
              <h1 className="font-semibold">DP Labels</h1>
              <p className="text-xs text-muted-foreground">Deutsche Post Shipping</p>
            </div>
          </div>
          
          {!isConfigured && (
            <div className="flex items-center gap-2 text-xs text-amber-500">
              <AlertCircle className="w-4 h-4" />
              <span>Setup required</span>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6">
        <div className="grid lg:grid-cols-[320px_1fr] gap-6">
          {/* Sidebar */}
          <aside className="space-y-4">
            <SettingsPanel
              config={config}
              onUpdateApiCredentials={updateApiCredentials}
              onUpdatePrinterConfig={updatePrinterConfig}
              onUpdateSenderAddress={updateSenderAddress}
              onUpdateFavoriteProducts={updateFavoriteProducts}
            />
          </aside>

          {/* Main content */}
          <div className="space-y-6">
            <div className="grid md:grid-cols-2 gap-6">
              <AddressInput
                value={recipientAddress}
                onChange={setRecipientAddress}
                onPrint={handlePrint}
                isPrinting={isPrinting}
                canPrint={canPrint}
              />
              <LabelPreview
                senderAddress={config.senderAddress}
                recipientAddress={recipientAddress}
                selectedProduct={selectedProduct}
              />
            </div>

            <div className="bg-card border border-border rounded-lg p-4">
              <h2 className="section-title">Select Product</h2>
              <ProductSelector
                selectedProduct={selectedProduct}
                onSelect={setSelectedProduct}
                favoriteProducts={config.favoriteProducts || []}
              />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Index;
