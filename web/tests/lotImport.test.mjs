import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Stesso pattern di collection-history.test.mjs/binder-quantity.test.mjs:
// transpila il modulo TS puro (nessuna dipendenza DOM/DB, vedi
// web/lib/lotImport.ts) ed esegue il risultato in un vm context isolato,
// invece di passare da un intero setup Next.js/ts-node solo per un test
// unitario.
function loadLotImportModule() {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL('../lib/lotImport.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const context = { exports, module: { exports } };
  vm.runInNewContext(code, context);
  return exports;
}

const { parseLotImportMarkdown } = loadLotImportModule();

test('parses the exact table format from the user-provided collection Markdown', () => {
  const md = `# Contesto

| # | Carta | Set | Tipo | Prezzo pagato |
|---|-------|-----|------|---------------|
| 1 | Primarina | Buio Pesto | IR | €3.54 |
| 2 | Victini | SV Black Star Promos | Promo | €3.96 |
`;
  const { rows, warnings } = parseLotImportMarkdown(md);
  assert.equal(warnings.length, 0);
  assert.equal(rows.length, 2);
  // Confronto campo per campo (non un deepEqual sull'intero oggetto): le
  // righe arrivano da un vm.runInNewContext (altro realm, vedi
  // loadLotImportModule sopra), quindi hanno un Object.prototype diverso da
  // quello dei letterali scritti qui - assert.deepEqual di node:assert/strict
  // e' deepStrictEqual, che confronta anche il prototipo e fallirebbe per
  // questo solo motivo anche a contenuto identico.
  assert.equal(rows[0].rowNumber, 1);
  assert.equal(rows[0].name, 'Primarina');
  assert.equal(rows[0].set, 'Buio Pesto');
  assert.equal(rows[0].priceCents, 354);
  assert.equal(rows[0].acquiredAt, null);
  assert.equal(rows[0].type, 'IR');
  assert.equal(rows[1].rowNumber, 2);
  assert.equal(rows[1].name, 'Victini');
  assert.equal(rows[1].set, 'SV Black Star Promos');
  assert.equal(rows[1].priceCents, 396);
  assert.equal(rows[1].acquiredAt, null);
  assert.equal(rows[1].type, 'Promo');
});

test('a table with no Tipo/Rarità column leaves type null (never guessed)', () => {
  const md = `| Carta | Set | Prezzo pagato |
|-------|-----|----------------|
| Mew | Crown Zenith | 53.00 |
`;
  const { rows } = parseLotImportMarkdown(md);
  assert.equal(rows[0].type, null);
});

test('recognizes a "Rarità" header as the Tipo column', () => {
  const md = `| Carta | Set | Rarità | Prezzo pagato |
|-------|-----|--------|----------------|
| Cleffa | Obsidian Flames | SIR | 15.11 |
`;
  const { rows } = parseLotImportMarkdown(md);
  assert.equal(rows[0].type, 'SIR');
});

test('reads an optional Data column in ISO format', () => {
  const md = `| Carta | Set | Prezzo pagato | Data |
|-------|-----|----------------|------|
| Mew | Crown Zenith | 53.00 | 2026-01-15 |
`;
  const { rows } = parseLotImportMarkdown(md);
  assert.equal(rows[0].acquiredAt, '2026-01-15');
  assert.equal(rows[0].priceCents, 5300);
});

test('reads an Italian DD/MM/YYYY date and converts it to ISO', () => {
  const md = `| Carta | Prezzo pagato | Data |
|-------|----------------|------|
| Psyduck | 45,44 | 3/2/2026 |
`;
  const { rows } = parseLotImportMarkdown(md);
  assert.equal(rows[0].acquiredAt, '2026-02-03');
  assert.equal(rows[0].priceCents, 4544);
});

test('a row with no date value in an existing Data column leaves acquiredAt null (never guesses today)', () => {
  const md = `| Carta | Prezzo pagato | Data |
|-------|----------------|------|
| Latios | 0.14 |  |
`;
  const { rows } = parseLotImportMarkdown(md);
  assert.equal(rows[0].acquiredAt, null);
});

test('an unparseable price still imports the row (priceCents null) with a warning, not a dropped row', () => {
  const md = `| Carta | Prezzo pagato |
|-------|----------------|
| Grusha | n/d |
`;
  const { rows, warnings } = parseLotImportMarkdown(md);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].priceCents, null);
  assert.ok(warnings.some((w) => w.includes('Grusha')));
});

test('text with no recognizable table returns no rows and a clear warning', () => {
  const { rows, warnings } = parseLotImportMarkdown('Solo testo libero, nessuna tabella qui.');
  assert.equal(rows.length, 0);
  assert.equal(warnings.length, 1);
});

test('ignores a table missing both Carta and Prezzo columns', () => {
  const md = `| Nota | Quantità |
|------|----------|
| qualcosa | 3 |
`;
  const { rows } = parseLotImportMarkdown(md);
  assert.equal(rows.length, 0);
});

test('stops reading rows once the table ends, ignoring trailing prose', () => {
  const md = `| Carta | Prezzo pagato |
|-------|----------------|
| Eevee | 10.01 |

Fine della tabella, testo normale qui sotto con | anche pipe | dentro.
`;
  const { rows } = parseLotImportMarkdown(md);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Eevee');
});
