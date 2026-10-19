import { useState, useCallback } from 'react';
import { ParsedAddress } from '@/lib/address';
import { parseAddress as parseAddressApi } from '@/services/labelService';

export function useAddressParser() {
  const [isLoading, setIsLoading] = useState(false);

  const parseAddress = useCallback(async (address: string): Promise<ParsedAddress | null> => {
    if (!address.trim()) return null;

    setIsLoading(true);
    try {
      return await parseAddressApi(address);
    } catch (err) {
      console.warn('Address parsing failed:', err);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { parseAddress, isLoading };
}
