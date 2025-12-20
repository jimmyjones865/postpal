import { useState } from 'react';
import { ChevronDown, ChevronUp, Home, Globe, Mail } from 'lucide-react';
import { SHIPPING_ADDONS, ShippingProduct } from '@/types/shipping';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ProductSelectorProps {
  products: ShippingProduct[];
  selectedProduct: string | null;
  onSelect: (productCode: string) => void;
  onDoubleClick: () => void;
  favoriteProducts: string[];
  einschreibenEnabled: boolean;
  onEinschreibenChange: (enabled: boolean) => void;
}

export function ProductSelector({ 
  products,
  selectedProduct, 
  onSelect,
  onDoubleClick,
  favoriteProducts,
  einschreibenEnabled,
  onEinschreibenChange,
}: ProductSelectorProps) {
  const [showOther, setShowOther] = useState(false);
  
  const favorites = products.filter((p) => favoriteProducts.includes(p.code));
  const others = products.filter((p) => !favoriteProducts.includes(p.code));
  
  const favDomestic = favorites.filter((p) => p.domestic);
  const favInternational = favorites.filter((p) => !p.domestic);
  const otherDomestic = others.filter((p) => p.domestic);
  const otherInternational = others.filter((p) => !p.domestic);

  const selectedProductData = products.find(p => p.code === selectedProduct);
  const einschreiben = SHIPPING_ADDONS.find(a => a.id === 'einschreiben-einwurf');

  const formatWeight = (grams: number) => {
    if (grams >= 1000) return `${(grams / 1000).toFixed(1)}kg`;
    return `${grams}g`;
  };

  const ProductCard = ({ product }: { product: ShippingProduct }) => {
    const isSelected = selectedProduct === product.code;
    const showEinschreiben = product.supportsEinschreiben && isSelected;
    
    return (
      <div className="flex flex-col gap-1">
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
            <span className="font-medium text-sm">{product.name}</span>
            <span className="text-primary font-mono text-xs">{product.cost.toFixed(2)}€</span>
          </div>
          <span className="text-xs text-muted-foreground">Max {formatWeight(product.maxWeight)}</span>
        </button>
        
        {showEinschreiben && einschreiben && (
          <Button
            variant={einschreibenEnabled ? "default" : "outline"}
            size="sm"
            className="w-full text-xs h-7 gap-1"
            onClick={(e) => {
              e.stopPropagation();
              onEinschreibenChange(!einschreibenEnabled);
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              onEinschreibenChange(true);
              onDoubleClick();
            }}
          >
            <Mail className="w-3 h-3" />
            {einschreiben.name}
            <span className="ml-auto font-mono">+{einschreiben.price}</span>
          </Button>
        )}
      </div>
    );
  };

  const ProductGroup = ({ 
    title, 
    icon: Icon, 
    products, 
    type 
  }: { 
    title: string; 
    icon: typeof Home; 
    products: ShippingProduct[];
    type: 'domestic' | 'international';
  }) => {
    if (products.length === 0) return null;
    
    return (
      <div>
        <div className={cn(
          "flex items-center gap-2 mb-2 px-2 py-1 rounded-md text-xs font-medium",
          type === 'domestic' 
            ? "bg-amber-500/10 text-amber-500" 
            : "bg-blue-500/10 text-blue-500"
        )}>
          <Icon className="w-3 h-3" />
          <span>{title}</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {products.map((product) => (
            <ProductCard key={product.code} product={product} />
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Favorites */}
      {favorites.length > 0 && (
        <div className="space-y-3">
          <ProductGroup title="Domestic (DE)" icon={Home} products={favDomestic} type="domestic" />
          <ProductGroup title="International" icon={Globe} products={favInternational} type="international" />
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
            <div className="space-y-3 mt-3">
              <ProductGroup title="Domestic (DE)" icon={Home} products={otherDomestic} type="domestic" />
              <ProductGroup title="International" icon={Globe} products={otherInternational} type="international" />
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
