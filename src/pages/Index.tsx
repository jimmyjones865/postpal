import { useState } from 'react';
import { Printer, AlertCircle, History, Mail, Settings } from 'lucide-react';
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
import { TrackingNumber } from '@/components/TrackingNumber';
import { validateAddress } from '@/lib/addressValidation';
import { saveLabel } from '@/lib/labelStorage';
import { ParsedAddress, emptyAddress } from '@/lib/addressParser';
import { getCountryCode } from '@/lib/countryCodes';
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
    updateFavoriteProducts
  } = useConfig();
  const { products, isLoading: productsLoading } = useProducts();
  const {
    labels,
    isLoading: labelsLoading,
    error: labelsError,
    refresh: refreshLabels,
    removeLabel,
    addLabel
  } = useLabelHistory();
  
  const [recipientAddress, setRecipientAddress] = useState('');
  const [parsedRecipient, setParsedRecipient] = useState<ParsedAddress>(emptyAddress());
  const [selectedProduct, setSelectedProduct] = useState<string | null>(null);
  const [isPrinting, setIsPrinting] = useState(false);
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [trackingNumber, setTrackingNumber] = useState<string | null>(null);
  
  const validation = validateAddress(recipientAddress);
  const canPrint = isConfigured && !!recipientAddress.trim() && !!selectedProduct && validation.isValid;
  
  const selectedProductData = products.find(p => p.code === selectedProduct) || null;

  const handleProductSelect = (productCode: string) => {
    setSelectedProduct(productCode);
    // Clear tracking number when selecting a new product
    setTrackingNumber(null);
  };

  const handlePrint = async () => {
    if (!isConfigured) {
      toast({
        title: 'Configuration Required',
        description: 'Please complete the API and sender address configuration.',
        variant: 'destructive'
      });
      return;
    }

    const product = products.find(p => p.code === selectedProduct);
    // walletBalance is in cents from API, product.cost is in EUR
    const productCostInCents = product ? Math.round(product.cost * 100) : 0;
    if (product && walletBalance !== null && walletBalance < productCostInCents) {
      toast({
        title: 'Insufficient Balance',
        description: `Wallet balance (${(walletBalance / 100).toFixed(2)}€) is too low for this product (${product.cost.toFixed(2)}€).`,
        variant: 'destructive'
      });
      return;
    }
    
    if (!recipientAddress.trim()) {
      toast({
        title: 'Address Required',
        description: 'Please enter a recipient address.',
        variant: 'destructive'
      });
      return;
    }
    
    if (!validation.isValid) {
      toast({
        title: 'Address Invalid',
        description: 'Please fix the address validation errors before printing.',
        variant: 'destructive'
      });
      return;
    }
    
    if (!selectedProduct) {
      toast({
        title: 'Product Required',
        description: 'Please select a shipping product.',
        variant: 'destructive'
      });
      return;
    }
    
    setIsPrinting(true);
    try {
      const API_BASE = import.meta.env.VITE_API_URL || '/api';
      
      // Build receiver object from parsed address
      const receiver = {
        name: parsedRecipient.name,
        additionalName: parsedRecipient.additionalName || undefined,
        addressLine1: parsedRecipient.street,
        addressLine2: parsedRecipient.addressLine2 || undefined,
        postalCode: parsedRecipient.zip,
        city: parsedRecipient.city,
        country: getCountryCode(parsedRecipient.country)
      };
      
      // Convert sender country to ISO code
      const senderCountryCode = getCountryCode(config.senderAddress.country) || config.senderAddress.country;
      
      // Call the purchase API
      const purchaseResponse = await fetch(`${API_BASE}/labels/purchase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          credentials: {
            portokasseLogin: config.apiCredentials.portokasseLogin,
            portokassePassword: config.apiCredentials.portokassePassword,
            apiKey: config.apiCredentials.apiKey,
            apiSecret: config.apiCredentials.apiSecret
          },
          sender: {
            name: config.senderAddress.name,
            additionalName: config.senderAddress.company || undefined,
            addressLine1: config.senderAddress.street,
            postalCode: config.senderAddress.postalCode,
            city: config.senderAddress.city,
            country: senderCountryCode
          },
          receiver,
          productCode: selectedProduct,
          priceInCents: productCostInCents,

          paperFormatName: config.printerConfig.paperFormatName,

        })
      });
      
      const purchaseData = await purchaseResponse.json();
      
      // Check for errors - the API should return success: true only on HTTP 200
      if (!purchaseResponse.ok || !purchaseData.success) {
        console.error('Label purchase failed:', purchaseData);
        toast({
          title: 'Purchase Failed',
          description: purchaseData.error || purchaseData.details || 'Failed to purchase label from Deutsche Post.',
          variant: 'destructive'
        });
        return;
      }
      
      console.log('Label purchased successfully:', purchaseData);
      
      // Update tracking number if provided
      if (purchaseData.trackingNumber) {
        setTrackingNumber(purchaseData.trackingNumber);
      }
      
      // Update wallet balance if returned
      if (purchaseData.newBalance !== undefined) {
        setWalletBalance(purchaseData.newBalance);
      }

      // Save the label to storage (original, uncropped PDF)
      try {
        // If we have a PDF URL, fetch it via our proxy (WITHOUT cropping) and convert to base64
        let pdfBase64 = '';
        if (purchaseData.pdfUrl) {
          try {
            // Fetch original PDF without cropping for storage
            const proxyUrl = `${API_BASE}/proxy-pdf?url=${encodeURIComponent(purchaseData.pdfUrl)}`;
            const pdfResponse = await fetch(proxyUrl);
            if (!pdfResponse.ok) {
              throw new Error(`PDF fetch failed: ${pdfResponse.status}`);
            }
            const pdfBlob = await pdfResponse.blob();
            pdfBase64 = await new Promise<string>((resolve) => {
              const reader = new FileReader();
              reader.onloadend = () => {
                const base64 = (reader.result as string).split(',')[1];
                resolve(base64);
              };
              reader.readAsDataURL(pdfBlob);
            });
          } catch (pdfError) {
            console.warn('Could not fetch PDF:', pdfError);
          }
        }
        
        const savedLabel = await saveLabel({
          pdfBase64,
          recipientAddress,
          productCode: selectedProduct,
          productName: product?.name || selectedProduct
        });
        addLabel(savedLabel);
        
        // Reset form after successful purchase
        setSelectedProduct(null);
        setRecipientAddress('');
        setParsedRecipient(emptyAddress());
        setTrackingNumber(null);
        
        toast({
          title: 'Label Purchased & Saved',
          description: `${product?.name} label ready to print.`
        });
      } catch (saveError) {
        console.warn('Could not save label to storage:', saveError);
        
        // Still reset form even if storage failed
        setSelectedProduct(null);
        setRecipientAddress('');
        setParsedRecipient(emptyAddress());
        setTrackingNumber(null);
        
        toast({
          title: 'Label Purchased',
          description: `${product?.name} label purchased. (Local storage unavailable)`
        });
      }
    } catch (error) {
      console.error('Label purchase error:', error);
      toast({
        title: 'Purchase Failed',
        description: error instanceof Error ? error.message : 'Failed to purchase label. Please try again.',
        variant: 'destructive'
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

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center">
              <Mail className="w-4 h-4 text-primary-foreground" />
            </div>
            <div>
              <h1 className="font-mono text-lg font-bold">Post Pal</h1>
              <p className="text-xs text-muted-foreground font-mono">Deutsche Post Labels</p>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <WalletBalance credentials={config.apiCredentials} onBalanceChange={setWalletBalance} />
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
        <Tabs defaultValue="create" className="w-full">
          <TabsList className="grid w-full max-w-lg grid-cols-3 mb-6">
            <TabsTrigger value="create">
              <Printer className="w-4 h-4 mr-2" />
              Create Label
            </TabsTrigger>
            <TabsTrigger value="history">
              <History className="w-4 h-4 mr-2" />
              History ({labels.length})
            </TabsTrigger>
            <TabsTrigger value="settings">
              <Settings className="w-4 h-4 mr-2" />
              Settings
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="create" className="space-y-6">

            {/* Main content: Paste Field - Address Fields - Preview */}
            <div className="grid lg:grid-cols-[1fr_280px_280px] gap-6">
              {/* Paste full address field */}
              <div className="bg-card border border-border rounded-lg p-4">
                <h3 className="text-sm font-medium mb-3">Paste Address</h3>
                <AddressInput 
                  value={recipientAddress} 
                  onChange={setRecipientAddress} 
                  onPrint={handlePrint} 
                  isPrinting={isPrinting} 
                  canPrint={canPrint} 
                />
              </div>

              {/* Address lines panel - always visible */}
              <div className="bg-card border border-border rounded-lg p-4">
                <h3 className="text-sm font-medium mb-3">Address Lines</h3>
                <ParsedAddressEditor 
                  rawAddress={recipientAddress} 
                  onAddressChange={setRecipientAddress}
                  onParsedChange={setParsedRecipient}
                />
              </div>

              {/* Preview */}
              <div className="space-y-0">
                <LabelPreview 
                  senderAddress={config.senderAddress} 
                  recipientAddress={recipientAddress} 
                  selectedProduct={selectedProductData} 
                />
                <TrackingNumber 
                  trackingNumber={trackingNumber}
                  isTracked={selectedProductData?.tracked || false}
                />
              </div>
            </div>

            {/* Product selector */}
            <div className="bg-card border border-border rounded-lg p-4">
              <h2 className="text-sm font-medium mb-4">Select Product</h2>
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
                printOptions={{
                  cropH: config.printerConfig.cropMarginHorizontal ?? 5,
                  cropV: config.printerConfig.cropMarginVertical ?? 5
                }}
              />
            </div>
          </TabsContent>
          
          <TabsContent value="settings">
            <SettingsPanel 
              config={config} 
              products={products} 
              onUpdatePrinterConfig={updatePrinterConfig} 
              onUpdateSenderAddress={updateSenderAddress} 
              onUpdateFavoriteProducts={updateFavoriteProducts} 
            />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default Index;
