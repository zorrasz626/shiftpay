import { act, renderHook } from '@testing-library/react-native';
import type { CustomerInfo } from 'react-native-purchases';

import { useSettingsStore } from '../../../store/settingsStore';
import { PRO_OVERRIDE_KEY, readProOverride, useProStore } from '../proStore';
import type { PurchasesClient } from '../purchases';
import { hasProEntitlement, PRO_ENTITLEMENT_ID, revenueCatApiKey } from '../purchases';
import { useEntitlement } from '../useEntitlement';

const KEY = 'test_public_key';

function info(entitled: boolean): CustomerInfo {
  const active = entitled ? { [PRO_ENTITLEMENT_ID]: { identifier: PRO_ENTITLEMENT_ID } } : {};
  return { entitlements: { active, all: active } } as unknown as CustomerInfo;
}

interface FakeClient extends PurchasesClient {
  emit: (info: CustomerInfo) => void;
  unsubscribed: jest.Mock;
}

function fakeClient(initial: CustomerInfo | Error = info(false)): FakeClient {
  let listener: ((i: CustomerInfo) => void) | null = null;
  const unsubscribed = jest.fn();
  return {
    configure: jest.fn(),
    getCustomerInfo: jest.fn(() =>
      initial instanceof Error ? Promise.reject(initial) : Promise.resolve(initial),
    ),
    addCustomerInfoUpdateListener: jest.fn((l: (i: CustomerInfo) => void) => {
      listener = l;
      return unsubscribed;
    }),
    getOfferings: jest.fn(),
    purchasePackage: jest.fn(),
    restorePurchases: jest.fn(),
    emit: (i) => listener?.(i),
    unsubscribed,
  };
}

function callCount(client: FakeClient): number {
  return [
    client.configure,
    client.getCustomerInfo,
    client.addCustomerInfoUpdateListener,
    client.getOfferings,
    client.purchasePackage,
    client.restorePurchases,
  ].reduce((n, fn) => n + (fn as jest.Mock).mock.calls.length, 0);
}

const state = () => useProStore.getState();

beforeEach(() => {
  useSettingsStore.setState({ values: {}, loaded: true });
  useProStore.setState({ status: 'loading', source: 'pending' });
});

describe('proStore.init', () => {
  it('is pro with an active pro entitlement', async () => {
    const client = fakeClient(info(true));
    await state().init(client, { apiKey: KEY, isDev: false });
    expect(client.configure).toHaveBeenCalledWith(KEY);
    expect(state().status).toBe('pro');
    expect(state().source).toBe('revenuecat');
  });

  it('is free without the entitlement', async () => {
    await state().init(fakeClient(info(false)), { apiKey: KEY, isDev: false });
    expect(state().status).toBe('free');
    expect(state().source).toBe('revenuecat');
  });

  it('is free (never throws) when configure throws', async () => {
    const client = fakeClient(info(true));
    (client.configure as jest.Mock).mockImplementation(() => {
      throw new Error('bad key');
    });
    await expect(state().init(client, { apiKey: KEY, isDev: false })).resolves.toBeUndefined();
    expect(state().status).toBe('free');
    expect(state().source).toBe('error');
  });

  it('is free (never throws) when getCustomerInfo rejects', async () => {
    await expect(
      state().init(fakeClient(new Error('offline')), { apiKey: KEY, isDev: false }),
    ).resolves.toBeUndefined();
    expect(state().status).toBe('free');
    expect(state().source).toBe('error');
  });

  it('follows customer info updates from the listener', async () => {
    const client = fakeClient(info(false));
    await state().init(client, { apiKey: KEY, isDev: false });
    expect(state().status).toBe('free');
    client.emit(info(true));
    expect(state().status).toBe('pro');
    client.emit(info(false));
    expect(state().status).toBe('free');
  });

  it.each([null, '', '   '])(
    'is free with zero client calls when the key is %p',
    async (apiKey) => {
      const client = fakeClient(info(true));
      await state().init(client, { apiKey, isDev: false });
      expect(state().status).toBe('free');
      expect(state().source).toBe('unconfigured');
      expect(callCount(client)).toBe(0);
    },
  );

  it('reads the key from the environment by default (unset in tests)', async () => {
    const client = fakeClient(info(true));
    await state().init(client, { isDev: false });
    expect(state().source).toBe('unconfigured');
    expect(callCount(client)).toBe(0);
  });

  it('drops the old listener when initialised again', async () => {
    const first = fakeClient(info(false));
    await state().init(first, { apiKey: KEY, isDev: false });
    await state().init(fakeClient(info(false)), { apiKey: KEY, isDev: false });
    expect(first.unsubscribed).toHaveBeenCalledTimes(1);
    first.emit(info(true));
    expect(state().status).toBe('free');
  });
});

describe('proStore.refresh', () => {
  it('re-reads customer info', async () => {
    const client = fakeClient(info(false));
    await state().init(client, { apiKey: KEY, isDev: false });
    (client.getCustomerInfo as jest.Mock).mockResolvedValueOnce(info(true));
    await state().refresh();
    expect(state().status).toBe('pro');
  });

  it('fails closed to free on error', async () => {
    const client = fakeClient(info(true));
    await state().init(client, { apiKey: KEY, isDev: false });
    (client.getCustomerInfo as jest.Mock).mockRejectedValueOnce(new Error('offline'));
    await state().refresh();
    expect(state().status).toBe('free');
    expect(state().source).toBe('error');
  });
});

describe('dev override', () => {
  it("'pro' wins over RevenueCat when the dev flag is true", async () => {
    useSettingsStore.setState({ values: { [PRO_OVERRIDE_KEY]: 'pro' } });
    await state().init(fakeClient(info(false)), { apiKey: KEY, isDev: true });
    expect(state().status).toBe('pro');
    expect(state().source).toBe('dev-override');
  });

  it("'free' wins over an active entitlement when the dev flag is true", async () => {
    useSettingsStore.setState({ values: { [PRO_OVERRIDE_KEY]: 'free' } });
    await state().init(fakeClient(info(true)), { apiKey: KEY, isDev: true });
    expect(state().status).toBe('free');
    expect(state().source).toBe('dev-override');
  });

  it('applies without an API key', async () => {
    useSettingsStore.setState({ values: { [PRO_OVERRIDE_KEY]: 'pro' } });
    await state().init(fakeClient(), { apiKey: null, isDev: true });
    expect(state().status).toBe('pro');
  });

  it('is ignored when the dev flag is false', async () => {
    useSettingsStore.setState({ values: { [PRO_OVERRIDE_KEY]: 'pro' } });
    await state().init(fakeClient(info(false)), { apiKey: KEY, isDev: false });
    expect(state().status).toBe('free');
    expect(state().source).toBe('revenuecat');
  });

  it('refresh picks up a changed override', async () => {
    await state().init(fakeClient(info(false)), { apiKey: null, isDev: true });
    expect(state().status).toBe('free');
    useSettingsStore.setState({ values: { [PRO_OVERRIDE_KEY]: 'pro' } });
    await state().refresh();
    expect(state().status).toBe('pro');
    useSettingsStore.setState({ values: {} });
    await state().refresh();
    expect(state().status).toBe('free');
    expect(state().source).toBe('unconfigured');
  });

  it('treats unexpected values as no override', () => {
    expect(readProOverride({ [PRO_OVERRIDE_KEY]: 'yes' })).toBeNull();
    expect(readProOverride({ [PRO_OVERRIDE_KEY]: null })).toBeNull();
    expect(readProOverride({})).toBeNull();
  });
});

describe('useEntitlement', () => {
  it('treats loading as not Pro and follows the store', async () => {
    const { result } = await renderHook(() => useEntitlement());
    expect(result.current).toEqual({ isPro: false, status: 'loading' });
    await act(async () => {
      await state().init(fakeClient(info(true)), { apiKey: KEY, isDev: false });
    });
    expect(result.current).toEqual({ isPro: true, status: 'pro' });
  });
});

describe('purchases helpers', () => {
  it('normalises the API key', () => {
    expect(revenueCatApiKey(undefined)).toBeNull();
    expect(revenueCatApiKey(' ')).toBeNull();
    expect(revenueCatApiKey(' abc ')).toBe('abc');
  });

  it('checks the pro entitlement', () => {
    expect(hasProEntitlement(info(true))).toBe(true);
    expect(hasProEntitlement(info(false))).toBe(false);
  });
});
