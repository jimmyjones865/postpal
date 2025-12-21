import { useState } from 'react';
import { Printer, AlertCircle, History } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useConfig } from '@/hooks/useConfig';
import { useProducts } from '@/hooks/useProducts';
import { useLabelHistory } from '@/hooks/useLabelHistory';
import { SettingsPanel } from '@/components/SettingsPanel';
import { ProductSelector } from '@/components/ProductSelector';
import { AddressInput } from '@/components/AddressInput';
import { LabelPreview } from '@/components/LabelPreview';
import { LabelHistory } from '@/components/LabelHistory';
import { ParsedAddressEditor } from '@/components/ParsedAddressEditor';
import { WalletBalance } from '@/components/WalletBalance';
import { validateAddress } from '@/lib/addressValidation';
import { saveLabel } from '@/lib/labelStorage';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

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

  const { products, isLoading: productsLoading } = useProducts();
  const { labels, isLoading: labelsLoading, error: labelsError, refresh: refreshLabels, removeLabel, addLabel } = useLabelHistory();

  const [recipientAddress, setRecipientAddress] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<string | null>(null);
  const [isPrinting, setIsPrinting] = useState(false);
  const [walletBalance, setWalletBalance] = useState<number | null>(null);

  const validation = validateAddress(recipientAddress);
  const canPrint = isConfigured && !!recipientAddress.trim() && !!selectedProduct && validation.isValid;

  const handleProductSelect = (productCode: string) => {
    setSelectedProduct(productCode);
  };

  const handlePrint = async () => {
    if (!isConfigured) {
      toast({
        title: 'Configuration Required',
        description: 'Please complete the API and sender address configuration.',
        variant: 'destructive',
      });
      return;
    }

    // Check wallet balance
    const product = products.find(p => p.code === selectedProduct);
    if (product && walletBalance !== null && walletBalance < product.cost) {
      toast({
        title: 'Insufficient Balance',
        description: `Wallet balance (${walletBalance.toFixed(2)}€) is too low for this product (${product.cost.toFixed(2)}€).`,
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

    if (!validation.isValid) {
      toast({
        title: 'Address Invalid',
        description: 'Please fix the address validation errors before printing.',
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
    
    try {
      // Simulate API call - in production this would call Deutsche Post API and get real PDF
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      const product = products.find(p => p.code === selectedProduct);
      
      // For now, create a placeholder PDF (base64 encoded)
      // In production, this would be the actual PDF from Deutsche Post API
      const placeholderPdf = btoa('PDF placeholder - replace with actual Deutsche Post PDF');
      
      // Save to storage
      try {
        const savedLabel = await saveLabel({
          pdfBase64: placeholderPdf,
          recipientAddress,
          productCode: selectedProduct,
          productName: product?.name || selectedProduct,
        });
        
        addLabel(savedLabel);
        
        toast({
          title: 'Label Generated & Saved',
          description: `${product?.name} label ready to print.`,
        });
      } catch (saveError) {
        // Storage might not be available (e.g., no backend running)
        console.warn('Could not save label to storage:', saveError);
        toast({
          title: 'Label Generated',
          description: `${product?.name} label ready. (Storage unavailable)`,
        });
      }
    } catch (error) {
      toast({
        title: 'Print Failed',
        description: 'Failed to generate label. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsPrinting(false);
    }
  };

  if (!isLoaded || productsLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  const selectedProductData = products.find(p => p.code === selectedProduct) || null;

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
          
          <div className="flex items-center gap-3">
            <WalletBalance onBalanceChange={setWalletBalance} />
            {!isConfigured && (
              <div className="flex items-center gap-2 text-xs text-amber-500">
                <AlertCircle className="w-4 h-4" />
                <span>Setup required</span>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6">
        <div className="grid lg:grid-cols-[320px_1fr] gap-6">
          {/* Sidebar */}
          <aside className="space-y-4">
            <SettingsPanel
              config={config}
              products={products}
              onUpdateApiCredentials={updateApiCredentials}
              onUpdatePrinterConfig={updatePrinterConfig}
              onUpdateSenderAddress={updateSenderAddress}
              onUpdateFavoriteProducts={updateFavoriteProducts}
            />
          </aside>

          {/* Main content */}
          <div className="space-y-6">
            <Tabs defaultValue="create" className="w-full">
              <TabsList className="grid w-full grid-cols-2 mb-4">
                <TabsTrigger value="create">
                  <Printer className="w-4 h-4 mr-2" />
                  Create Label
                </TabsTrigger>
                <TabsTrigger value="history">
                  <History className="w-4 h-4 mr-2" />
                  History ({labels.length})
                </TabsTrigger>
              </TabsList>
              
              <TabsContent value="create" className="space-y-6">
                <div className="grid md:grid-cols-2 gap-6">
                  <div className="space-y-3">
                    <AddressInput
                      value={recipientAddress}
                      onChange={setRecipientAddress}
                      onPrint={handlePrint}
                      isPrinting={isPrinting}
                      canPrint={canPrint}
                    />
                    <ParsedAddressEditor
                      rawAddress={recipientAddress}
                      onAddressChange={setRecipientAddress}
                    />
                  </div>
                  <LabelPreview
                    senderAddress={config.senderAddress}
                    recipientAddress={recipientAddress}
                    selectedProduct={selectedProductData}
                  />
                </div>

                <div className="bg-card border border-border rounded-lg p-4">
                  <h2 className="section-title">Select Product</h2>
                  <ProductSelector
                    products={products}
                    selectedProduct={selectedProduct}
                    onSelect={handleProductSelect}
                    onDoubleClick={handlePrint}
                    favoriteProducts={config.favoriteProducts || []}
                  />
                </div>
              </TabsContent>
              
              <TabsContent value="history">
                <div className="bg-card border border-border rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-4">
                    <History className="w-4 h-4 text-primary" />
                    <h2 className="font-semibold text-sm">Print History</h2>
                  </div>
                  <LabelHistory
                    labels={labels}
                    isLoading={labelsLoading}
                    error={labelsError}
                    onRefresh={refreshLabels}
                    onDelete={removeLabel}
                  />
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Index;
