import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { AppConfig, IntakeSettings } from '@/types/shipping';
import { json, post } from '@/services/labelService';

type Patch = { [S in keyof AppConfig]?: AppConfig[S] extends unknown[] ? AppConfig[S] : Partial<{ [K in keyof AppConfig[S]]: AppConfig[S][K] | null }> };

interface SettingsResponse {
  settings: AppConfig;
  defaults: AppConfig;
  stored: Patch;
  intakeEnabled: boolean;
}

const send = async (patch: Patch, keepalive = false): Promise<SettingsResponse> =>
  json(await post('/settings', patch, { method: 'PATCH', keepalive }));

export function useConfig() {
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [serverCredentialsConfigured, setServerCredentialsConfigured] = useState<boolean | null>(null);
  const pending = useRef<Patch>({});
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const load = useCallback(async () => {
    try {
      setData(await json(await fetch('/api/settings')));
    } catch (e) {
      toast.error('Settings', { description: (e as Error).message });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    fetch('/api/credentials/status')
      .then(r => (r.ok ? r.json() : { configured: false }))
      .then(d => setServerCredentialsConfigured(d.configured))
      .catch(() => setServerCredentialsConfigured(false));
  }, []);

  const flush = useCallback(async (keepalive = false) => {
    clearTimeout(timer.current);
    const patch = pending.current;
    if (!Object.keys(patch).length) return;
    pending.current = {};
    try {
      const body = await send(patch, keepalive);
      // Keep what the user typed meanwhile; the next flush carries it
      if (!Object.keys(pending.current).length) setData(body);
    } catch (e) {
      toast.error('Settings', { description: (e as Error).message });
      load();
    }
  }, [load]);

  useEffect(() => {
    const onHide = () => flush(true);
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, [flush]);

  // Typing: local state now, one PATCH after a pause
  const edit = useCallback(<S extends 'printerConfig' | 'senderAddress'>(section: S, values: Partial<AppConfig[S]>) => {
    setData(prev => prev && { ...prev, settings: { ...prev.settings, [section]: { ...prev.settings[section], ...values } } });
    pending.current = { ...pending.current, [section]: { ...(pending.current[section] as object), ...values } };
    clearTimeout(timer.current);
    timer.current = setTimeout(() => flush(), 500);
  }, [flush]);

  const updatePrinterConfig = useCallback((v: Partial<AppConfig['printerConfig']>) => edit('printerConfig', v), [edit]);
  const updateSenderAddress = useCallback((v: Partial<AppConfig['senderAddress']>) => edit('senderAddress', v), [edit]);

  const updateHiddenProducts = useCallback((hidden: string[]) => {
    setData(prev => prev && { ...prev, settings: { ...prev.settings, hiddenProducts: hidden } });
    pending.current = { ...pending.current, hiddenProducts: hidden };
    flush();
  }, [flush]);

  /** Saved at once; null = back to env. Rejects with the server's validation message. */
  const updateIntake = useCallback(async (values: Partial<{ [K in keyof IntakeSettings]: IntakeSettings[K] | null }>) => {
    await flush();
    const body = await send({ intake: values });
    setData(body);
  }, [flush]);

  const config = data?.settings ?? null;
  const isConfigured = Boolean(
    serverCredentialsConfigured &&
    config?.senderAddress.name &&
    config.senderAddress.street &&
    config.senderAddress.city &&
    config.senderAddress.postalCode
  );

  return {
    config,
    defaults: data?.defaults ?? null,
    storedIntake: (data?.stored.intake ?? {}) as Partial<IntakeSettings>,
    intakeEnabled: data?.intakeEnabled ?? false,
    isLoaded: data !== null,
    isConfigured,
    credentialsConfigured: serverCredentialsConfigured,
    updatePrinterConfig,
    updateSenderAddress,
    updateHiddenProducts,
    updateIntake,
  };
}
