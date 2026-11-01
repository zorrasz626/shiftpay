/**
 * Pro entitlement store. `init(client)` configures RevenueCat, reads the
 * customer info and follows its updates. It fails closed: no API key, or any
 * SDK error, means 'free'; it never throws, so start-up is never blocked.
 *
 * Dev override: the setting `dev.proOverride` ('pro' | 'free' | null) wins
 * over RevenueCat, but only in dev builds (`__DEV__`, injectable for tests).
 * Read the result through `useEntitlement()`, not this store.
 */
import type { CustomerInfo } from 'react-native-purchases';
import { create } from 'zustand';

import { useSettingsStore } from '../../store/settingsStore';
import { hasProEntitlement, type PurchasesClient, revenueCatApiKey } from './purchases';

export type ProStatus = 'loading' | 'free' | 'pro';
/** Where `status` came from. */
export type ProSource = 'pending' | 'unconfigured' | 'revenuecat' | 'error' | 'dev-override';
export type ProOverride = 'pro' | 'free' | null;

export const PRO_OVERRIDE_KEY = 'dev.proOverride';

export interface ProInitOptions {
  /** Defaults to `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY`; null/blank → not configured. */
  apiKey?: string | null;
  /** Defaults to `__DEV__`; the override is honoured only when true. */
  isDev?: boolean;
}

export interface ProState {
  status: ProStatus;
  source: ProSource;
  init: (client: PurchasesClient, options?: ProInitOptions) => Promise<void>;
  /** Re-reads the customer info (when configured) and re-applies the dev override. */
  refresh: () => Promise<void>;
}

interface Base {
  status: ProStatus;
  source: ProSource;
}

const PENDING: Base = { status: 'loading', source: 'pending' };

/** The dev override from the settings store; anything unexpected counts as none. */
export function readProOverride(values: Record<string, unknown>): ProOverride {
  const raw = values[PRO_OVERRIDE_KEY];
  return raw === 'pro' || raw === 'free' ? raw : null;
}

export const useProStore = create<ProState>()((set) => {
  // Runtime state outside React state: the configured client, the dev flag,
  // the RevenueCat-derived status, and a generation so a stale init/refresh
  // (or a listener from a replaced init) cannot overwrite a newer result.
  let client: PurchasesClient | null = null;
  let isDev = false;
  let base: Base = PENDING;
  let unsubscribe: (() => void) | null = null;
  let generation = 0;

  function apply(): void {
    const override = isDev ? readProOverride(useSettingsStore.getState().values) : null;
    if (base.status !== 'loading' && override !== null) {
      set({ status: override, source: 'dev-override' });
    } else {
      set({ status: base.status, source: base.source });
    }
  }

  function update(gen: number, next: Base): void {
    if (gen !== generation) return;
    base = next;
    apply();
  }

  function fromInfo(info: CustomerInfo): Base {
    return { status: hasProEntitlement(info) ? 'pro' : 'free', source: 'revenuecat' };
  }

  return {
    ...PENDING,
    init: async (nextClient, options = {}) => {
      const gen = ++generation;
      unsubscribe?.();
      unsubscribe = null;
      client = null;
      isDev = options.isDev ?? __DEV__;
      base = PENDING;
      apply();

      const apiKey =
        options.apiKey === undefined ? revenueCatApiKey() : revenueCatApiKey(options.apiKey ?? '');
      if (apiKey === null) {
        update(gen, { status: 'free', source: 'unconfigured' });
        return;
      }
      try {
        await nextClient.configure(apiKey);
        const info = await nextClient.getCustomerInfo();
        if (gen !== generation) return;
        client = nextClient;
        update(gen, fromInfo(info));
        unsubscribe = nextClient.addCustomerInfoUpdateListener((next) =>
          update(gen, fromInfo(next)),
        );
      } catch {
        client = null;
        update(gen, { status: 'free', source: 'error' });
      }
    },
    refresh: async () => {
      const gen = generation;
      if (client === null) {
        apply();
        return;
      }
      try {
        update(gen, fromInfo(await client.getCustomerInfo()));
      } catch {
        update(gen, { status: 'free', source: 'error' });
      }
    },
  };
});
