import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { AlertCircle, History, Mail, Settings } from 'lucide-react';
import { useConfig } from '@/hooks/useConfig';
import { useProducts } from '@/hooks/useProducts';
import { useLabelHistory } from '@/hooks/useLabelHistory';
import { SettingsPanel } from '@/components/SettingsPanel';
import { ProductSelector } from '@/components/ProductSelector';
import { AddressInput, PrintMode } from '@/components/AddressInput';
import { LabelResult } from '@/components/LabelResult';
import { LabelHistory } from '@/components/LabelHistory';
import { ParsedAddressEditor } from '@/components/ParsedAddressEditor';
import { WalletBalance } from '@/components/WalletBalance';
import { validateAddress } from '@/lib/addressValidation';
import { saveLabel } from '@/lib/labelStorage';
import { ParsedAddress, emptyAddress } from '@/lib/address';
import { getCountryCode } from '@/lib/countryCodes';
import { buildDirectPrintConfig, buildPrintOptions } from '@/lib/printConfig';
import { purchaseLabel, fetchPdfAsBase64, printLabelDirect, buildPrintParams, downloadLabel } from '@/services/labelService';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useTranslation } from '@/hooks/useTranslation';

const Index = () => {
  const { t } = useTranslation();
  const {
    config,
    isLoaded,
    isConfigured,
    updatePrinterConfig,
    updateSenderAddress,
    updateFavoriteProducts
  } = useConfig();
  const {
    products,
    isLoading: productsLoading
  } = useProducts();
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
  const [printMode, setPrintMode] = useState<PrintMode>('print');

  // Purchase result state
  const [purchasedLabelId, setPurchasedLabelId] = useState<string | null>(null);
  const [voucherId, setVoucherId] = useState<string | null>(null);
  const [trackId, setTrackId] = useState<string | null>(null);

  // Paper formats for image preview aspect ratio
  interface PaperFormat { name: string; pageLayout: { size: { x: number; y: number } } }
  const [paperFormats, setPaperFormats] = useState<PaperFormat[]>([]);
  useEffect(() => {
    fetch('/paper-formats.json').then(res => res.json()).then(data => {
      const all = Object.values(data).flat().filter(Boolean) as PaperFormat[];
      setPaperFormats(all);
    }).catch(() => {});
  }, []);

  // Clear purchase results when address changes
  useEffect(() => {
    setPurchasedLabelId(null);
    setVoucherId(null);
    setTrackId(null);
  }, [recipientAddress]);

  const validation = validateAddress(recipientAddress);
  const canPrint = isConfigured && !!recipientAddress.trim() && !!selectedProduct && validation.isValid;
  const selectedProductData = products.find(p => p.code === selectedProduct) || null;
  const handleProductSelect = (productCode: string) => {
    setSelectedProduct(productCode);
  };
  const handlePrint = async () => {
    if (!isConfigured) {
      toast.error(t('toast.configRequired'), {
        description: t('toast.configRequiredDesc')
      });
      return;
    }

    // Auto-select product if none selected (default to standard letter based on country)
    let productToUse = selectedProduct;
    if (!productToUse) {
      const recipientCountry = getCountryCode(parsedRecipient.country) || '';
      const isDomestic = !recipientCountry || recipientCountry === 'DE' || recipientCountry === 'DEU';

      // Find first standard letter product (domestic or international)
      const defaultProduct = products.find(p => p.group === 'standard' && p.domestic === isDomestic);
      if (defaultProduct) {
        productToUse = defaultProduct.code;
        setSelectedProduct(productToUse);
      } else {
        toast.error(t('toast.productRequired'), {
          description: t('toast.productRequiredDesc')
        });
        return;
      }
    }
    const product = products.find(p => p.code === productToUse);
    // walletBalance is in cents from API, product.cost is in EUR
    const productCostInCents = product ? Math.round(product.cost * 100) : 0;
    if (product && walletBalance !== null && walletBalance < productCostInCents) {
      toast.error(t('toast.insufficientBalance'), {
        description: t('toast.insufficientBalanceDesc', { 
          balance: (walletBalance / 100).toFixed(2), 
          cost: product.cost.toFixed(2) 
        })
      });
      return;
    }
    if (!recipientAddress.trim()) {
      toast.error(t('toast.addressRequired'), {
        description: t('toast.addressRequiredDesc')
      });
      return;
    }
    if (!validation.isValid) {
      toast.error(t('toast.addressInvalid'), {
        description: t('toast.addressInvalidDesc')
      });
      return;
    }
    setIsPrinting(true);
    try {
      // Build receiver object from parsed address
      const receiver = {
        name: parsedRecipient.name,
        additionalName: parsedRecipient.additionalName || undefined,
        addressLine1: parsedRecipient.street,
        addressLine2: parsedRecipient.addressLine2 || undefined,
        postalCode: parsedRecipient.zip,
        city: parsedRecipient.city,
        country: getCountryCode(parsedRecipient.country) || ''
      };

      // Convert sender country to ISO code
      const senderCountryCode = getCountryCode(config.senderAddress.country) || config.senderAddress.country;

      // Call the purchase API via service
      const purchaseData = await purchaseLabel({
        sender: {
          name: config.senderAddress.name,
          additionalName: config.senderAddress.company || undefined,
          addressLine1: config.senderAddress.street,
          postalCode: config.senderAddress.postalCode,
          city: config.senderAddress.city,
          country: senderCountryCode
        },
        receiver,
        productCode: productToUse!,
        priceInCents: productCostInCents,
        pageFormatId: config.printerConfig.paperFormatId || 0
      });

      // Check for errors
      if (!purchaseData.success) {
        console.error('Label purchase failed:', purchaseData);
        toast.error(t('toast.purchaseFailed'), {
          description: purchaseData.error || purchaseData.details || t('toast.purchaseFailedDesc')
        });
        return;
      }
      console.log('Label purchased successfully:', purchaseData);

      // Update wallet balance if returned
      if (purchaseData.newBalance !== undefined) {
        setWalletBalance(purchaseData.newBalance);
      }

      // Save the label to storage (original, uncropped PDF)
      let savedLabel;
      try {
        // If we have a PDF URL, fetch it via our proxy (WITHOUT cropping) and convert to base64
        let pdfBase64 = '';
        if (purchaseData.pdfUrl) {
          try {
            pdfBase64 = await fetchPdfAsBase64(purchaseData.pdfUrl);
          } catch (pdfError) {
            console.warn('Could not fetch PDF:', pdfError);
          }
        }
        savedLabel = await saveLabel({
          pdfBase64,
          recipientAddress,
          productCode: productToUse!,
          productName: product?.name || productToUse!,
          voucherId: purchaseData.voucherId,
          trackId: purchaseData.trackingNumber
        });
        addLabel(savedLabel);
        // Set purchase result state
        setPurchasedLabelId(savedLabel.id);
        setVoucherId(purchaseData.voucherId || null);
        setTrackId(purchaseData.trackingNumber || null);
      } catch (saveError) {
        console.warn('Could not save label to storage:', saveError);
      }

      // Handle print mode
      const printOptions = buildPrintOptions(config.printerConfig);
      const directPrintConfig = buildDirectPrintConfig(config.printerConfig);
      if (printMode === 'print' && directPrintConfig.enableDirectPrint && directPrintConfig.cupsUrl && savedLabel) {
        // Direct print via CUPS
        try {
          const printParams = buildPrintParams(savedLabel.id, directPrintConfig, {
            top: printOptions.cropTop,
            right: printOptions.cropRight,
            bottom: printOptions.cropBottom,
            left: printOptions.cropLeft
          });
          await printLabelDirect(printParams);
          toast.success(t('toast.labelPrinted'), {
            description: t('toast.labelPrintedDesc', { product: product?.name })
          });
        } catch (printError) {
          console.error('Direct print failed:', printError);
          toast.error(t('toast.printFailed'), {
            description: printError instanceof Error ? printError.message : t('toast.printFailedDesc')
          });
        }
      } else if (printMode === 'download' && savedLabel) {
        // Download the cropped PDF
        try {
          await downloadLabel(savedLabel.id, printOptions.cropTop, printOptions.cropRight, printOptions.cropBottom, printOptions.cropLeft);
          toast.success(t('toast.labelDownloaded'), {
            description: t('toast.labelDownloadedDesc', { product: product?.name })
          });
        } catch (downloadError) {
          console.warn('Download failed:', downloadError);
          toast.success(t('toast.labelPurchased'), {
            description: t('toast.labelPurchasedDesc', { product: product?.name })
          });
        }
      } else {
        toast.success(t('toast.labelPurchasedSaved'), {
          description: t('toast.labelPurchasedSavedDesc', { product: product?.name })
        });
      }

      // Reset product selection to prevent accidental duplicate orders
      setSelectedProduct(null);
    } catch (error) {
      console.error('Label purchase error:', error);
      toast.error(t('toast.purchaseFailed'), {
        description: error instanceof Error ? error.message : t('toast.purchaseFailedDesc')
      });
    } finally {
      setIsPrinting(false);
    }
  };
  if (!isLoaded || productsLoading) {
    return <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">{t('status.loading')}</div>
      </div>;
  }
  return <div className="min-h-screen bg-background">
      <header className="border-b border-border px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center">
              <Mail className="w-4 h-4 text-primary-foreground" />
            </div>
            <div>
              <h1 className="font-mono text-lg font-bold">{t('app.title')}</h1>
              <p className="text-xs text-muted-foreground font-mono">{t('app.subtitle')}</p>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <WalletBalance balance={walletBalance} onBalanceChange={setWalletBalance} />
            {!isConfigured && <div className="flex items-center gap-2 text-xs text-amber-500">
                <AlertCircle className="w-4 h-4" />
                <span>{t('status.setupRequired')}</span>
              </div>}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6">
        <Tabs defaultValue="create" className="w-full">
          <TabsList className="grid w-full max-w-lg grid-cols-3 mb-6">
            <TabsTrigger value="create">
              <Mail className="w-4 h-4 mr-2" />
              {t('nav.createLabel')}
            </TabsTrigger>
            <TabsTrigger value="history">
              <History className="w-4 h-4 mr-2" />
              {t('nav.history')} ({labels.length})
            </TabsTrigger>
            <TabsTrigger value="settings">
              <Settings className="w-4 h-4 mr-2" />
              {t('nav.settings')}
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="create" className="space-y-6">

            {/* Main content: Paste Field - Address Fields - Preview */}
            <div className="grid lg:grid-cols-[1fr_280px_280px] gap-6">
              {/* Paste full address field */}
              <div className="bg-card border border-border rounded-lg p-4">
                <h3 className="text-sm font-medium mb-3">{t('address.pasteAddress')}</h3>
                <AddressInput value={recipientAddress} onChange={setRecipientAddress} onPrint={handlePrint} isPrinting={isPrinting} canPrint={canPrint} printMode={printMode} onPrintModeChange={setPrintMode} />
              </div>

              {/* Address lines panel - always visible */}
              <div className="bg-card border border-border rounded-lg p-4">
                <h3 className="text-sm font-medium mb-3">{t('address.addressLines')}</h3>
                <ParsedAddressEditor rawAddress={recipientAddress} onAddressChange={setRecipientAddress} onParsedChange={setParsedRecipient} />
              </div>

              {/* Result panel */}
              <LabelResult parsedRecipient={parsedRecipient} purchasedLabelId={purchasedLabelId} voucherId={voucherId} trackId={trackId} printOptions={buildPrintOptions(config.printerConfig)} directPrintConfig={buildDirectPrintConfig(config.printerConfig)} />
            </div>

            {/* Product selector */}
            <div className="bg-card border border-border rounded-lg p-4">
              <h2 className="text-sm font-medium mb-4">{t('product.selectProduct')}</h2>
              <ProductSelector products={products} selectedProduct={selectedProduct} onSelect={handleProductSelect} onDoubleClick={handlePrint} favoriteProducts={config.favoriteProducts || []} />
            </div>
          </TabsContent>
          
          <TabsContent value="history">
            <div className="bg-card border border-border rounded-lg p-4">
              <div className="flex items-center gap-2 mb-4">
                <History className="w-4 h-4 text-primary" />
                <h2 className="font-semibold text-sm">{t('history.printHistory')}</h2>
              </div>
              <LabelHistory labels={labels} isLoading={labelsLoading} error={labelsError} onRefresh={refreshLabels} onDelete={removeLabel} printOptions={buildPrintOptions(config.printerConfig)} directPrintConfig={buildDirectPrintConfig(config.printerConfig)} />
            </div>
          </TabsContent>
          
          <TabsContent value="settings">
            <SettingsPanel config={config} products={products} onUpdatePrinterConfig={updatePrinterConfig} onUpdateSenderAddress={updateSenderAddress} onUpdateFavoriteProducts={updateFavoriteProducts} />
          </TabsContent>
        </Tabs>
      </main>
    </div>;
};
export default Index;
