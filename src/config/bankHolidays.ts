/**
 * The app's bank-holiday lookup, built once from the bundled gov.uk snapshot.
 * The engine never imports the JSON; app code passes this lookup in.
 */
import { type BankHolidayLookup, createBankHolidayLookup } from '../engine/bankHolidays';
import type { BankHolidayData } from '../engine/types';
import snapshot from './bankHolidays.json';

export const bankHolidays: BankHolidayLookup = createBankHolidayLookup(snapshot as BankHolidayData);
