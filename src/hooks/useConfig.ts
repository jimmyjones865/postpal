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
    printerName: '',
    paperFormatName: '',
    paperFormatId: 0,
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

// Apply server-provided defaults for fields where localStorage still holds the
// hardcoded code default (i.e. the user hasn't explicitly changed that field).
function applyServerDefaults<T extends Record<string, unknown>>(
  local: T,
  server: Partial<T>,
  codeDefault: T
): T {
  const result = { ...local };
  for (const key of Object.keys(server) as Array<keyof T>) {
    if (server[key] === undefined) continue;
    if (local[key] === codeDefault[key]) {
      result[key] = server[key] as T[keyof T];
    }
  }
  return result;
}

export function useConfig() {
  const [config, setConfig] = useState<AppConfig>(defaultConfig);
  const [isLoaded, setIsLoaded] = useState(false);
  const [serverCredentialsConfigured, setServerCredentialsConfigured] = useState<boolean | null>(null);

  // Load server defaults and merge with localStorage
  useEffect(() => {
    async function loadConfig() {
      // Load localStorage first
      const stored = localStorage.getItem(STORAGE_KEY);
      let localConfig = defaultConfig;
      if (stored) {
        try {
          localConfig = JSON.parse(stored);
        } catch (e) {
          console.error('Failed to parse config:', e);
        }
      }

      // Load server defaults and merge field-by-field.
      // Server value wins only where localStorage still holds the hardcoded default
      // (meaning the user hasn't explicitly changed that field).
      try {
        const response = await fetch('/api/config/defaults');
        if (response.ok) {
          const serverDefaults = await response.json();
          const merged = { ...localConfig };

          if (serverDefaults.senderAddress) {
            merged.senderAddress = applyServerDefaults(
              localConfig.senderAddress,
              serverDefaults.senderAddress,
              defaultConfig.senderAddress
            );
          }
          if (serverDefaults.printerConfig) {
            merged.printerConfig = applyServerDefaults(
              localConfig.printerConfig,
              serverDefaults.printerConfig,
              defaultConfig.printerConfig
            );
          }

          setConfig(merged);
        } else {
          setConfig(localConfig);
        }
      } catch (e) {
        console.error('Failed to load server config:', e);
        setConfig(localConfig);
      }

      setIsLoaded(true);
    }

    loadConfig();
  }, []);

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
