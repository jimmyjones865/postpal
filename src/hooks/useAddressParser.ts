import { useState, useCallback } from 'react';
import { ParsedAddress } from '@/lib/address';

interface UseAddressParserResult {
  parseAddress: (address: string) => Promise<ParsedAddress | null>;
  isLoading: boolean;
  error: string | null;
}

export function useAddressParser(): UseAddressParserResult {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parseAddress = useCallback(async (address: string): Promise<ParsedAddress | null> => {
    if (!address.trim()) return null;
    
    setIsLoading(true);
    setError(null);
    
    try {
      const apiUrl = import.meta.env.VITE_API_URL || '/api';
      const response = await fetch(`${apiUrl}/parse-address`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address }),
      });
      
      if (!response.ok) {
        throw new Error('Failed to parse address');
      }
      
      return await response.json() as ParsedAddress;
    } catch (err) {
      console.warn('Address parsing failed:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { parseAddress, isLoading, error };
}
