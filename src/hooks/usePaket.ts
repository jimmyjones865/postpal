import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ShippingProduct } from '@/types/shipping';
import { ParsedAddress } from '@/lib/address';
import { validateAddress } from '@/lib/addressValidation';
import { getCountryCode } from '@/lib/countryCodes';
import { PaketProduct, createPaketOrder, getPaketProducts } from '@/services/labelService';
import { useTranslation } from '@/hooks/useTranslation';

export const PAKET_PREFIX = 'paket:';
export const isPaketCode = (code: string | null) => !!code?.startsWith(PAKET_PREFIX);
export const paketCode = (p: PaketProduct) => `${PAKET_PREFIX}${p.productId}${p.insurance ? `.${p.insurance}` : ''}`;

/** DHL Paket products for the parsed country (catalog prices) + manual order → DHL checkout in a new tab. */
export function usePaket(parsedCountry: string) {
  const { t } = useTranslation();
  const country = parsedCountry.trim() ? getCountryCode(parsedCountry) : 'DEU';
  // undefined = loading, null = catalog unavailable
  const [list, setList] = useState<PaketProduct[] | null | undefined>(undefined);
  const [isOrdering, setIsOrdering] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    if (!country) return;
    let alive = true;
    setList(undefined);
    getPaketProducts(country)
      .then(p => alive && setList(p))
      .catch(() => alive && setList(null));
    return () => { alive = false; };
  }, [country]);

  const products: ShippingProduct[] = useMemo(() => (list || []).map(p => ({
    code: paketCode(p),
    name: p.name,
    cost: p.price,
    domestic: country === 'DEU',
    maxWeight: 0,
    group: 'standard',
  })), [list, country]);

  const note = !country ? t('product.paketUnknownCountry', { country: parsedCountry })
    : list === null ? t('product.paketUnavailable')
    : list?.length === 0 ? t('product.paketNotServed')
    : list === undefined ? t('status.loading')
    : undefined;

  /** Window opened before the await: a popup opened after it is blocked. Resolves true when the order exists. */
  const order = async (code: string, parsed: ParsedAddress, recipientAddress: string, email = ''): Promise<boolean> => {
    if (inFlight.current) return false;
    const product = products.find(p => p.code === code);
    if (!product || !country) return false;
    if (!validateAddress(recipientAddress).isValid) {
      toast.error(t('toast.addressInvalid'), { description: t('toast.addressInvalidDesc') });
      return false;
    }
    const [productId, insurance = null] = code.slice(PAKET_PREFIX.length).split('.');
    inFlight.current = true;
    setIsOrdering(true);
    const win = window.open('', '_blank');
    try {
      const { payUrl } = await createPaketOrder({
        productId,
        insurance,
        receiver: {
          name: parsed.name,
          additionalName: parsed.additionalName || undefined,
          addressLine1: parsed.street,
          addressLine2: parsed.addressLine2 || undefined,
          postalCode: parsed.zip,
          city: parsed.city,
          country,
          ...(email.trim() ? { email: email.trim() } : {}),
        },
        recipientAddress,
      });
      if (win) win.location.href = payUrl;
      toast.success(t('toast.paketOrdered'), {
        description: t('toast.paketOrderedDesc', { product: product.name }),
        duration: 15000,
        action: { label: t('intake.pay'), onClick: () => window.open(payUrl, '_blank') },
      });
      return true;
    } catch (err) {
      win?.close();
      toast.error(t('toast.paketOrderFailed'), { description: err instanceof Error ? err.message : undefined });
      return false;
    } finally {
      inFlight.current = false;
      setIsOrdering(false);
    }
  };

  return { products, note, order, isOrdering };
}
