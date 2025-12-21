import { useState, useMemo } from 'react';
import { ChevronDown, ChevronUp, Home, Globe } from 'lucide-react';
import { ShippingProduct } from '@/types/shipping';
import { cn } from '@/lib/utils';

interface ProductSelectorProps {
  products: ShippingProduct[];
  selectedProduct: string | null;
  onSelect: (productCode: string) => void;
  onDoubleClick: () => void;
  favoriteProducts: string[];
}

type ProductGroup = 'standard' | 'kompakt' | 'gross' | 'maxi';

const GROUP_LABELS: Record<ProductGroup, string> = {
  standard: 'Standard',
  kompakt: 'Kompakt',
  gross: 'Groß',
  maxi: 'Maxi',
};

export function ProductSelector({ 
  products,
  selectedProduct, 
  onSelect,
  onDoubleClick,
  favoriteProducts,
}: ProductSelectorProps) {
  const [showOther, setShowOther] = useState(false);
  
  const favorites = products.filter((p) => favoriteProducts.includes(p.code));
  const others = products.filter((p) => !favoriteProducts.includes(p.code));
  
  const favDomestic = favorites.filter((p) => p.domestic);
  const favInternational = favorites.filter((p) => !p.domestic);
  const otherDomestic = others.filter((p) => p.domestic);
  const otherInternational = others.filter((p) => !p.domestic);

  const formatWeight = (grams: number) => {
    if (grams >= 1000) return `${(grams / 1000).toFixed(1)}kg`;
    return `${grams}g`;
  };

  // Group products by their group property
  const groupProducts = (productList: ShippingProduct[]) => {
    const groups: Record<ProductGroup, ShippingProduct[]> = {
      standard: [],
      kompakt: [],
      gross: [],
      maxi: [],
    };
    
    productList.forEach(product => {
      const group = product.group as ProductGroup;
      if (groups[group]) {
        groups[group].push(product);
      }
    });
    
    return groups;
  };

  const ProductCard = ({ product }: { product: ShippingProduct }) => {
    const isSelected = selectedProduct === product.code;
    
    return (
      <button
        onClick={() => onSelect(product.code)}
        onDoubleClick={() => {
          onSelect(product.code);
          onDoubleClick();
        }}
        className={cn(
          'product-card text-left w-full',
          isSelected && 'selected'
        )}
      >
        <div className="flex justify-between items-start mb-1">
          <span className="font-medium text-sm flex items-center gap-1">
            {product.tracked && (
              <span className="text-primary font-bold">R</span>
            )}
            {product.name}
          </span>
          <span className="text-primary font-mono text-xs">{product.cost.toFixed(2)}€</span>
        </div>
        <span className="text-xs text-muted-foreground">Max {formatWeight(product.maxWeight)}</span>
      </button>
    );
  };

  const ProductColumns = ({ 
    products, 
    type 
  }: { 
    products: ShippingProduct[];
    type: 'domestic' | 'international';
  }) => {
    const groupedProducts = useMemo(() => groupProducts(products), [products]);
    const activeGroups = Object.entries(groupedProducts).filter(([_, items]) => items.length > 0);
    
    if (activeGroups.length === 0) return null;
    
    return (
      <div>
        <div className={cn(
          "flex items-center gap-2 mb-2 px-2 py-1 rounded-md text-xs font-medium",
          type === 'domestic' 
            ? "bg-amber-500/10 text-amber-500" 
            : "bg-blue-500/10 text-blue-500"
        )}>
          {type === 'domestic' ? <Home className="w-3 h-3" /> : <Globe className="w-3 h-3" />}
          <span>{type === 'domestic' ? 'Domestic (DE)' : 'International'}</span>
        </div>
        
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {activeGroups.map(([groupKey, groupProducts]) => (
            <div key={groupKey} className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-1">
                {GROUP_LABELS[groupKey as ProductGroup]}
              </div>
              <div className="flex flex-col gap-1">
                {groupProducts.map((product) => (
                  <ProductCard key={product.code} product={product} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Favorites */}
      {favorites.length > 0 && (
        <div className="space-y-4">
          <ProductColumns products={favDomestic} type="domestic" />
          <ProductColumns products={favInternational} type="international" />
        </div>
      )}

      {/* Other products */}
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
            <div className="space-y-4 mt-3">
              <ProductColumns products={otherDomestic} type="domestic" />
              <ProductColumns products={otherInternational} type="international" />
            </div>
          )}
        </div>
      )}

      {favorites.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No favorite products selected. Go to Settings → Products to choose.
        </p>
      )}
    </div>
  );
}
