import { useState, useEffect } from 'react';
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
    cropMarginHorizontal: 5,
    cropMarginVertical: 5,
    cupsUrl: '',
    enableDirectPrint: false,
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

  const updateConfig = (updates: Partial<AppConfig>) => {
    const newConfig = { ...config, ...updates };
    setConfig(newConfig);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newConfig));
  };

  const updateApiCredentials = (creds: Partial<AppConfig['apiCredentials']>) => {
    updateConfig({ apiCredentials: { ...config.apiCredentials, ...creds } });
  };

  const updatePrinterConfig = (printer: Partial<AppConfig['printerConfig']>) => {
    updateConfig({ printerConfig: { ...config.printerConfig, ...printer } });
  };

  const updateSenderAddress = (address: Partial<AppConfig['senderAddress']>) => {
    updateConfig({ senderAddress: { ...config.senderAddress, ...address } });
  };

  const updateFavoriteProducts = (favorites: string[]) => {
    updateConfig({ favoriteProducts: favorites });
  };

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
