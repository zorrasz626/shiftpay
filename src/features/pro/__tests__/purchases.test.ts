import { revenueCatClient } from '../purchases';

// The real adapter over a mocked SDK: Jest never loads the native module.
jest.mock('react-native-purchases', () => ({
  __esModule: true,
  default: {
    configure: jest.fn(),
    getCustomerInfo: jest.fn(() => Promise.resolve('info')),
    addCustomerInfoUpdateListener: jest.fn(),
    removeCustomerInfoUpdateListener: jest.fn(() => true),
    getOfferings: jest.fn(() => Promise.resolve('offerings')),
    purchasePackage: jest.fn(() => Promise.resolve('purchase')),
    restorePurchases: jest.fn(() => Promise.resolve('restored')),
  },
}));

const sdk = (jest.requireMock('react-native-purchases') as { default: Record<string, jest.Mock> })
  .default;

describe('revenueCatClient', () => {
  it('passes calls through to the SDK', async () => {
    revenueCatClient.configure('key');
    expect(sdk.configure).toHaveBeenCalledWith({ apiKey: 'key' });
    await expect(revenueCatClient.getCustomerInfo()).resolves.toBe('info');
    await expect(revenueCatClient.getOfferings()).resolves.toBe('offerings');
    await expect(revenueCatClient.purchasePackage('pkg' as never)).resolves.toBe('purchase');
    expect(sdk.purchasePackage).toHaveBeenCalledWith('pkg');
    await expect(revenueCatClient.restorePurchases()).resolves.toBe('restored');
  });

  it('adds and removes the customer info listener', () => {
    const listener = jest.fn();
    const unsubscribe = revenueCatClient.addCustomerInfoUpdateListener(listener);
    expect(sdk.addCustomerInfoUpdateListener).toHaveBeenCalledWith(listener);
    unsubscribe();
    expect(sdk.removeCustomerInfoUpdateListener).toHaveBeenCalledWith(listener);
  });
});
