/**
 * Thin adapter over RevenueCat (`react-native-purchases`, Google Play Billing).
 * The entitlement store (`proStore.ts`) talks only to the `PurchasesClient`
 * interface so it can be tested with a fake; this file is the one place that
 * touches the SDK.
 *
 * The SDK is loaded lazily, on the first real call, so importing this file
 * (e.g. for the constants) never loads the native module. Jest therefore never
 * touches it unless a test calls the real adapter, which must mock it.
 */
import type {
  CustomerInfo,
  MakePurchaseResult,
  PurchasesOfferings,
  PurchasesPackage,
} from 'react-native-purchases';

/** The RevenueCat entitlement that unlocks Pro. */
export const PRO_ENTITLEMENT_ID = 'pro';

export interface PurchasesClient {
  configure(apiKey: string): void | Promise<void>;
  getCustomerInfo(): Promise<CustomerInfo>;
  /** Calls `listener` whenever RevenueCat pushes new customer info. Returns an unsubscribe. */
  addCustomerInfoUpdateListener(listener: (info: CustomerInfo) => void): () => void;
  getOfferings(): Promise<PurchasesOfferings>;
  purchasePackage(pkg: PurchasesPackage): Promise<MakePurchaseResult>;
  restorePurchases(): Promise<CustomerInfo>;
}

/**
 * The public Android SDK key from `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` (set in
 * a git-ignored `.env`), or null when missing/blank: the app then runs as Free
 * without calling the SDK.
 */
export function revenueCatApiKey(
  raw: string | undefined = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY,
): string | null {
  const key = raw?.trim() ?? '';
  return key === '' ? null : key;
}

/** True when the customer has the active `pro` entitlement. */
export function hasProEntitlement(info: CustomerInfo): boolean {
  return info.entitlements.active[PRO_ENTITLEMENT_ID] !== undefined;
}

type Sdk = typeof import('react-native-purchases').default;

function sdk(): Sdk {
  // Lazy on purpose (see the file comment): a static import would load the
  // native module wherever this file is imported, including Jest.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require('react-native-purchases') as typeof import('react-native-purchases')).default;
}

/** The real client over the RevenueCat SDK. */
export const revenueCatClient: PurchasesClient = {
  configure(apiKey) {
    sdk().configure({ apiKey });
  },
  getCustomerInfo: () => sdk().getCustomerInfo(),
  addCustomerInfoUpdateListener(listener) {
    const Purchases = sdk();
    Purchases.addCustomerInfoUpdateListener(listener);
    return () => {
      Purchases.removeCustomerInfoUpdateListener(listener);
    };
  },
  getOfferings: () => sdk().getOfferings(),
  purchasePackage: (pkg) => sdk().purchasePackage(pkg),
  restorePurchases: () => sdk().restorePurchases(),
};
