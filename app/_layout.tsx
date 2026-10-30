import { useMigrations } from 'drizzle-orm/expo-sqlite/migrator';
import { Stack } from 'expo-router';
import { Text, View } from 'react-native';

import migrations from '../drizzle/migrations';
import { db } from '../src/db/client';

export default function RootLayout() {
  const { success, error } = useMigrations(db, migrations);

  if (error) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Text>Database migration failed: {error.message}</Text>
      </View>
    );
  }

  // Still migrating: render nothing so the splash screen stays up.
  if (!success) {
    return null;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
