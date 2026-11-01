import {
  defaultOption,
  freeTrialLabel,
  isUserCancelled,
  paywallOptions,
} from '../paywallModel';
import { freePhase, fullOffering, offering, pkg, product } from '../paywallTestFixtures';

describe('paywallOptions', () => {
  it('orders a full offering monthly, annual, lifetime with the store prices', () => {
    const options = paywallOptions(fullOffering());
    expect(options.map((o) => [o.kind, o.title, o.priceLabel, o.trialLabel])).toEqual([
      ['monthly', 'Monthly', '£2.49 a month', null],
      ['annual', 'Annual', '£14.99 a year', '7-day free trial'],
      ['lifetime', 'Lifetime', '£29.99 once', null],
    ]);
    expect(options[1].priceString).toBe('£14.99');
    expect(options[1].pkg.packageType).toBe('ANNUAL');
  });

  it('skips missing packages and ignores package types it does not offer', () => {
    const options = paywallOptions(
      offering([pkg('WEEKLY', product('£0.99')), pkg('LIFETIME', product('£29.99'))]),
    );
    expect(options.map((o) => o.kind)).toEqual(['lifetime']);
  });

  it('is empty for no offering or an empty one', () => {
    expect(paywallOptions(null)).toEqual([]);
    expect(paywallOptions(undefined)).toEqual([]);
    expect(paywallOptions(offering([]))).toEqual([]);
  });

  it('shows no trial on the annual plan unless the product reports one', () => {
    const [annual] = paywallOptions(offering([pkg('ANNUAL', product('£14.99'))]));
    expect(annual.trialLabel).toBeNull();
  });
});

describe('freeTrialLabel', () => {
  it('reads the Google Play free phase', () => {
    expect(freeTrialLabel(product('£1', { defaultOption: freePhase('WEEK', 1) }))).toBe(
      '7-day free trial',
    );
    expect(freeTrialLabel(product('£1', { defaultOption: freePhase('MONTH', 1) }))).toBe(
      '1-month free trial',
    );
    expect(freeTrialLabel(product('£1', { defaultOption: freePhase('YEAR', 1) }))).toBe(
      '1-year free trial',
    );
    expect(freeTrialLabel(product('£1', { defaultOption: freePhase('UNKNOWN', 1) }))).toBe(
      'Free trial',
    );
  });

  it('falls back to a free intro price, but not a paid one', () => {
    const intro = (price: number) => ({
      introPrice: { price, priceString: '', cycles: 1, period: 'P7D', periodUnit: 'DAY', periodNumberOfUnits: 7 },
    });
    expect(freeTrialLabel(product('£1', intro(0)))).toBe('7-day free trial');
    expect(freeTrialLabel(product('£1', intro(0.99)))).toBeNull();
  });

  it('is null with a default option that has no free phase', () => {
    expect(freeTrialLabel(product('£1', { defaultOption: { freePhase: null } }))).toBeNull();
  });
});

describe('defaultOption', () => {
  it('picks annual when offered, else the first, else null', () => {
    expect(defaultOption(paywallOptions(fullOffering()))?.kind).toBe('annual');
    const noAnnual = paywallOptions(
      offering([pkg('MONTHLY', product('£2.49')), pkg('LIFETIME', product('£29.99'))]),
    );
    expect(defaultOption(noAnnual)?.kind).toBe('monthly');
    expect(defaultOption([])).toBeNull();
  });
});

describe('isUserCancelled', () => {
  it('is true for the cancel flag or code, false otherwise', () => {
    expect(isUserCancelled({ userCancelled: true })).toBe(true);
    expect(isUserCancelled({ code: '1', userCancelled: null })).toBe(true);
    expect(isUserCancelled({ code: '2', userCancelled: false })).toBe(false);
    expect(isUserCancelled(new Error('boom'))).toBe(false);
    expect(isUserCancelled(null)).toBe(false);
    expect(isUserCancelled('cancelled')).toBe(false);
  });
});
