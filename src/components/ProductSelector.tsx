import { useState, useMemo } from 'react';
import { ChevronDown, ChevronUp, Home, Globe } from 'lucide-react';
import { ShippingProduct } from '@/types/shipping';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';

interface ProductSelectorProps {
  products: ShippingProduct[];
  selectedProduct: string | null;
  onSelect: (productCode: string) => void;
  onDoubleClick: () => void;
  /** Products in this list are EXCLUDED from display (hidden products) */
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
  const { t } = useTranslation();
  const [showOther, setShowOther] = useState(false);
  
  // favoriteProducts now acts as an EXCLUSION list (hidden products)
  // Products NOT in the list are shown as main products
  const visibleProducts = products.filter((p) => !favoriteProducts.includes(p.code));
  const hiddenProducts = products.filter((p) => favoriteProducts.includes(p.code));
  
  const visibleDomestic = visibleProducts.filter((p) => p.domestic);
  const visibleInternational = visibleProducts.filter((p) => !p.domestic);
  const hiddenDomestic = hiddenProducts.filter((p) => p.domestic);
  const hiddenInternational = hiddenProducts.filter((p) => !p.domestic);

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

  // Redesigned product card based on mockup:
  // Price prominent top-left, R indicator top-right
  // Product name below, weight in corner
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
          'relative text-left w-full p-3 rounded-lg border transition-all',
          'hover:border-primary/50 hover:bg-muted/30',
          isSelected 
            ? 'border-primary bg-primary/5 ring-1 ring-primary/20' 
            : 'border-border bg-card'
        )}
      >
        {/* Top row: Price and tracked indicator */}
        <div className="flex justify-between items-start mb-2">
          <span className="text-lg font-bold">
            {product.cost.toFixed(2)} €
          </span>
          {product.tracked && (
            <span className="text-base font-bold text-foreground">R</span>
          )}
        </div>
        
        {/* Product name */}
        <div className="text-xs text-muted-foreground leading-tight mb-1">
          {product.name}
        </div>
        
        {/* Weight in bottom right */}
        <div className="absolute bottom-2 right-3 text-xs text-muted-foreground">
          {formatWeight(product.maxWeight)}
        </div>
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
          "flex items-center gap-2 mb-3 px-2 py-1.5 rounded-md text-xs font-medium",
          type === 'domestic' 
            ? "bg-amber-500/10 text-amber-600 dark:text-amber-400" 
            : "bg-blue-500/10 text-blue-600 dark:text-blue-400"
        )}>
          {type === 'domestic' ? <Home className="w-3.5 h-3.5" /> : <Globe className="w-3.5 h-3.5" />}
          <span>{type === 'domestic' ? t('product.domestic') : t('product.international')}</span>
        </div>
        
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {activeGroups.map(([groupKey, groupProducts]) => (
            <div key={groupKey} className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-1">
                {GROUP_LABELS[groupKey as ProductGroup]}
              </div>
              <div className="flex flex-col gap-2">
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
      {/* Main visible products */}
      {visibleProducts.length > 0 && (
        <div className="space-y-4">
          <ProductColumns products={visibleDomestic} type="domestic" />
          <ProductColumns products={visibleInternational} type="international" />
        </div>
      )}

      {/* Hidden products (can be expanded) */}
      {hiddenProducts.length > 0 && (
        <div>
          <button
            onClick={() => setShowOther(!showOther)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {showOther ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {showOther 
              ? t('product.hideProducts', { count: hiddenProducts.length })
              : t('product.showHidden', { count: hiddenProducts.length })
            }
          </button>
          
          {showOther && (
            <div className="space-y-4 mt-3">
              <ProductColumns products={hiddenDomestic} type="domestic" />
              <ProductColumns products={hiddenInternational} type="international" />
            </div>
          )}
        </div>
      )}

      {visibleProducts.length === 0 && (
        <p className="text-xs text-muted-foreground">
          {t('product.allHidden')}
        </p>
      )}
    </div>
  );
}
