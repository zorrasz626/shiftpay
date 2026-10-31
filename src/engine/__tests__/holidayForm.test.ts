import {
  HOLIDAY_ENTITLEMENT_MAX,
  HOLIDAY_FORM_MESSAGES,
  type HolidayFormValues,
  formToHolidaySettings,
  holidayFormErrors,
  jobToHolidayForm,
} from '../holidayForm';

const JOB = {
  holidayMode: 'fixed' as const,
  holidayEntitlementHours: 210,
  holidayYearStart: '2026-04-01',
};

function form(overrides: Partial<HolidayFormValues> = {}): HolidayFormValues {
  return { ...jobToHolidayForm(JOB), ...overrides };
}

function fields(values: HolidayFormValues): string[] {
  return holidayFormErrors(values).map((e) => e.field);
}

describe('jobToHolidayForm', () => {
  it('copies the mode, hours as text and the year start', () => {
    expect(jobToHolidayForm(JOB)).toEqual({
      mode: 'fixed',
      entitlementText: '210',
      yearStartText: '2026-04-01',
    });
    expect(
      jobToHolidayForm({ ...JOB, holidayMode: 'accrual', holidayEntitlementHours: 151.2 }),
    ).toEqual({ mode: 'accrual', entitlementText: '151.2', yearStartText: '2026-04-01' });
  });

  it('round-trips through formToHolidaySettings', () => {
    expect(formToHolidaySettings(jobToHolidayForm(JOB), JOB)).toEqual(JOB);
    const accrual = { ...JOB, holidayMode: 'accrual' as const, holidayEntitlementHours: 151.2 };
    expect(formToHolidaySettings(jobToHolidayForm(accrual), accrual)).toEqual(accrual);
  });
});

describe('holidayFormErrors', () => {
  it('accepts a valid fixed form, decimals and the maximum', () => {
    expect(holidayFormErrors(form())).toEqual([]);
    expect(fields(form({ entitlementText: ' 151.2 ' }))).toEqual([]);
    expect(fields(form({ entitlementText: String(HOLIDAY_ENTITLEMENT_MAX) }))).toEqual([]);
    expect(fields(form({ yearStartText: ' 2027-01-01 ' }))).toEqual([]);
  });

  it.each(['', '  ', '0', '0.0', '2000.5', '2001', '1.2.3', '-5', '1e2', '1,5', 'abc'])(
    'rejects entitlement %j in fixed mode',
    (text) => {
      expect(holidayFormErrors(form({ entitlementText: text }))).toEqual([
        { field: 'entitlementText', message: HOLIDAY_FORM_MESSAGES.entitlement },
      ]);
    },
  );

  it('ignores the entitlement in accrual mode', () => {
    expect(fields(form({ mode: 'accrual', entitlementText: '' }))).toEqual([]);
    expect(fields(form({ mode: 'accrual', entitlementText: '1.2.3' }))).toEqual([]);
  });

  it.each(['', '2026-02-30', '2026-13-01', '2026-4-1', '01/04/2026', 'tomorrow'])(
    'rejects year start %j',
    (text) => {
      expect(holidayFormErrors(form({ yearStartText: text }))).toEqual([
        { field: 'yearStartText', message: HOLIDAY_FORM_MESSAGES.yearStart },
      ]);
    },
  );

  it('reports both fields at once', () => {
    expect(fields(form({ entitlementText: '0', yearStartText: '2026-02-30' }))).toEqual([
      'entitlementText',
      'yearStartText',
    ]);
  });
});

describe('formToHolidaySettings', () => {
  it('saves fixed hours and a trimmed year start', () => {
    expect(
      formToHolidaySettings(
        form({ entitlementText: ' 168.75 ', yearStartText: ' 2027-01-01 ' }),
        JOB,
      ),
    ).toEqual({
      holidayMode: 'fixed',
      holidayEntitlementHours: 168.75,
      holidayYearStart: '2027-01-01',
    });
  });

  it("keeps the job's entitlement hours in accrual mode", () => {
    expect(
      formToHolidaySettings(form({ mode: 'accrual', entitlementText: 'junk' }), JOB),
    ).toEqual({ holidayMode: 'accrual', holidayEntitlementHours: 210, holidayYearStart: '2026-04-01' });
  });

  it('throws on an invalid form, naming the fields', () => {
    expect(() =>
      formToHolidaySettings(form({ entitlementText: '', yearStartText: 'x' }), JOB),
    ).toThrow('Invalid holiday form: entitlementText, yearStartText');
  });
});
