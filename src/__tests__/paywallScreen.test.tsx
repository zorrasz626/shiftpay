import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { CustomerInfo, MakePurchaseResult, PurchasesOfferings } from 'react-native-purchases';

import SettingsScreen from '../../app/(tabs)/settings';
import PaywallScreen, {
  PaywallView,
  PRO_BENEFITS,
  PURCHASE_FAILED_MESSAGE,
  PURCHASE_PENDING_MESSAGE,
  RESTORE_DONE_MESSAGE,
  RESTORE_FAILED_MESSAGE,
  RESTORE_NONE_MESSAGE,
  UNAVAILABLE_MESSAGE,
} from '../../app/paywall';
import { useProStore } from '../features/pro/proStore';
import { PRO_ENTITLEMENT_ID, type PurchasesClient } from '../features/pro/purchases';
import { fullOffering, offering } from '../features/pro/paywallTestFixtures';
import { resetStores } from '../store/testFixtures';

jest.mock('../db/client', () => ({ db: require('../db/testDb').createTestDb() }));
const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
}));
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => 'light',
}));
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

const KEY = 'test_public_key';

function info(entitled: boolean): CustomerInfo {
  const active = entitled ? { [PRO_ENTITLEMENT_ID]: { identifier: PRO_ENTITLEMENT_ID } } : {};
  return { entitlements: { active, all: active } } as unknown as CustomerInfo;
}

interface Fake extends PurchasesClient {
  /** What the store reads back as the customer's entitlement. */
  entitled: boolean;
  getOfferings: jest.Mock;
  purchasePackage: jest.Mock;
  restorePurchases: jest.Mock;
  getCustomerInfo: jest.Mock;
}

function fakeClient(offerings: PurchasesOfferings | Error = offeringsOf(fullOffering())): Fake {
  const fake: Fake = {
    entitled: false,
    configure: jest.fn(),
    getCustomerInfo: jest.fn(async () => info(fake.entitled)),
    addCustomerInfoUpdateListener: jest.fn(() => () => {}),
    getOfferings: jest.fn(() =>
      offerings instanceof Error ? Promise.reject(offerings) : Promise.resolve(offerings),
    ),
    // Default: the store sheet completes and Play grants the entitlement.
    purchasePackage: jest.fn(async () => {
      fake.entitled = true;
      return { customerInfo: info(true), productIdentifier: 'p' } as unknown as MakePurchaseResult;
    }),
    restorePurchases: jest.fn(async () => info(fake.entitled)),
  };
  return fake;
}

function offeringsOf(current: ReturnType<typeof fullOffering> | null): PurchasesOfferings {
  return { current, all: {} } as unknown as PurchasesOfferings;
}

async function renderPaywall(client: Fake, apiKey: string | null = KEY) {
  await useProStore.getState().init(client, { apiKey, isDev: false });
  await render(<PaywallView client={client} apiKey={apiKey} />);
}

const plan = (name: RegExp) => screen.getByRole('radio', { name });
const button = (name: string | RegExp) => screen.getByRole('button', { name });
const restore = () => button('Restore purchases');

beforeEach(() => {
  resetStores();
  useProStore.setState({ status: 'loading', source: 'pending' });
  mockPush.mockClear();
  mockBack.mockClear();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('Paywall offering', () => {
  it('lists the benefits and the plans with the store prices, annual selected', async () => {
    const client = fakeClient();
    await renderPaywall(client);

    expect(await screen.findByRole('radio', { name: /^Annual/ })).toBeTruthy();
    for (const benefit of PRO_BENEFITS) expect(screen.getByText(`• ${benefit}`)).toBeTruthy();
    expect(screen.queryByText(/widget/i)).toBeNull();
    expect(plan(/^Monthly, £2\.49 a month$/)).toBeTruthy();
    expect(plan(/^Annual, £14\.99 a year, 7-day free trial$/)).toBeSelected();
    expect(plan(/^Lifetime, £29\.99 once$/)).not.toBeSelected();
    expect(button('Start 7-day free trial')).toBeEnabled();
    expect(restore()).toBeEnabled();
    expect(screen.getByText(/Estimates only/)).toBeTruthy();

    await fireEvent.press(plan(/^Monthly/));
    expect(plan(/^Monthly/)).toBeSelected();
    expect(button('Subscribe')).toBeTruthy();
    await fireEvent.press(plan(/^Lifetime/));
    expect(button('Buy lifetime')).toBeTruthy();
  });

  it('is unavailable without an API key, with no SDK calls and no restore', async () => {
    const client = fakeClient();
    await renderPaywall(client, null);

    expect(screen.getByText(UNAVAILABLE_MESSAGE)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Restore purchases' })).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(client.getOfferings).not.toHaveBeenCalled();
    expect(client.configure).not.toHaveBeenCalled();
  });

  it('the routed screen is unavailable when no key is set (Jest has none)', async () => {
    await useProStore.getState().init(fakeClient(), { apiKey: null, isDev: false });
    await render(<PaywallScreen />);
    expect(screen.getByText(UNAVAILABLE_MESSAGE)).toBeTruthy();
  });

  it('is unavailable when the offering fails to load', async () => {
    await renderPaywall(fakeClient(new Error('network')));
    expect(await screen.findByText(UNAVAILABLE_MESSAGE)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Restore purchases' })).toBeNull();
  });

  it.each([
    ['no current offering', null],
    ['an empty offering', offering([])],
  ])('is unavailable with %s', async (_label, current) => {
    await renderPaywall(fakeClient(offeringsOf(current)));
    expect(await screen.findByText(UNAVAILABLE_MESSAGE)).toBeTruthy();
    expect(screen.queryByRole('radio')).toBeNull();
  });

  it('shows the Pro state when already Pro on open', async () => {
    const client = fakeClient();
    client.entitled = true;
    await renderPaywall(client);

    expect(screen.getByRole('header', { name: "You're Pro" })).toBeTruthy();
    expect(screen.queryByRole('radio')).toBeNull();
    await fireEvent.press(button('Done'));
    expect(mockBack).toHaveBeenCalled();
  });
});

describe('Paywall purchase', () => {
  it('buys the selected package and shows the Pro state once the store says Pro', async () => {
    const client = fakeClient();
    await renderPaywall(client);
    await fireEvent.press(await screen.findByRole('button', { name: 'Start 7-day free trial' }));

    expect(await screen.findByRole('header', { name: "You're Pro" })).toBeTruthy();
    expect(client.purchasePackage).toHaveBeenCalledTimes(1);
    expect(client.purchasePackage.mock.calls[0][0].packageType).toBe('ANNUAL');
    expect(useProStore.getState().status).toBe('pro');
    expect(button('Done')).toBeTruthy();
  });

  it('says nothing when the user cancels', async () => {
    const client = fakeClient();
    client.purchasePackage.mockRejectedValue({ code: '1', userCancelled: true });
    await renderPaywall(client);
    await fireEvent.press(await screen.findByRole('button', { name: 'Start 7-day free trial' }));

    await waitFor(() => expect(button('Start 7-day free trial')).toBeEnabled());
    expect(screen.queryByText(PURCHASE_FAILED_MESSAGE)).toBeNull();
    expect(console.warn).not.toHaveBeenCalled();
    expect(useProStore.getState().status).toBe('free');
  });

  it('shows a short message on any other error and never grants Pro', async () => {
    const client = fakeClient();
    client.purchasePackage.mockRejectedValue({ code: '2', userCancelled: false });
    await renderPaywall(client);
    await fireEvent.press(await screen.findByRole('button', { name: 'Start 7-day free trial' }));

    expect(await screen.findByText(PURCHASE_FAILED_MESSAGE)).toBeTruthy();
    expect(button('Start 7-day free trial')).toBeEnabled();
    expect(useProStore.getState().status).toBe('free');
  });

  it('says the purchase is pending when the entitlement is not active yet', async () => {
    const client = fakeClient();
    client.purchasePackage.mockResolvedValue({} as MakePurchaseResult);
    await renderPaywall(client);
    await fireEvent.press(await screen.findByRole('button', { name: 'Start 7-day free trial' }));

    expect(await screen.findByText(PURCHASE_PENDING_MESSAGE)).toBeTruthy();
    expect(screen.queryByRole('header', { name: "You're Pro" })).toBeNull();
  });

  it('disables every button while busy, so a second tap does not buy twice', async () => {
    const client = fakeClient();
    let finish: () => void = () => {};
    client.purchasePackage.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => {
            client.entitled = true;
            resolve({} as MakePurchaseResult);
          };
        }),
    );
    await renderPaywall(client);
    const buy = await screen.findByRole('button', { name: 'Start 7-day free trial' });
    await fireEvent.press(buy);

    expect(button('Start 7-day free trial')).toBeDisabled();
    expect(restore()).toBeDisabled();
    expect(plan(/^Monthly/)).toBeDisabled();
    await fireEvent.press(button('Start 7-day free trial'));
    await fireEvent.press(restore());
    expect(client.purchasePackage).toHaveBeenCalledTimes(1);
    expect(client.restorePurchases).not.toHaveBeenCalled();

    finish();
    expect(await screen.findByRole('header', { name: "You're Pro" })).toBeTruthy();
  });

  it('retries the entitlement init when it failed at start-up', async () => {
    const client = fakeClient();
    client.getCustomerInfo.mockRejectedValueOnce(new Error('offline'));
    await renderPaywall(client);
    expect(useProStore.getState().source).toBe('error');

    await fireEvent.press(await screen.findByRole('button', { name: 'Start 7-day free trial' }));
    expect(await screen.findByRole('header', { name: "You're Pro" })).toBeTruthy();
    expect(useProStore.getState().source).toBe('revenuecat');
  });
});

describe('Paywall restore', () => {
  it('restores Pro and says so', async () => {
    const client = fakeClient();
    client.restorePurchases.mockImplementation(async () => {
      client.entitled = true;
      return info(true);
    });
    await renderPaywall(client);
    await fireEvent.press(await screen.findByRole('button', { name: 'Restore purchases' }));

    expect(await screen.findByRole('header', { name: "You're Pro" })).toBeTruthy();
    expect(screen.getByText(RESTORE_DONE_MESSAGE)).toBeTruthy();
  });

  it('says when no purchases are found', async () => {
    const client = fakeClient();
    await renderPaywall(client);
    await fireEvent.press(await screen.findByRole('button', { name: 'Restore purchases' }));

    expect(await screen.findByText(RESTORE_NONE_MESSAGE)).toBeTruthy();
    expect(useProStore.getState().status).toBe('free');
    expect(restore()).toBeEnabled();
  });

  it('shows a message when restore fails', async () => {
    const client = fakeClient();
    client.restorePurchases.mockRejectedValue(new Error('network'));
    await renderPaywall(client);
    await fireEvent.press(await screen.findByRole('button', { name: 'Restore purchases' }));

    expect(await screen.findByText(RESTORE_FAILED_MESSAGE)).toBeTruthy();
    expect(useProStore.getState().status).toBe('free');
  });
});

describe('Settings tab: ShiftPay Pro card', () => {
  it('opens the paywall, and says Pro active when Pro', async () => {
    useProStore.setState({ status: 'free', source: 'unconfigured' });
    await render(<SettingsScreen />);
    expect(screen.getByRole('header', { name: 'ShiftPay Pro' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: /^Upgrade to Pro/ }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/paywall' });

    useProStore.setState({ status: 'pro', source: 'revenuecat' });
    expect(await screen.findByRole('button', { name: /^Pro active/ })).toBeTruthy();
  });
});
