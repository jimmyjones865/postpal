import { useState, useCallback } from 'react';
import { ParsedAddress } from '@/lib/addressParser';

interface UseLibpostalResult {
  parseWithLibpostal: (address: string) => Promise<ParsedAddress | null>;
  isLoading: boolean;
  error: string | null;
  isAvailable: boolean | null;
}

export function useLibpostal(): UseLibpostalResult {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAvailable, setIsAvailable] = useState<boolean | null>(null);

  const parseWithLibpostal = useCallback(async (address: string): Promise<ParsedAddress | null> => {
    if (!address.trim()) return null;
    
    setIsLoading(true);
    setError(null);
    
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001';
      const response = await fetch(`${apiUrl}/api/parse-address`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ address }),
      });
      
      if (response.status === 501) {
        // libpostal not available
        setIsAvailable(false);
        return null;
      }
      
      if (!response.ok) {
        throw new Error('Failed to parse address');
      }
      
      setIsAvailable(true);
      const parsed = await response.json();
      return parsed as ParsedAddress;
    } catch (err) {
      console.warn('Libpostal parsing failed:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { parseWithLibpostal, isLoading, error, isAvailable };
}
