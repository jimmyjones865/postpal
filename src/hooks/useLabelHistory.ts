import { useState, useEffect, useCallback } from 'react';
import { StoredLabel, getLabels, deleteLabel } from '@/lib/labelStorage';

export function useLabelHistory() {
  const [labels, setLabels] = useState<StoredLabel[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLabels = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await getLabels();
      setLabels(data);
    } catch (err) {
      setError('Failed to load label history');
      console.error('Failed to load labels:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLabels();
  }, [fetchLabels]);

  const removeLabel = async (id: string) => {
    try {
      await deleteLabel(id);
      setLabels(prev => prev.filter(l => l.id !== id));
    } catch (err) {
      console.error('Failed to delete label:', err);
      throw err;
    }
  };

  const addLabel = (label: StoredLabel) => {
    setLabels(prev => [label, ...prev]);
  };

  return {
    labels,
    isLoading,
    error,
    refresh: fetchLabels,
    removeLabel,
    addLabel,
  };
}
