/**
 * The UK bank-holiday regions a Job can use (D5), with their display labels.
 * One list for the settings and onboarding pickers and the gov.uk refresh.
 */
import type { BankHolidayRegion } from '../engine/types';

export const BANK_HOLIDAY_REGION_OPTIONS: readonly [BankHolidayRegion, string][] = [
  ['england-and-wales', 'England and Wales'],
  ['scotland', 'Scotland'],
  ['northern-ireland', 'Northern Ireland'],
];

export const BANK_HOLIDAY_REGION_IDS: readonly BankHolidayRegion[] =
  BANK_HOLIDAY_REGION_OPTIONS.map(([region]) => region);
