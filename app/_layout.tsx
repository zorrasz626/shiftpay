import { Barlow_400Regular, Barlow_500Medium, useFonts } from '@expo-google-fonts/barlow';
import { BarlowCondensed_600SemiBold } from '@expo-google-fonts/barlow-condensed';
import { useMigrations } from 'drizzle-orm/expo-sqlite/migrator';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import migrations from '../drizzle/migrations';
import { db } from '../src/db/client';
import { tzSelfCheck } from '../src/dev/tzSelfCheck';
import { instantToLocal } from '../src/engine/time';
import { refreshBankHolidays } from '../src/services/bankHolidayRefresh';
import { expoNotifier } from '../src/services/notifier';
import { startReminderSync } from '../src/services/reminderSync';
import { bootstrap } from '../src/store/bootstrap';

function ErrorScreen({ message }: { message: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <Text>{message}</Text>
    </View>
  );
}

export default function RootLayout() {
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

  if (error) {
    return <ErrorScreen message={`Database migration failed: ${error.message}`} />;
  }

  if (bootError) {
    return <ErrorScreen message={`Loading data failed: ${bootError.message}`} />;
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
