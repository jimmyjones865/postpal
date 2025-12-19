import { useState, useEffect } from 'react';
import { ShippingProduct } from '@/types/shipping';

export function useProducts() {
  const [products, setProducts] = useState<ShippingProduct[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/products.json')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load products');
        return res.json();
      })
      .then((data) => {
        setProducts(data);
        setIsLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setIsLoading(false);
      });
  }, []);

  const domesticProducts = products.filter((p) => p.domestic);
  const internationalProducts = products.filter((p) => !p.domestic);

  return { products, domesticProducts, internationalProducts, isLoading, error };
}
