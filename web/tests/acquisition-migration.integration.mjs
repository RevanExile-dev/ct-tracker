import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

// Isolated schema: exercise the actual migration against the old NOT NULL
// definition, including preservation of dates and dependent event rows.
if (!process.env.POSTGRES_URL) throw new Error('POSTGRES_URL is required');
const client = new pg.Client({ connectionString: process.env.POSTGRES_URL });
const schema = `acquisition_test_${randomUUID().replaceAll('-', '')}`;
await client.connect();
try {
  await client.query(`CREATE SCHEMA ${schema}`);
  await client.query(`SET search_path TO ${schema}`);
  await client.query(`CREATE TABLE binder_lots (
    id INTEGER PRIMARY KEY,
    acquired_at DATE NOT NULL DEFAULT CURRENT_DATE,
    cost_total_cents INTEGER
  )`);
  await client.query(`CREATE TABLE binder_lot_events (
    lot_id INTEGER REFERENCES binder_lots(id), delta INTEGER
  )`);
  await client.query(`INSERT INTO binder_lots VALUES (1, '2026-08-29', 354)`);
  await client.query(`INSERT INTO binder_lot_events VALUES (1, 1)`);
  const migration = await readFile(new URL('../db/migrations/20260913_optional_acquisition_date.sql', import.meta.url), 'utf8');
  await client.query(migration);
  await client.query(migration); // safe to retry
  await client.query(`INSERT INTO binder_lots (id) VALUES (2)`);
  await client.query(`INSERT INTO binder_lots VALUES (3, NULL, 0)`);
  const { rows } = await client.query(`SELECT id, acquired_at::text AS date, cost_total_cents AS cost FROM binder_lots ORDER BY id`);
  assert.deepEqual(rows, [
    { id: 1, date: '2026-08-29', cost: 354 },
    { id: 2, date: null, cost: null },
    { id: 3, date: null, cost: 0 },
  ]);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM binder_lot_events')).rows[0].n, 1);
  console.log('Migration verified: existing date/cost/history preserved, omitted and null dates accepted, zero distinct from unknown, repeat safe.');
} finally {
  await client.query('ROLLBACK');
  await client.query('SET search_path TO public');
  await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await client.end();
}
