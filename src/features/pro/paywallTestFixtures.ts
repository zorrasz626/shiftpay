/** Shared paywall fixtures for the pro tests. Never import this from app code. */
import type {
  PurchasesOffering,
  PurchasesPackage,
  PurchasesStoreProduct,
} from 'react-native-purchases';

/** Test-only store data; the real values come from Google Play via RevenueCat. */
export function product(
  priceString: string,
  extra: Partial<Record<keyof PurchasesStoreProduct, unknown>> = {},
): PurchasesStoreProduct {
  return {
    identifier: `id-${priceString}`,
    priceString,
    introPrice: null,
    defaultOption: null,
    ...extra,
  } as unknown as PurchasesStoreProduct;
}

export function pkg(packageType: string, prod: PurchasesStoreProduct): PurchasesPackage {
  return {
    identifier: `$rc_${packageType.toLowerCase()}`,
    packageType,
    product: prod,
  } as unknown as PurchasesPackage;
}

/** A Google Play free phase of `value` `unit`s on the default option. */
export function freePhase(unit: string, value: number): Record<string, unknown> {
  return { freePhase: { billingPeriod: { unit, value, iso8601: `P${value}${unit[0]}` } } };
}

export function offering(packages: PurchasesPackage[]): PurchasesOffering {
  return { identifier: 'default', availablePackages: packages } as unknown as PurchasesOffering;
}

/** Monthly £2.49, annual £14.99 with a 7-day trial, lifetime £29.99 (shuffled order). */
export function fullOffering(): PurchasesOffering {
  return offering([
    pkg('LIFETIME', product('£29.99')),
    pkg('ANNUAL', product('£14.99', { defaultOption: freePhase('DAY', 7) })),
    pkg('MONTHLY', product('£2.49')),
  ]);
}
