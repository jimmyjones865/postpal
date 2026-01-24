import { useState, useEffect } from 'react';
import { Ruler, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface DimensionsPreviewProps {
  cropH: number;
  cropV: number;
  disableCropping: boolean;
}

interface Dimensions {
  original: { widthMm: number; heightMm: number };
  cropped: { widthMm: number; heightMm: number } | null;
}

export function DimensionsPreview({ cropH, cropV, disableCropping }: DimensionsPreviewProps) {
  const [dimensions, setDimensions] = useState<Dimensions | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastLabelId, setLastLabelId] = useState<string | null>(null);

  const fetchDimensions = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const apiUrl = import.meta.env.VITE_API_URL || '/api';
      
      // First get the most recent label
      const labelsRes = await fetch(`${apiUrl}/labels`);
      if (!labelsRes.ok) throw new Error('Failed to fetch labels');
      
      const labels = await labelsRes.json();
      if (!labels || labels.length === 0) {
        setError('No labels available for preview');
        return;
      }
      
      const latestLabel = labels[0];
      setLastLabelId(latestLabel.id);
      
      // Get dimensions for this label
      const dimRes = await fetch(`${apiUrl}/labels/${latestLabel.id}/dimensions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cropH, cropV, disableCropping })
      });
      
      if (!dimRes.ok) throw new Error('Failed to calculate dimensions');
      
      const dims = await dimRes.json();
      setDimensions(dims);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  };

  // Auto-refresh when margins change (if we have a cached result)
  useEffect(() => {
    if (lastLabelId && dimensions) {
      fetchDimensions();
    }
  }, [cropH, cropV, disableCropping]);

  return (
    <div className="mt-3 p-2 bg-muted rounded border border-border">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium flex items-center gap-1">
          <Ruler className="w-3 h-3" />
          Output Dimensions
        </span>
        <Button 
          variant="ghost" 
          size="sm" 
          className="h-6 text-xs px-2"
          onClick={fetchDimensions}
          disabled={isLoading}
        >
          {isLoading ? (
            <>
              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
              Calculating...
            </>
          ) : (
            'Preview'
          )}
        </Button>
      </div>
      
      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}
      
      {dimensions && !error && (
        <div className="text-xs space-y-1">
          <div className="flex justify-between text-muted-foreground">
            <span>Original:</span>
            <span>{dimensions.original.widthMm} × {dimensions.original.heightMm} mm</span>
          </div>
          {dimensions.cropped && (
            <div className="flex justify-between font-medium">
              <span>Cropped:</span>
              <span className="text-primary">{dimensions.cropped.widthMm} × {dimensions.cropped.heightMm} mm</span>
            </div>
          )}
        </div>
      )}
      
      {!dimensions && !error && !isLoading && (
        <p className="text-xs text-muted-foreground">
          Click "Preview" to see expected label size based on the last printed label.
        </p>
      )}
    </div>
  );
}
