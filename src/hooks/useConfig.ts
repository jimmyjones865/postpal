import { useState, useEffect, useCallback } from 'react';
import { AppConfig } from '@/types/shipping';

const STORAGE_KEY = 'dp-label-config';

const defaultConfig: AppConfig = {
  apiCredentials: {
    apiKey: '',
    apiSecret: '',
    portokasseLogin: '',
    portokassePassword: '',
  },
  printerConfig: {
    paperFormat: 'a6',
    printerName: '',
    paperFormatName: '',
    orientation: 'portrait',
    cropMarginTop: 5,
    cropMarginRight: 5,
    cropMarginBottom: 5,
    cropMarginLeft: 5,
    disableCropping: false,
    cupsUrl: '',
    enableDirectPrint: false,
    paperWidthMm: 62,      // Common Brother label width
    paperHeightMm: 100,    // Default fixed height
    endlessRoll: true,     // Most label printers use endless roll
  },
  senderAddress: {
    name: '',
    company: '',
    street: '',
    city: '',
    postalCode: '',
    country: 'DE',
  },
  favoriteProducts: ['brief-standard', 'brief-gross', 'paket'],
};

export function useConfig() {
  const [config, setConfig] = useState<AppConfig>(defaultConfig);
  const [isLoaded, setIsLoaded] = useState(false);
  const [serverCredentialsConfigured, setServerCredentialsConfigured] = useState<boolean | null>(null);

  // Check if server has credentials configured
  useEffect(() => {
    async function checkServerCredentials() {
      try {
        const response = await fetch('/api/credentials/status');
        if (response.ok) {
          const data = await response.json();
          setServerCredentialsConfigured(data.configured);
        } else {
          setServerCredentialsConfigured(false);
        }
      } catch (e) {
        console.error('Failed to check server credentials:', e);
        setServerCredentialsConfigured(false);
      }
    }
    checkServerCredentials();
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        setConfig(JSON.parse(stored));
      } catch (e) {
        console.error('Failed to parse config:', e);
      }
    }
    setIsLoaded(true);
  }, []);

  const updateConfig = useCallback((updates: Partial<AppConfig>) => {
    setConfig(prev => {
      const newConfig = { ...prev, ...updates };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newConfig));
      return newConfig;
    });
  }, []);

  const updateApiCredentials = useCallback((creds: Partial<AppConfig['apiCredentials']>) => {
    setConfig(prev => {
      const newConfig = { ...prev, apiCredentials: { ...prev.apiCredentials, ...creds } };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newConfig));
      return newConfig;
    });
  }, []);

  const updatePrinterConfig = useCallback((printer: Partial<AppConfig['printerConfig']>) => {
    setConfig(prev => {
      const newConfig = { ...prev, printerConfig: { ...prev.printerConfig, ...printer } };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newConfig));
      return newConfig;
    });
  }, []);

  const updateSenderAddress = useCallback((address: Partial<AppConfig['senderAddress']>) => {
    setConfig(prev => {
      const newConfig = { ...prev, senderAddress: { ...prev.senderAddress, ...address } };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newConfig));
      return newConfig;
    });
  }, []);

  const updateFavoriteProducts = useCallback((favorites: string[]) => {
    setConfig(prev => {
      const newConfig = { ...prev, favoriteProducts: favorites };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newConfig));
      return newConfig;
    });
  }, []);

  // Check for server-provided CUPS defaults (for docker-compose.cups.yml users)
  useEffect(() => {
    if (!isLoaded) return;
    
    async function checkCupsDefaults() {
      try {
        const response = await fetch('/api/cups/defaults');
        if (response.ok) {
          const data = await response.json();
          if (data.configured && data.cupsUrl) {
            // Only apply if no CUPS URL is currently configured
            setConfig(prev => {
              if (prev.printerConfig.cupsUrl) return prev;
              const newConfig = { ...prev, printerConfig: { ...prev.printerConfig, cupsUrl: data.cupsUrl } };
              localStorage.setItem(STORAGE_KEY, JSON.stringify(newConfig));
              return newConfig;
            });
          }
        }
      } catch {
        // Silently ignore - CUPS defaults are optional
      }
    }
    
    checkCupsDefaults();
  }, [isLoaded]);

  // isConfigured now checks server-side credentials
  const isConfigured = Boolean(
    serverCredentialsConfigured &&
    config.senderAddress.name &&
    config.senderAddress.street &&
    config.senderAddress.city &&
    config.senderAddress.postalCode
  );

  return {
    config,
    isLoaded,
    isConfigured,
    serverCredentialsConfigured,
    updateConfig,
    updateApiCredentials,
    updatePrinterConfig,
    updateSenderAddress,
    updateFavoriteProducts,
  };
}
