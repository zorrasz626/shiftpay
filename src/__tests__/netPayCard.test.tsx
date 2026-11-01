import { fireEvent, render, screen, within } from '@testing-library/react-native';

import { ASSUMED_YEAR_TEXT, NET_PAY_TITLE, NetPayCard } from '../components/NetPayCard';
import { TAX_YEARS } from '../config/taxYears';
import { estimateNetPay } from '../engine/netPay';
import { formatPence, parsePoundsToPence, sumPence } from '../engine/money';
import { buildNetPayInput } from '../features/tax/netPayInput';
import { DEFAULT_TAX_PROFILE, type TaxProfile } from '../features/tax/taxProfile';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => 'light',
}));

const GROSS = 60_000;
const PAY_DATE = '2026-06-19';
// Well past the latest configured tax year.
const LATER_PAY_DATE = '2031-06-20';

const full: TaxProfile = {
  taxCode: '1257L',
  studentLoan: 'plan2',
  postgrad: false,
  pensionPercent: 5,
  pensionMethod: 'net_pay',
};

function shownDeductions(): number[] {
  return screen
    .getAllByTestId('net-pay-row')
    .map((row) => parsePoundsToPence(within(row).getByText(/£/).props.children.slice(1)) as number);
}

beforeEach(() => mockPush.mockClear());

describe('NetPayCard', () => {
  it('default profile: shows net, the tax year, the disclaimer; zero rows hidden', async () => {
    const expected = estimateNetPay(
      buildNetPayInput({
        profile: DEFAULT_TAX_PROFILE,
        grossPence: GROSS,
        frequency: 'weekly',
        payDate: PAY_DATE,
      }),
    );
    await render(
      <NetPayCard
        grossPence={GROSS}
        frequency="weekly"
        payDate={PAY_DATE}
        profile={DEFAULT_TAX_PROFILE}
      />,
    );

    expect(screen.getByRole('header', { name: NET_PAY_TITLE })).toBeTruthy();
    expect(screen.getByLabelText(formatPence(expected.netPence))).toBeTruthy();
    expect(screen.getByText('Income tax')).toBeTruthy();
    expect(screen.getByText('National Insurance')).toBeTruthy();
    expect(screen.queryByText('Student loan')).toBeNull();
    expect(screen.queryByText('Pension')).toBeNull();
    expect(GROSS - sumPence(shownDeductions())).toBe(expected.netPence);
    expect(screen.getByText(`Using ${TAX_YEARS[TAX_YEARS.length - 1].id} tax year`)).toBeTruthy();
    expect(screen.queryByText(ASSUMED_YEAR_TEXT)).toBeNull();
    // The host screen shows the disclaimer; the card does not repeat it.
    expect(screen.queryByText(/Estimates only/)).toBeNull();
  });

  it('shows every non-zero deduction; net = gross − shown deductions', async () => {
    const expected = estimateNetPay(
      buildNetPayInput({
        profile: full,
        grossPence: GROSS,
        frequency: 'weekly',
        payDate: PAY_DATE,
      }),
    );
    expect(expected.studentLoanPence).toBeGreaterThan(0);
    await render(
      <NetPayCard grossPence={GROSS} frequency="weekly" payDate={PAY_DATE} profile={full} />,
    );

    expect(screen.getAllByTestId('net-pay-row')).toHaveLength(4);
    expect(screen.getByText('Student loan')).toBeTruthy();
    expect(screen.getByText('Pension')).toBeTruthy();
    expect(GROSS - sumPence(shownDeductions())).toBe(expected.netPence);
  });

  it('says rates are assumed when the pay date is beyond the configured years', async () => {
    await render(
      <NetPayCard
        grossPence={GROSS}
        frequency="weekly"
        payDate={LATER_PAY_DATE}
        profile={DEFAULT_TAX_PROFILE}
      />,
    );
    expect(screen.getByText(/^Using .* tax year$/)).toBeTruthy();
    expect(screen.getByText(ASSUMED_YEAR_TEXT)).toBeTruthy();
  });

  it('opens Tax settings', async () => {
    await render(
      <NetPayCard
        grossPence={GROSS}
        frequency="weekly"
        payDate={PAY_DATE}
        profile={DEFAULT_TAX_PROFILE}
      />,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Tax settings' }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/settings/tax' });
  });
});
