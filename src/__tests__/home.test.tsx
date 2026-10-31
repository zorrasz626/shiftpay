import { render, screen } from '@testing-library/react-native';

import HomeScreen from '../../app/(tabs)/index';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

describe('HomeScreen', () => {
  it('shows the title and disclaimer', async () => {
    await render(<HomeScreen />);
    expect(screen.getByText('ShiftPay')).toBeTruthy();
    expect(screen.getByText(/Estimates only/)).toBeTruthy();
  });
});
