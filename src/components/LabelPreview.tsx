import { Package } from 'lucide-react';
import { AppConfig, ShippingProduct } from '@/types/shipping';
import { ParsedAddress } from '@/lib/address';

interface LabelPreviewProps {
  senderAddress: AppConfig['senderAddress'];
  parsedRecipient: ParsedAddress;
  selectedProduct: ShippingProduct | null;
}

export function LabelPreview({ senderAddress, parsedRecipient, selectedProduct }: LabelPreviewProps) {
  const formatSenderAddress = () => {
    const parts: string[] = [];
    
    // additionalName (company) - displayed as-is, not uppercase
    if (senderAddress.company) {
      parts.push(senderAddress.company);
    }
    
    if (senderAddress.name) parts.push(senderAddress.name);
    if (senderAddress.street) parts.push(senderAddress.street);
    if (senderAddress.postalCode || senderAddress.city) {
      parts.push(`${senderAddress.postalCode} ${senderAddress.city}`.trim());
    }
    
    // Country only if not Germany
    if (senderAddress.country && 
        senderAddress.country !== 'DE' && 
        senderAddress.country !== 'Deutschland' && 
        senderAddress.country !== 'Germany') {
      parts.push(senderAddress.country);
    }
    
    return parts.filter(Boolean).join(', ');
  };

  const formatRecipientAddress = () => {
    const lines: string[] = [];
    
    // 1. Additional name first (company, c/o, etc.)
    if (parsedRecipient.additionalName) {
      lines.push(parsedRecipient.additionalName);
    }
    
    // 2. Name
    if (parsedRecipient.name) {
      lines.push(parsedRecipient.name);
    }
    
    // 3. Street
    if (parsedRecipient.street) {
      lines.push(parsedRecipient.street);
    }
    
    // 4. Address line 2 (apartment, floor, etc.)
    if (parsedRecipient.addressLine2) {
      lines.push(parsedRecipient.addressLine2);
    }
    
    // 5. ZIP and City
    if (parsedRecipient.zip || parsedRecipient.city) {
      lines.push(`${parsedRecipient.zip} ${parsedRecipient.city}`.trim());
    }
    
    // 6. Country (only if not Germany)
    const country = parsedRecipient.country;
    if (country && 
        country !== 'Deutschland' && 
        country !== 'Germany' && 
        country !== 'DE') {
      lines.push(country);
    }
    
    return lines.join('\n');
  };

  const recipientText = formatRecipientAddress();
  const hasRecipient = recipientText.trim().length > 0;

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center gap-2 mb-3">
        <Package className="w-4 h-4 text-primary" />
        <h2 className="font-semibold text-sm">Label Preview</h2>
      </div>
      
      <div className="bg-white text-foreground border border-border rounded-md p-4 aspect-[3/2] relative overflow-hidden">
        {/* Sender - single condensed line at top */}
        <div className="mb-3">
          <p className="font-mono text-[9px] leading-tight text-muted-foreground truncate">
            {formatSenderAddress() || 'Configure sender address'}
          </p>
        </div>

        {/* Middle section - product info, Deutsche Post, QR */}
        <div className="flex items-center justify-between mb-4 py-2 border-y border-border/50">
          <div className="flex items-center gap-2">
            {/* Product code */}
            {selectedProduct && (
              <span className="font-mono text-xs font-bold text-foreground">
                IM
              </span>
            )}
            {/* Date and price */}
            <span className="text-[9px] text-muted-foreground">
              {new Date().toLocaleDateString('de-DE')}
            </span>
            {selectedProduct && (
              <span className="text-[9px] font-medium text-foreground">
                {selectedProduct.cost.toFixed(2)}€
              </span>
            )}
          </div>
          
          <div className="flex items-center gap-2">
            {/* Deutsche Post text */}
            <span className="text-[9px] font-medium text-muted-foreground">Deutsche Post</span>
            
            {/* Simple horn icon representation */}
            <div className="w-4 h-4 flex items-center justify-center">
              <svg viewBox="0 0 24 24" className="w-3 h-3 text-[#FFCC00]" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
              </svg>
            </div>
            
            {/* QR code placeholder */}
            <div className="grid grid-cols-6 gap-[1px] w-6 h-6">
              {Array.from({ length: 36 }).map((_, i) => (
                <div 
                  key={i} 
                  className={`w-1 h-1 ${Math.random() > 0.4 ? 'bg-foreground' : 'bg-transparent'}`}
                />
              ))}
            </div>
          </div>
        </div>

        {/* GOGREEN badge */}
        <div className="absolute top-12 right-3">
          <span className="text-[8px] font-bold text-green-600 tracking-wide">GOGREEN</span>
        </div>

        {/* Recipient - large bold text */}
        <div className="flex-1">
          <pre className="font-mono text-sm leading-relaxed whitespace-pre-wrap font-semibold">
            {hasRecipient ? recipientText : 'Enter recipient address'}
          </pre>
        </div>
      </div>
    </div>
  );
}
