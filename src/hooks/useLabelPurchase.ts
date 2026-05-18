import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { AppConfig, ShippingProduct } from '@/types/shipping';
import { ParsedAddress } from '@/lib/address';
import { StoredLabel } from '@/lib/labelStorage';
import { PrintMode } from '@/components/AddressInput';
import { validateAddress } from '@/lib/addressValidation';
import { getCountryCode } from '@/lib/countryCodes';
import { buildDirectPrintConfig, buildPrintOptions } from '@/lib/printConfig';
import { purchaseLabel, fetchPdfAsBase64, printLabelDirect, buildPrintParams, downloadLabel } from '@/services/labelService';
import { saveLabel } from '@/lib/labelStorage';
import { useTranslation } from '@/hooks/useTranslation';

interface PurchaseParams {
  parsedRecipient: ParsedAddress;
  selectedProduct: string | null;
  printMode: PrintMode;
  walletBalance: number | null;
  onSelectProduct: (code: string | null) => void;
  onBalanceUpdate: (balance: number) => void;
  onLabelSaved: (label: StoredLabel) => void;
}

export function useLabelPurchase(
  config: AppConfig,
  products: ShippingProduct[],
  isConfigured: boolean,
  recipientAddress: string,
) {
  const { t } = useTranslation();
  const [purchasedLabelId, setPurchasedLabelId] = useState<string | null>(null);
  const [voucherId, setVoucherId] = useState<string | null>(null);
  const [trackId, setTrackId] = useState<string | null>(null);
  const [isPrinting, setIsPrinting] = useState(false);

  useEffect(() => {
    setPurchasedLabelId(null);
    setVoucherId(null);
    setTrackId(null);
  }, [recipientAddress]);

  const purchase = async ({
    parsedRecipient,
    selectedProduct,
    printMode,
    walletBalance,
    onSelectProduct,
    onBalanceUpdate,
    onLabelSaved,
  }: PurchaseParams) => {
    if (!isConfigured) {
      toast.error(t('toast.configRequired'), { description: t('toast.configRequiredDesc') });
      return;
    }

    // Auto-select standard product when none is chosen
    let productToUse = selectedProduct;
    if (!productToUse) {
      const recipientCountry = getCountryCode(parsedRecipient.country) || '';
      const isDomestic = !recipientCountry || recipientCountry === 'DE' || recipientCountry === 'DEU';
      const defaultProduct = products.find(p => p.group === 'standard' && p.domestic === isDomestic);
      if (defaultProduct) {
        productToUse = defaultProduct.code;
        onSelectProduct(productToUse);
      } else {
        toast.error(t('toast.productRequired'), { description: t('toast.productRequiredDesc') });
        return;
      }
    }

    const product = products.find(p => p.code === productToUse);
    const productCostInCents = product ? Math.round(product.cost * 100) : 0;

    if (product && walletBalance !== null && walletBalance < productCostInCents) {
      toast.error(t('toast.insufficientBalance'), {
        description: t('toast.insufficientBalanceDesc', {
          balance: (walletBalance / 100).toFixed(2),
          cost: product.cost.toFixed(2),
        }),
      });
      return;
    }

    const validation = validateAddress(recipientAddress);
    if (!recipientAddress.trim()) {
      toast.error(t('toast.addressRequired'), { description: t('toast.addressRequiredDesc') });
      return;
    }
    if (!validation.isValid) {
      toast.error(t('toast.addressInvalid'), { description: t('toast.addressInvalidDesc') });
      return;
    }

    setIsPrinting(true);
    try {
      const senderCountryCode = getCountryCode(config.senderAddress.country) || config.senderAddress.country;

      const purchaseData = await purchaseLabel({
        sender: {
          name: config.senderAddress.name,
          additionalName: config.senderAddress.company || undefined,
          addressLine1: config.senderAddress.street,
          postalCode: config.senderAddress.postalCode,
          city: config.senderAddress.city,
          country: senderCountryCode,
        },
        receiver: {
          name: parsedRecipient.name,
          additionalName: parsedRecipient.additionalName || undefined,
          addressLine1: parsedRecipient.street,
          addressLine2: parsedRecipient.addressLine2 || undefined,
          postalCode: parsedRecipient.zip,
          city: parsedRecipient.city,
          country: getCountryCode(parsedRecipient.country) || '',
        },
        productCode: productToUse!,
        priceInCents: productCostInCents,
        pageFormatId: config.printerConfig.paperFormatId || 0,
      });

      if (!purchaseData.success) {
        console.error('Label purchase failed:', purchaseData);
        toast.error(t('toast.purchaseFailed'), {
          description: purchaseData.error || purchaseData.details || t('toast.purchaseFailedDesc'),
        });
        return;
      }

      if (purchaseData.newBalance !== undefined) {
        onBalanceUpdate(purchaseData.newBalance);
      }

      // Save original uncropped PDF to storage
      let savedLabel: StoredLabel | undefined;
      try {
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
          trackId: purchaseData.trackingNumber,
        });
        onLabelSaved(savedLabel);
        setPurchasedLabelId(savedLabel.id);
        setVoucherId(purchaseData.voucherId || null);
        setTrackId(purchaseData.trackingNumber || null);
      } catch (saveError) {
        console.warn('Could not save label to storage:', saveError);
      }

      const printOptions = buildPrintOptions(config.printerConfig);
      const directPrintConfig = buildDirectPrintConfig(config.printerConfig);

      if (printMode === 'print' && directPrintConfig.enableDirectPrint && directPrintConfig.cupsUrl && savedLabel) {
        try {
          await printLabelDirect(buildPrintParams(savedLabel.id, directPrintConfig, {
            top: printOptions.cropTop,
            right: printOptions.cropRight,
            bottom: printOptions.cropBottom,
            left: printOptions.cropLeft,
          }));
          toast.success(t('toast.labelPrinted'), { description: t('toast.labelPrintedDesc', { product: product?.name }) });
        } catch (printError) {
          console.error('Direct print failed:', printError);
          toast.error(t('toast.printFailed'), {
            description: printError instanceof Error ? printError.message : t('toast.printFailedDesc'),
          });
        }
      } else if (printMode === 'download' && savedLabel) {
        try {
          await downloadLabel(savedLabel.id, printOptions.cropTop, printOptions.cropRight, printOptions.cropBottom, printOptions.cropLeft);
          toast.success(t('toast.labelDownloaded'), { description: t('toast.labelDownloadedDesc', { product: product?.name }) });
        } catch {
          // Download failed but label is purchased — show success without download
          toast.success(t('toast.labelPurchased'), { description: t('toast.labelPurchasedDesc', { product: product?.name }) });
        }
      } else {
        toast.success(t('toast.labelPurchasedSaved'), { description: t('toast.labelPurchasedSavedDesc', { product: product?.name }) });
      }

      // Reset product selection to prevent accidental duplicate orders
      onSelectProduct(null);
    } catch (error) {
      console.error('Label purchase error:', error);
      toast.error(t('toast.purchaseFailed'), {
        description: error instanceof Error ? error.message : t('toast.purchaseFailedDesc'),
      });
    } finally {
      setIsPrinting(false);
    }
  };

  return { purchasedLabelId, voucherId, trackId, isPrinting, purchase };
}
