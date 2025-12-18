import { useState } from 'react';
import { ChevronDown, ChevronUp, Home, Globe } from 'lucide-react';
import { SHIPPING_PRODUCTS, SHIPPING_ADDONS, ShippingProduct } from '@/types/shipping';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';

interface ProductSelectorProps {
  selectedProduct: string | null;
  onSelect: (productId: string) => void;
  favoriteProducts: string[];
  einschreibenEnabled: boolean;
  onEinschreibenChange: (enabled: boolean) => void;
}

export function ProductSelector({ 
  selectedProduct, 
  onSelect, 
  favoriteProducts,
  einschreibenEnabled,
  onEinschreibenChange,
}: ProductSelectorProps) {
  const [showOther, setShowOther] = useState(false);
  
  const favorites = SHIPPING_PRODUCTS.filter((p) => favoriteProducts.includes(p.id));
  const others = SHIPPING_PRODUCTS.filter((p) => !favoriteProducts.includes(p.id));
  
  const favDomestic = favorites.filter((p) => p.type === 'domestic');
  const favInternational = favorites.filter((p) => p.type === 'international');
  const otherDomestic = others.filter((p) => p.type === 'domestic');
  const otherInternational = others.filter((p) => p.type === 'international');

  const selectedProductData = SHIPPING_PRODUCTS.find(p => p.id === selectedProduct);
  const einschreiben = SHIPPING_ADDONS.find(a => a.id === 'einschreiben-einwurf');

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
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} />
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

      {/* Einschreiben addon */}
      {selectedProductData?.supportsEinschreiben && einschreiben && (
        <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg border border-border">
          <Checkbox
            id="einschreiben"
            checked={einschreibenEnabled}
            onCheckedChange={(checked) => onEinschreibenChange(checked === true)}
          />
          <label htmlFor="einschreiben" className="flex-1 cursor-pointer">
            <span className="text-sm font-medium">{einschreiben.name}</span>
            <span className="text-xs text-muted-foreground ml-2">Registered letter with proof of delivery</span>
          </label>
          <span className="text-primary font-mono text-xs">+{einschreiben.price}</span>
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
