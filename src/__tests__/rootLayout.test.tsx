import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import RootLayout, {
  ERROR_TEXT,
  ERROR_TITLE,
  ErrorBoundary,
  STARTUP_TIMEOUT_MS,
} from '../../app/_layout';

type Migrations = { success: boolean; error?: Error };
let mockMigrations: Migrations = { success: true };
const mockBootstrap = jest.fn();

jest.mock('drizzle-orm/expo-sqlite/migrator', () => ({
  useMigrations: () => mockMigrations,
}));
jest.mock('../../drizzle/migrations', () => ({}));
jest.mock('../db/client', () => ({ db: {} }));
jest.mock('../store/bootstrap', () => ({
  bootstrap: (...args: unknown[]) => mockBootstrap(...args),
}));
jest.mock('@expo-google-fonts/barlow', () => ({
  useFonts: () => [true, null],
  Barlow_400Regular: 1,
  Barlow_500Medium: 1,
}));
jest.mock('@expo-google-fonts/barlow-condensed', () => ({ BarlowCondensed_600SemiBold: 1 }));
jest.mock('expo-router', () => {
  const { Text } = require('react-native');
  return { Stack: () => <Text>App stack</Text> };
});
jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));
const mockNavigationBar = jest.fn((_props: { style?: string }) => null);
jest.mock('expo-navigation-bar', () => ({
  NavigationBar: (props: { style?: string }) => mockNavigationBar(props),
}));
jest.mock('../dev/tzSelfCheck', () => ({ tzSelfCheck: () => ({}) }));
jest.mock('../features/pro/proStore', () => ({
  useProStore: { getState: () => ({ init: () => Promise.resolve() }) },
}));
jest.mock('../features/pro/purchases', () => ({ revenueCatClient: {} }));
jest.mock('../services/bankHolidayRefresh', () => ({
  refreshBankHolidays: () => Promise.resolve(),
}));
jest.mock('../services/notifier', () => ({ expoNotifier: {} }));
jest.mock('../services/reminderSync', () => ({ startReminderSync: () => () => {} }));
let mockScheme: 'light' | 'dark' = 'light';
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => mockScheme,
}));
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

const g = globalThis as unknown as { __DEV__: boolean };

beforeEach(() => {
  mockMigrations = { success: true };
  mockScheme = 'light';
  mockNavigationBar.mockClear();
  mockBootstrap.mockReset();
  mockBootstrap.mockResolvedValue({});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('Root ErrorBoundary', () => {
  it('shows a friendly message and Try again calls retry', async () => {
    const retry = jest.fn(() => Promise.resolve());
    await render(<ErrorBoundary error={new Error('kaboom')} retry={retry} />);

    expect(screen.getByRole('header', { name: ERROR_TITLE })).toBeTruthy();
    expect(screen.getByText(ERROR_TEXT)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('shows the error detail in development only, never in release', async () => {
    await render(<ErrorBoundary error={new Error('kaboom')} retry={jest.fn()} />);
    expect(screen.getByTestId('error-detail')).toHaveTextContent('kaboom');

    const dev = g.__DEV__;
    g.__DEV__ = false;
    try {
      await render(<ErrorBoundary error={new Error('kaboom')} retry={jest.fn()} />);
      expect(screen.queryByTestId('error-detail')).toBeNull();
      expect(screen.queryByText(/kaboom/)).toBeNull();
      expect(screen.getByText(ERROR_TEXT)).toBeTruthy();
    } finally {
      g.__DEV__ = dev;
    }
  });
});

describe('Root layout start-up', () => {
  it('starts the app when migrations and loading succeed', async () => {
    await render(<RootLayout />);
    expect(await screen.findByText('App stack')).toBeTruthy();
    expect(mockBootstrap).toHaveBeenCalledTimes(1);
  });

  it('keeps the navigation-bar buttons readable across a live light/dark switch', async () => {
    const lastStyle = () => mockNavigationBar.mock.lastCall?.[0].style;
    const { rerender } = await render(<RootLayout />);
    expect(await screen.findByText('App stack')).toBeTruthy();
    expect(lastStyle()).toBe('dark');

    mockScheme = 'dark';
    await rerender(<RootLayout />);
    expect(lastStyle()).toBe('light');

    mockScheme = 'light';
    await rerender(<RootLayout />);
    expect(lastStyle()).toBe('dark');
  });

  it('shows the error screen on a migration failure; Try again runs start-up again', async () => {
    mockMigrations = { success: false, error: new Error('disk full') };
    await render(<RootLayout />);

    expect(screen.getByRole('header', { name: ERROR_TITLE })).toBeTruthy();
    expect(screen.getByTestId('error-detail')).toHaveTextContent(
      'Database migration failed: disk full',
    );
    expect(mockBootstrap).not.toHaveBeenCalled();

    mockMigrations = { success: true };
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('App stack')).toBeTruthy();
    expect(screen.queryByText(ERROR_TITLE)).toBeNull();
  });

  it('shows the error screen when loading data fails; Try again loads again', async () => {
    mockBootstrap.mockRejectedValueOnce(new Error('bad row'));
    await render(<RootLayout />);

    expect(await screen.findByText(ERROR_TEXT)).toBeTruthy();
    expect(screen.getByTestId('error-detail')).toHaveTextContent('Loading data failed: bad row');

    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(mockBootstrap).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('App stack')).toBeTruthy();
  });
});

describe('Root layout start-up watchdog', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  async function advance(ms: number): Promise<void> {
    await act(async () => {
      jest.advanceTimersByTime(ms);
    });
  }

  it('shows the error screen when migrations hang; Try again runs start-up again', async () => {
    mockMigrations = { success: false };
    await render(<RootLayout />);

    await advance(STARTUP_TIMEOUT_MS - 1);
    expect(screen.queryByText(ERROR_TEXT)).toBeNull();
    expect(screen.queryByText('App stack')).toBeNull();

    await advance(1);
    expect(screen.getByRole('header', { name: ERROR_TITLE })).toBeTruthy();
    expect(screen.getByTestId('error-detail')).toHaveTextContent('Start-up timed out');
    expect(mockBootstrap).not.toHaveBeenCalled();

    mockMigrations = { success: true };
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('App stack')).toBeTruthy();
    expect(mockBootstrap).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(ERROR_TITLE)).toBeNull();
  });

  it('renders the app when a hung data load succeeds after the timeout', async () => {
    let finish: (value: unknown) => void = () => {};
    mockBootstrap.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    await render(<RootLayout />);
    expect(mockBootstrap).toHaveBeenCalledTimes(1);

    await advance(STARTUP_TIMEOUT_MS);
    expect(screen.getByText(ERROR_TEXT)).toBeTruthy();

    await act(async () => {
      finish({});
    });
    expect(await screen.findByText('App stack')).toBeTruthy();
    expect(screen.queryByText(ERROR_TEXT)).toBeNull();
  });

  it('does not fire once start-up has finished', async () => {
    await render(<RootLayout />);
    expect(await screen.findByText('App stack')).toBeTruthy();

    await advance(STARTUP_TIMEOUT_MS * 2);
    expect(screen.getByText('App stack')).toBeTruthy();
    expect(screen.queryByText(ERROR_TEXT)).toBeNull();
  });
});
