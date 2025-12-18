import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { SHIPPING_PRODUCTS, ShippingProduct } from '@/types/shipping';
import { cn } from '@/lib/utils';

interface ProductSelectorProps {
  selectedProduct: string | null;
  onSelect: (productId: string) => void;
  favoriteProducts: string[];
}

export function ProductSelector({ selectedProduct, onSelect, favoriteProducts }: ProductSelectorProps) {
  const [showOther, setShowOther] = useState(false);
  
  const favorites = SHIPPING_PRODUCTS.filter((p) => favoriteProducts.includes(p.id));
  const others = SHIPPING_PRODUCTS.filter((p) => !favoriteProducts.includes(p.id));

  const ProductCard = ({ product }: { product: ShippingProduct }) => (
    <button
      onClick={() => onSelect(product.id)}
      className={cn(
        'product-card text-left w-full',
        selectedProduct === product.id && 'selected'
      )}
    >
      <div className="flex justify-between items-start mb-1">
        <span className="font-medium text-sm">{product.name}</span>
        <span className="text-primary font-mono text-xs">{product.price}</span>
      </div>
      <span className="text-xs text-muted-foreground">{product.description}</span>
    </button>
  );

  return (
    <div className="space-y-3">
      {favorites.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {favorites.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      )}

      {others.length > 0 && (
        <div>
          <button
            onClick={() => setShowOther(!showOther)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {showOther ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {showOther ? 'Hide' : 'Show'} other products ({others.length})
          </button>
          
          {showOther && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2">
              {others.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          )}
        </div>
      )}

      {favorites.length === 0 && others.length > 0 && !showOther && (
        <p className="text-xs text-muted-foreground">
          No favorite products selected. Go to Settings → Products to choose.
        </p>
      )}
    </div>
  );
}
