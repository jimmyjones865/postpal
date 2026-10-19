import { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { AppConfig, ShippingProduct } from '@/types/shipping';
import { ParsedAddress } from '@/lib/address';
import { PrintMode } from '@/components/AddressInput';
import { validateAddress } from '@/lib/addressValidation';
import { getCountryCode } from '@/lib/countryCodes';
import { StoredLabel, purchaseLabel, printLabel, downloadLabel } from '@/services/labelService';
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
  // Double-click / Ctrl+Enter bypass the disabled button; a ref blocks re-entry before state updates land
  const inFlight = useRef(false);

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
    if (inFlight.current) return;
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

    const senderCountry = getCountryCode(config.senderAddress.country);
    const receiverCountry = getCountryCode(parsedRecipient.country);
    if (!senderCountry || !receiverCountry) {
      toast.error(t('toast.countryUnknown'), {
        description: t('toast.countryUnknownDesc', {
          country: senderCountry ? parsedRecipient.country : config.senderAddress.country,
        }),
      });
      return;
    }

    inFlight.current = true;
    setIsPrinting(true);
    try {
      const purchaseData = await purchaseLabel({
        sender: {
          name: config.senderAddress.name,
          additionalName: config.senderAddress.company || undefined,
          addressLine1: config.senderAddress.street,
          postalCode: config.senderAddress.postalCode,
          city: config.senderAddress.city,
          country: senderCountry,
        },
        receiver: {
          name: parsedRecipient.name,
          additionalName: parsedRecipient.additionalName || undefined,
          addressLine1: parsedRecipient.street,
          addressLine2: parsedRecipient.addressLine2 || undefined,
          postalCode: parsedRecipient.zip,
          city: parsedRecipient.city,
          country: receiverCountry,
        },
        productCode: productToUse!,
        productName: product?.name || productToUse!,
        priceInCents: productCostInCents,
        pageFormatId: config.printerConfig.paperFormatId,
        recipientAddress,
      });

      if (purchaseData.newBalance !== undefined) {
        onBalanceUpdate(purchaseData.newBalance);
      }

      if (!purchaseData.success || !purchaseData.label) {
        console.error('Label purchase failed:', purchaseData);
        if (purchaseData.paid) onSelectProduct(null);
        toast.error(t('toast.purchaseFailed'), {
          description: [purchaseData.error, purchaseData.details].filter(Boolean).join(' — ') || t('toast.purchaseFailedDesc'),
          duration: Infinity,
        });
        return;
      }

      const savedLabel = purchaseData.label;
      onLabelSaved(savedLabel);
      setPurchasedLabelId(savedLabel.id);
      setVoucherId(savedLabel.voucherId || null);
      setTrackId(savedLabel.trackId || null);

      if (printMode === 'print' && config.printerConfig.enableDirectPrint && config.printerConfig.cupsUrl) {
        try {
          await printLabel(savedLabel.id, config.printerConfig);
          toast.success(t('toast.labelPrinted'), { description: t('toast.labelPrintedDesc', { product: product?.name }) });
        } catch (printError) {
          console.error('Direct print failed:', printError);
          toast.error(t('toast.printFailed'), {
            description: printError instanceof Error ? printError.message : t('toast.printFailedDesc'),
          });
        }
      } else if (printMode === 'download') {
        try {
          await downloadLabel(savedLabel.id, config.printerConfig);
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
      inFlight.current = false;
      setIsPrinting(false);
    }
  };

  return { purchasedLabelId, voucherId, trackId, isPrinting, purchase };
}
