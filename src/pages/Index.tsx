import { useState } from 'react';
import { AlertCircle, History, Mail, Settings } from 'lucide-react';
import { useConfig } from '@/hooks/useConfig';
import { useProducts } from '@/hooks/useProducts';
import { useLabelHistory } from '@/hooks/useLabelHistory';
import { useLabelPurchase } from '@/hooks/useLabelPurchase';
import { SettingsPanel } from '@/components/SettingsPanel';
import { ProductSelector } from '@/components/ProductSelector';
import { AddressInput, PrintMode } from '@/components/AddressInput';
import { LabelResult } from '@/components/LabelResult';
import { LabelHistory } from '@/components/LabelHistory';
import { ParsedAddressEditor } from '@/components/ParsedAddressEditor';
import { WalletBalance } from '@/components/WalletBalance';
import { validateAddress } from '@/lib/addressValidation';
import { ParsedAddress, emptyAddress } from '@/lib/address';
import { buildDirectPrintConfig, buildPrintOptions } from '@/lib/printConfig';
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
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [printMode, setPrintMode] = useState<PrintMode>('print');

  const { purchasedLabelId, voucherId, trackId, isPrinting, purchase } = useLabelPurchase(
    config, products, isConfigured, recipientAddress
  );

  const validation = validateAddress(recipientAddress);
  const canPrint = isConfigured && !!recipientAddress.trim() && !!selectedProduct && validation.isValid;

  const handlePrint = () => purchase({
    parsedRecipient,
    selectedProduct,
    printMode,
    walletBalance,
    onSelectProduct: setSelectedProduct,
    onBalanceUpdate: setWalletBalance,
    onLabelSaved: addLabel,
  });
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
              <h1 className="text-lg font-bold">{t('app.title')}</h1>
              <p className="text-xs text-muted-foreground">{t('app.subtitle')}</p>
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
              <ProductSelector products={products} selectedProduct={selectedProduct} onSelect={setSelectedProduct} onDoubleClick={handlePrint} favoriteProducts={config.favoriteProducts || []} />
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
