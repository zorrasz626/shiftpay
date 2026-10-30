import { drizzle } from 'drizzle-orm/expo-sqlite';
import { openDatabaseSync } from 'expo-sqlite';

import * as schema from './schema';

const expo = openDatabaseSync('shiftpay.db', { enableChangeListener: true });

// SQLite leaves foreign keys off per connection: turn them on before any query.
expo.execSync('PRAGMA foreign_keys = ON;');
expo.execSync('PRAGMA journal_mode = WAL;');

export const db = drizzle(expo, { schema });
