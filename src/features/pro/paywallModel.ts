/**
 * Pure paywall logic (SPEC §8): turns the current RevenueCat offering into the
 * ordered plan list the paywall shows. Prices and trials come only from the
 * store's product data, never from constants here.
 *
 * Type-only SDK imports: comparing against string literals instead of the
 * SDK's enums keeps the native module out of this file (and out of Jest).
 */
import type {
  PurchasesOffering,
  PurchasesPackage,
  PurchasesStoreProduct,
} from 'react-native-purchases';

export type PlanKind = 'monthly' | 'annual' | 'lifetime';

export interface PaywallOption {
  kind: PlanKind;
  /** "Monthly", "Annual", "Lifetime". */
  title: string;
  /** The store's localized price, e.g. "£1.99". */
  priceString: string;
  /** "£1.99 a month", "£12.99 a year", "£24.99 once". */
  priceLabel: string;
  /** "7-day free trial" when the product reports a free trial, else null. */
  trialLabel: string | null;
  pkg: PurchasesPackage;
}

interface Plan {
  kind: PlanKind;
  /** RevenueCat `PACKAGE_TYPE` value. */
  packageType: string;
  title: string;
  suffix: string;
}

/** Display order. */
const PLANS: readonly Plan[] = [
  { kind: 'monthly', packageType: 'MONTHLY', title: 'Monthly', suffix: 'a month' },
  { kind: 'annual', packageType: 'ANNUAL', title: 'Annual', suffix: 'a year' },
  { kind: 'lifetime', packageType: 'LIFETIME', title: 'Lifetime', suffix: 'once' },
];

/** "7-day free trial", "1-month free trial"; a unit we don't know → "Free trial". */
function trialText(unit: string, count: number): string {
  switch (unit) {
    case 'DAY':
      return `${count}-day free trial`;
    case 'WEEK':
      return `${count * 7}-day free trial`;
    case 'MONTH':
      return `${count}-month free trial`;
    case 'YEAR':
      return `${count}-year free trial`;
    default:
      return 'Free trial';
  }
}

/**
 * The free trial the store reports for this product, or null. Google Play
 * puts it in the default subscription option's free phase; the intro price
 * (price 0) is the fallback.
 */
export function freeTrialLabel(product: PurchasesStoreProduct): string | null {
  const free = product.defaultOption?.freePhase ?? null;
  if (free !== null) return trialText(free.billingPeriod.unit, free.billingPeriod.value);
  const intro = product.introPrice;
  if (intro !== null && intro !== undefined && intro.price === 0) {
    return trialText(intro.periodUnit, intro.periodNumberOfUnits * Math.max(1, intro.cycles));
  }
  return null;
}

/** Monthly, annual, lifetime (in that order), skipping any the offering lacks. */
export function paywallOptions(offering: PurchasesOffering | null | undefined): PaywallOption[] {
  if (offering === null || offering === undefined) return [];
  const options: PaywallOption[] = [];
  for (const plan of PLANS) {
    const pkg = offering.availablePackages.find((p) => p.packageType === plan.packageType);
    if (pkg === undefined) continue;
    const { priceString } = pkg.product;
    options.push({
      kind: plan.kind,
      title: plan.title,
      priceString,
      priceLabel: `${priceString} ${plan.suffix}`,
      trialLabel: freeTrialLabel(pkg.product),
      pkg,
    });
  }
  return options;
}

/** The annual plan when offered (it carries the trial), else the first option. */
export function defaultOption(options: readonly PaywallOption[]): PaywallOption | null {
  return options.find((o) => o.kind === 'annual') ?? options[0] ?? null;
}

/** RevenueCat's `PURCHASE_CANCELLED_ERROR` code. */
const PURCHASE_CANCELLED = '1';

/** True when the SDK error means the user backed out of the store sheet. */
export function isUserCancelled(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const e = error as { userCancelled?: unknown; code?: unknown };
  return e.userCancelled === true || e.code === PURCHASE_CANCELLED;
}
