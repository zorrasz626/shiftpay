import { Barlow_400Regular, Barlow_500Medium, useFonts } from '@expo-google-fonts/barlow';
import { BarlowCondensed_600SemiBold } from '@expo-google-fonts/barlow-condensed';
import { useMigrations } from 'drizzle-orm/expo-sqlite/migrator';
import { type ErrorBoundaryProps, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Text } from 'react-native';

import migrations from '../drizzle/migrations';
import { Button } from '../src/components/Button';
import { Screen } from '../src/components/Screen';
import { db } from '../src/db/client';
import { tzSelfCheck } from '../src/dev/tzSelfCheck';
import { instantToLocal } from '../src/engine/time';
import { useProStore } from '../src/features/pro/proStore';
import { revenueCatClient } from '../src/features/pro/purchases';
import { refreshBankHolidays } from '../src/services/bankHolidayRefresh';
import { expoNotifier } from '../src/services/notifier';
import { startReminderSync } from '../src/services/reminderSync';
import { bootstrap } from '../src/store/bootstrap';
import { useTheme } from '../src/theme/useTheme';

export const ERROR_TITLE = 'Something went wrong';
export const ERROR_TEXT =
  'ShiftPay hit a problem. Try again, and if it keeps happening, close and reopen the app.';

/**
 * The recoverable error screen: a plain message and Try again. The error
 * detail is shown in development builds only, never in release.
 */
export function ErrorScreen({ detail, onRetry }: { detail?: string; onRetry: () => void }) {
  const { colors, typography, spacing } = useTheme();
  return (
    <Screen
      title={ERROR_TITLE}
      bottomInset
      footer={<Button label="Try again" onPress={onRetry} />}
    >
      <Text style={[typography.body, { color: colors.ink }]}>{ERROR_TEXT}</Text>
      {__DEV__ && detail !== undefined && (
        <Text
          testID="error-detail"
          style={[typography.caption, { color: colors.inkMuted, marginTop: spacing.lg }]}
        >
          {detail}
        </Text>
      )}
    </Screen>
  );
}

/** Expo Router's boundary for the whole app: an unexpected render error shows ErrorScreen, not a red or white screen. */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return <ErrorScreen detail={error.message} onRetry={() => void retry()} />;
}

// Try again after a start-up failure remounts Boot, which re-runs the
// migrations and the data load from scratch.
export default function RootLayout() {
  const [attempt, setAttempt] = useState(0);
  return <Boot key={attempt} onRetry={() => setAttempt((n) => n + 1)} />;
}

function Boot({ onRetry }: { onRetry: () => void }) {
  const { success, error } = useMigrations(db, migrations);
  const [booted, setBooted] = useState(false);
  const [bootError, setBootError] = useState<Error | null>(null);
  // Keys must match `fontFamily` in src/theme/tokens.ts. On a font load error
  // we carry on with the system font rather than block start-up.
  const [fontsLoaded, fontError] = useFonts({
    Barlow_400Regular,
    Barlow_500Medium,
    BarlowCondensed_600SemiBold,
  });
  const fontsReady = fontsLoaded || fontError != null;

  // Once migrations succeed: materialise shifts and load the stores, once.
  // A materialisation error is handled inside bootstrap and never blocks start-up.
  useEffect(() => {
    if (!success) return;
    let cancelled = false;
    const today = instantToLocal(new Date().toISOString()).date;
    bootstrap(db, today).then(
      () => {
        if (__DEV__) {
          // Confirms time.ts gets correct BST/GMT offsets on this JS engine (Hermes).
          console.log('[tzSelfCheck]', JSON.stringify(tzSelfCheck()));
        }
        if (!cancelled) setBooted(true);
        // Background, at most weekly: never awaited, never throws, so start-up
        // is not blocked and an offline start keeps the cached/bundled data.
        void refreshBankHolidays(db, new Date().toISOString());
      },
      (e: unknown) => {
        if (!cancelled) setBootError(e instanceof Error ? e : new Error(String(e)));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [success]);

  // After boot: schedule shift reminders now and whenever shifts, jobs or
  // settings change. Does nothing (beyond cancelling) until onboarding is done.
  useEffect(() => {
    if (!booted) return;
    return startReminderSync(expoNotifier);
  }, [booted]);

  // After boot (settings loaded, so the dev override applies): read the Pro
  // entitlement in the background. Never awaited, never throws: without an
  // API key or on any error the app runs as Free.
  useEffect(() => {
    if (!booted) return;
    void useProStore.getState().init(revenueCatClient);
  }, [booted]);

  if (error) {
    return <ErrorScreen detail={`Database migration failed: ${error.message}`} onRetry={onRetry} />;
  }

  if (bootError) {
    return <ErrorScreen detail={`Loading data failed: ${bootError.message}`} onRetry={onRetry} />;
  }

  // Still migrating, loading data or loading fonts: render nothing so the
  // splash screen stays up.
  if (!success || !booted || !fontsReady) {
    return null;
  }

  return (
    <>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }} />
    </>
  );
}
