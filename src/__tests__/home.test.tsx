import { render, screen } from '@testing-library/react-native';

import HomeScreen from '../../app/index';

describe('HomeScreen', () => {
  it('shows the title and disclaimer', async () => {
    await render(<HomeScreen />);
    expect(screen.getByText('ShiftPay')).toBeTruthy();
    expect(screen.getByText(/Estimates only/)).toBeTruthy();
  });
});
