import { useMigrations } from 'drizzle-orm/expo-sqlite/migrator';
import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import migrations from '../drizzle/migrations';
import { db } from '../src/db/client';
import { instantToLocal } from '../src/engine/time';
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

  // Once migrations succeed: materialise shifts and load the stores, once.
  // A materialisation error is handled inside bootstrap and never blocks start-up.
  useEffect(() => {
    if (!success) return;
    let cancelled = false;
    const today = instantToLocal(new Date().toISOString()).date;
    bootstrap(db, today).then(
      () => {
        if (!cancelled) setBooted(true);
      },
      (e: unknown) => {
        if (!cancelled) setBootError(e instanceof Error ? e : new Error(String(e)));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [success]);

  if (error) {
    return <ErrorScreen message={`Database migration failed: ${error.message}`} />;
  }

  if (bootError) {
    return <ErrorScreen message={`Loading data failed: ${bootError.message}`} />;
  }

  // Still migrating or loading: render nothing so the splash screen stays up.
  if (!success || !booted) {
    return null;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
