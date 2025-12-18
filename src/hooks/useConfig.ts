import { useState, useEffect } from 'react';
import { AppConfig } from '@/types/shipping';

const STORAGE_KEY = 'dp-label-config';

const defaultConfig: AppConfig = {
  apiCredentials: {
    username: '',
    password: '',
    ekp: '',
  },
  printerConfig: {
    paperFormat: 'a6',
    printerName: '',
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

  const isConfigured = Boolean(
    config.apiCredentials.username &&
    config.apiCredentials.password &&
    config.senderAddress.name &&
    config.senderAddress.street &&
    config.senderAddress.city &&
    config.senderAddress.postalCode
  );

  return {
    config,
    isLoaded,
    isConfigured,
    updateConfig,
    updateApiCredentials,
    updatePrinterConfig,
    updateSenderAddress,
    updateFavoriteProducts,
  };
}
