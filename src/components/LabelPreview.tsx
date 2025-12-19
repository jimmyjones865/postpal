import { Package } from 'lucide-react';
import { AppConfig, ShippingProduct } from '@/types/shipping';

interface LabelPreviewProps {
  senderAddress: AppConfig['senderAddress'];
  recipientAddress: string;
  selectedProduct: ShippingProduct | null;
}

export function LabelPreview({ senderAddress, recipientAddress, selectedProduct }: LabelPreviewProps) {
  const formatSenderAddress = () => {
    const lines = [];
    if (senderAddress.company) lines.push(senderAddress.company);
    lines.push(senderAddress.name);
    lines.push(senderAddress.street);
    lines.push(`${senderAddress.postalCode} ${senderAddress.city}`);
    if (senderAddress.country !== 'DE') lines.push(senderAddress.country);
    return lines.filter(Boolean).join('\n');
  };

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center gap-2 mb-3">
        <Package className="w-4 h-4 text-primary" />
        <h2 className="font-semibold text-sm">Label Preview</h2>
      </div>
      
      <div className="bg-foreground/95 text-background rounded-md p-4 aspect-[4/3] relative overflow-hidden">
        {/* Product badge */}
        {selectedProduct && (
          <div className="absolute top-3 right-3 bg-primary text-primary-foreground text-[10px] font-bold px-2 py-1 rounded">
            {selectedProduct.name}
          </div>
        )}
        
        {/* Sender */}
        <div className="mb-4">
          <p className="text-[8px] uppercase tracking-wider text-background/50 mb-1">Absender</p>
          <pre className="font-mono text-[10px] leading-tight whitespace-pre-wrap text-background/70">
            {formatSenderAddress() || 'Configure sender address'}
          </pre>
        </div>

        {/* Recipient */}
        <div>
          <p className="text-[8px] uppercase tracking-wider text-background/50 mb-1">Empfänger</p>
          <pre className="font-mono text-sm leading-tight whitespace-pre-wrap">
            {recipientAddress || 'Enter recipient address'}
          </pre>
        </div>

        {/* Barcode placeholder */}
        <div className="absolute bottom-3 left-3 right-3">
          <div className="h-8 bg-background/10 rounded flex items-center justify-center">
            <div className="flex gap-[2px]">
              {Array.from({ length: 30 }).map((_, i) => (
                <div 
                  key={i} 
                  className="bg-background/40 h-6"
                  style={{ width: Math.random() > 0.5 ? '2px' : '1px' }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
