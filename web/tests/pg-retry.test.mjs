import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load() {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL('../lib/pgRetry.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(code, { exports });
  return exports;
}
const { isConnectFailure, withConnectRetry } = load();

test('riconosce solo gli errori di connessione non stabilita', () => {
  assert.equal(isConnectFailure(new Error('timeout exceeded when trying to connect')), true);
  assert.equal(isConnectFailure(new Error('Connection terminated due to connection timeout')), true);
  assert.equal(isConnectFailure({ code: 'ECONNREFUSED' }), true);
  assert.equal(isConnectFailure({ code: 'EAI_AGAIN' }), true);
  assert.equal(isConnectFailure({ syscall: 'connect', code: 'ETIMEDOUT' }), true);
  assert.equal(isConnectFailure(new Error('Connection terminated unexpectedly')), false);
  assert.equal(isConnectFailure({ code: 'ECONNRESET' }), false);
  assert.equal(isConnectFailure({ code: '23505' }), false);
  assert.equal(isConnectFailure(null), false);
});

test('ripete una sola volta, e solo per errori di connessione', async () => {
  let calls = 0;
  const ok = await withConnectRetry(async () => {
    calls++;
    if (calls === 1) throw new Error('timeout exceeded when trying to connect');
    return 'ok';
  });
  assert.equal(ok, 'ok');
  assert.equal(calls, 2);

  calls = 0;
  await assert.rejects(() => withConnectRetry(async () => { calls++; throw new Error('timeout exceeded when trying to connect'); }));
  assert.equal(calls, 2);

  calls = 0;
  await assert.rejects(() => withConnectRetry(async () => { calls++; throw new Error('syntax error'); }));
  assert.equal(calls, 1);
});
