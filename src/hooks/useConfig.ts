import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { AppConfig, IntakeSettings } from '@/types/shipping';

type Patch = { [S in keyof AppConfig]?: AppConfig[S] extends unknown[] ? AppConfig[S] : Partial<{ [K in keyof AppConfig[S]]: AppConfig[S][K] | null }> };

interface SettingsResponse {
  settings: AppConfig;
  defaults: AppConfig;
  stored: Patch;
  intakeEnabled: boolean;
}

// Settings used to live in this browser's localStorage; moved once to the server, then removed.
const LEGACY_KEY = 'dp-label-config';
const LEGACY_DEFAULTS: Record<string, Record<string, unknown>> = {
  printerConfig: {
    printerName: '', paperFormatName: '', paperFormatId: 0, orientation: 'portrait',
    cropMarginTop: 5, cropMarginRight: 5, cropMarginBottom: 5, cropMarginLeft: 5,
    disableCropping: false, cupsUrl: '', enableDirectPrint: false,
    paperWidthMm: 62, paperHeightMm: 100, endlessRoll: true,
  },
  senderAddress: { name: '', company: '', street: '', city: '', postalCode: '', country: 'DE' },
};

/** Only values the user changed in the browser: a field still at the old code default meant "use env". */
function legacyPatch(stored: Patch): Patch | null {
  let raw: Record<string, unknown> | null = null;
  try { raw = JSON.parse(localStorage.getItem(LEGACY_KEY) || 'null'); } catch { /* unreadable → nothing to move */ }
  if (!raw) return null;
  const patch: Record<string, unknown> = {};
  for (const [section, defaults] of Object.entries(LEGACY_DEFAULTS)) {
    if (stored[section as keyof Patch]) continue;
    const local = (raw[section] || {}) as Record<string, unknown>;
    const changed = Object.fromEntries(Object.entries(local).filter(([k, v]) => k in defaults && v !== defaults[k]));
    if (Object.keys(changed).length) patch[section] = changed;
  }
  if (!stored.hiddenProducts && Array.isArray(raw.favoriteProducts)) patch.hiddenProducts = raw.favoriteProducts;
  return patch as Patch;
}

async function send(patch: Patch, keepalive = false): Promise<SettingsResponse> {
  const res = await fetch('/api/settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
    keepalive,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

export function useConfig() {
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [serverCredentialsConfigured, setServerCredentialsConfigured] = useState<boolean | null>(null);
  const pending = useRef<Patch>({});
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/settings');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      let body: SettingsResponse = await res.json();
      const legacy = legacyPatch(body.stored);
      if (legacy) {
        try {
          if (Object.keys(legacy).length) body = await send(legacy);
          localStorage.removeItem(LEGACY_KEY);
        } catch (e) {
          toast.error('Settings: browser values not moved', { description: (e as Error).message });
        }
      }
      setData(body);
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
