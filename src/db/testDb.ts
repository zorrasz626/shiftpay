/**
 * In-memory SQLite database for Jest (Node): better-sqlite3, foreign keys on,
 * migrated from `drizzle/`. Never import this from app code.
 */
import path from 'path';

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

import type { AppDb } from './jobRepo';
import * as schema from './schema';

const MIGRATIONS = path.resolve(__dirname, '../../drizzle');

export function createTestDb(): AppDb {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS });
  return db;
}
