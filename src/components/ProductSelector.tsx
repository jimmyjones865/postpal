import { Package, Globe, Home } from 'lucide-react';
import { SHIPPING_PRODUCTS, ShippingProduct } from '@/types/shipping';
import { cn } from '@/lib/utils';

interface ProductSelectorProps {
  selectedProduct: string | null;
  onSelect: (productId: string) => void;
}

export function ProductSelector({ selectedProduct, onSelect }: ProductSelectorProps) {
  const domesticProducts = SHIPPING_PRODUCTS.filter((p) => p.type === 'domestic');
  const internationalProducts = SHIPPING_PRODUCTS.filter((p) => p.type === 'international');

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
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Home className="w-4 h-4 text-muted-foreground" />
          <h3 className="section-title mb-0">Domestic (DE)</h3>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {domesticProducts.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-3">
          <Globe className="w-4 h-4 text-muted-foreground" />
          <h3 className="section-title mb-0">International</h3>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {internationalProducts.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      </div>
    </div>
  );
}
