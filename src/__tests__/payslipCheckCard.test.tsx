import { render, screen, within } from '@testing-library/react-native';

import { NO_CAUSE_TEXT, payslipChip, type PayslipCheckView } from '../engine/payslipCheck';
import {
  formatSignedHours,
  formatSignedPence,
  PayslipCheckCard,
} from '../features/pay/PayslipCheckCard';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => 'light',
}));

function view(
  status: PayslipCheckView['status'],
  expectedPence: number,
  paidPence: number,
  extra: Partial<PayslipCheckView> = {},
): PayslipCheckView {
  const diffPence = paidPence - expectedPence;
  const chip = payslipChip(status, diffPence);
  return {
    status,
    chipLabel: chip.label,
    chipTone: chip.tone,
    expectedPence,
    paidPence,
    diffPence,
    expectedHours: 37.5,
    causes: [],
    ...extra,
  };
}

const UNDERPAID_CAUSE = 'Sunday for 7 Jun not found on payslip?';

const rowValue = (testID: string): string =>
  within(screen.getByTestId(testID)).getAllByText(/./)[1].props.children as string;

describe('PayslipCheckCard', () => {
  it('match: "Match" chip, £0.00 difference, no causes', async () => {
    await render(<PayslipCheckCard check={view('match', 50000, 50000)} />);
    expect(screen.getByRole('header', { name: 'Payslip check' })).toBeTruthy();
    expect(within(screen.getByTestId('chip')).getByText('Match')).toBeTruthy();
    expect(rowValue('check-expected')).toBe('£500.00');
    expect(rowValue('check-paid')).toBe('£500.00');
    expect(rowValue('check-difference')).toBe('£0.00');
    expect(screen.queryByText('Likely causes')).toBeNull();
    expect(screen.queryByTestId('check-causes')).toBeNull();
  });

  it('underpaid: chip "Underpaid by £X", negative difference, cause text', async () => {
    await render(
      <PayslipCheckCard check={view('underpaid', 50000, 48200, { causes: [UNDERPAID_CAUSE] })} />,
    );
    expect(screen.getByText('Underpaid by £18.00')).toBeTruthy();
    expect(rowValue('check-paid')).toBe('£482.00');
    expect(rowValue('check-difference')).toBe('−£18.00');
    const causes = within(screen.getByTestId('check-causes'));
    expect(causes.getByText('Likely causes')).toBeTruthy();
    expect(causes.getByText(UNDERPAID_CAUSE)).toBeTruthy();
  });

  it('overpaid: chip "Overpaid by £X", positive difference, the no-cause text', async () => {
    await render(
      <PayslipCheckCard check={view('overpaid', 50000, 50120, { causes: [NO_CAUSE_TEXT] })} />,
    );
    expect(screen.getByText('Overpaid by £1.20')).toBeTruthy();
    expect(rowValue('check-difference')).toBe('+£1.20');
    expect(within(screen.getByTestId('check-causes')).getByText(NO_CAUSE_TEXT)).toBeTruthy();
  });

  it('no hours rows without hours paid', async () => {
    await render(<PayslipCheckCard check={view('match', 50000, 50000)} />);
    expect(screen.queryByText('Expected hours')).toBeNull();
    expect(screen.queryByText('Paid hours')).toBeNull();
    expect(screen.queryByText('Hours difference')).toBeNull();
  });

  it('hours rows with hours paid, signed difference', async () => {
    await render(
      <PayslipCheckCard
        check={view('check', 50000, 50050, { paidHours: 35, diffHours: -2.5 })}
      />,
    );
    expect(screen.getByText('Check')).toBeTruthy();
    expect(rowValue('check-expected-hours')).toBe('37.5 h');
    expect(rowValue('check-paid-hours')).toBe('35 h');
    expect(rowValue('check-hours-difference')).toBe('−2.5 h');
  });
});

describe('signed formatting', () => {
  it('pence', () => {
    expect(formatSignedPence(120)).toBe('+£1.20');
    expect(formatSignedPence(-1800)).toBe('−£18.00');
    expect(formatSignedPence(0)).toBe('£0.00');
    expect(formatSignedPence(123456)).toBe('+£1,234.56');
  });

  it('hours', () => {
    expect(formatSignedHours(1.5)).toBe('+1.5 h');
    expect(formatSignedHours(-2)).toBe('−2 h');
    expect(formatSignedHours(0)).toBe('0 h');
    expect(formatSignedHours(-0.001)).toBe('0 h');
  });
});
