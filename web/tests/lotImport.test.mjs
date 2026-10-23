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
function transpileToModule(relativePath) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(relativePath, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  // Risolve solo le dipendenze pure del parser, senza avviare Next o il DB.
  function localRequire(spec) {
    if (spec === './rarity') return transpileToModule('../lib/rarity.ts');
    if (spec === './calendarDate') return transpileToModule('../lib/calendarDate.ts');
    throw new Error(`require non gestito nel test: ${spec}`);
  }
  const context = { exports, module: { exports }, require: localRequire };
  vm.runInNewContext(code, context);
  return exports;
}

function loadLotImportModule() {
  return transpileToModule('../lib/lotImport.ts');
}

const { parseLotImportMarkdown, narrowByDeclaredType } = loadLotImportModule();

function loadLotImportServer(candidates) {
  const writes = [];
  const account = {
    getExistingPurchaseInfo: async () => ({ inBinder: false, costTotalCents: null, acquiredAt: null }),
    upsertBinderEntry: async (_userId, blueprintId) => { writes.push({ kind: 'binder', blueprintId }); },
    upsertPurchaseLot: async (_userId, blueprintId) => { writes.push({ kind: 'lot', blueprintId }); return { created: true }; },
  };
  const db = {
    findBlueprintMatches: async () => candidates,
    findBlueprintById: async () => null,
  };
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL('../lib/lotImport.server.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(code, {
    exports,
    require: (specifier) => {
      if (specifier === 'server-only') return {};
      if (specifier === './db.server') return db;
      if (specifier === './account.server') return account;
      if (specifier === './lotImport') return { narrowByDeclaredType };
      throw new Error(`Unexpected import dependency: ${specifier}`);
    },
  });
  return { server: exports, writes };
}

const importRow = (overrides = {}) => ({
  rowNumber: 1, name: 'Pikachu', set: 'Base Set', type: null,
  priceCents: 100, acquiredAt: null, ...overrides,
});

const candidate = (id, expansionName) => ({
  id, name: 'Pikachu', expansionName, rarity: 'Common', imageUrl: null,
});

test('a declared set never auto-accepts a unique candidate whose expansion is null or empty', async (t) => {
  for (const expansionName of [null, '', '   ']) {
    await t.test(`expansion ${JSON.stringify(expansionName)}`, async () => {
      const { server, writes } = loadLotImportServer([candidate(1, expansionName)]);
      const [outcome] = await server.applyLotImport('test-user', [importRow()]);
      assert.equal(outcome.status, 'ambiguous');
      assert.equal(writes.length, 0, 'manual proposal must not write automatically');
    });
  }
});

test('with multiple candidates, missing expansions are ignored and the sole compatible set can match', async () => {
  const candidates = [candidate(1, null), candidate(2, ''), candidate(3, 'Base Set')];
  const { server, writes } = loadLotImportServer(candidates);
  const [outcome] = await server.applyLotImport('test-user', [importRow()]);
  assert.equal(outcome.status, 'imported');
  assert.equal(outcome.matchedExpansion, 'Base Set');
  assert.equal(writes.filter((write) => write.blueprintId === 3).length, 2);
});

test('a unique candidate with an incompatible declared set stays manual', async () => {
  const { server, writes } = loadLotImportServer([candidate(1, 'Jungle')]);
  const [outcome] = await server.applyLotImport('test-user', [importRow()]);
  assert.equal(outcome.status, 'ambiguous');
  assert.equal(writes.length, 0);
});

test('a unique candidate with a compatible declared set is still imported automatically', async () => {
  const { server } = loadLotImportServer([candidate(1, 'Base Set')]);
  const [outcome] = await server.applyLotImport('test-user', [importRow({ set: 'base' })]);
  assert.equal(outcome.status, 'imported');
});

test('without a declared set, a unique candidate with no expansion remains an automatic match', async () => {
  const { server } = loadLotImportServer([candidate(1, null)]);
  const [outcome] = await server.applyLotImport('test-user', [importRow({ set: null })]);
  assert.equal(outcome.status, 'imported');
});

// Rilievo review (Gemini su PR #241, verificato: in pratica non raggiungibile
// da web/lib/lotImport.ts, che scrive sempre null per una cella Set vuota o
// di soli spazi - cells[setCol]?.trim() || null - ma matchRow non deve
// comunque fidarsi di quella garanzia a monte: un row.set non-null ma vuoto
// dopo il trim produrrebbe lo stesso setLower.includes("") sempre vero del
// bug originale, stavolta sul lato del Set invece che dell'espansione).
test('a whitespace-only declared set behaves like no declared set at all, not like an empty one that matches everything', async () => {
  const candidates = [candidate(1, null), candidate(2, 'Base Set')];
  const { server, writes } = loadLotImportServer(candidates);
  const [outcome] = await server.applyLotImport('test-user', [importRow({ set: '   ' })]);
  assert.equal(outcome.status, 'ambiguous', 'must not silently prefer the candidate with a real expansion');
  assert.equal(writes.length, 0);
});

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

test('invalid calendar dates are omitted with a row warning instead of reaching the database', () => {
  const invalid = ['2026-02-29', '31/02/2026', '2026-04-31', '2026-13-01', '00/10/2026', '0000-01-01', 'ieri'];
  const md = `| Carta | Prezzo | Data |\n|---|---|---|\n${invalid.map((date, i) => `| Carta ${i + 1} | 1,25 | ${date} |`).join('\n')}`;
  const { rows, warnings } = parseLotImportMarkdown(md);
  assert.equal(rows.length, invalid.length, 'invalid date does not discard the card or its cost');
  rows.forEach((row) => {
    assert.equal(row.acquiredAt, null);
    assert.equal(row.priceCents, 125);
  });
  assert.equal(warnings.length, invalid.length);
  warnings.forEach((warning, i) => {
    assert.ok(warning.includes(`Riga ${i + 1}`));
    assert.ok(warning.includes(invalid[i]));
    assert.ok(warning.includes('già registrata resta invariata'));
  });
});

test('valid leap dates and calendar boundaries retain their exact dates without warnings', () => {
  const dates = ['2024-02-29', '29/2/2000', '1900-02-28', '1/1/0001', '9999-12-31'];
  const md = `| Carta | Prezzo | Data |\n|---|---|---|\n${dates.map((date) => `| Pikachu | 1 | ${date} |`).join('\n')}`;
  const { rows, warnings } = parseLotImportMarkdown(md);
  assert.equal(JSON.stringify(rows.map((row) => row.acquiredAt)), JSON.stringify(['2024-02-29', '2000-02-29', '1900-02-28', '0001-01-01', '9999-12-31']));
  assert.equal(warnings.length, 0);
});

test('blank or missing date cells do not produce invalid-date warnings', () => {
  const { rows, warnings } = parseLotImportMarkdown('| Carta | Prezzo | Data |\n|---|---|---|\n| Mew | 1 |   |\n| Eevee | 2 |');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].acquiredAt, null);
  assert.equal(rows[1].acquiredAt, null);
  assert.equal(warnings.length, 0);
});

test('an invalid imported date leaves the stored purchase date out of the update patch', async () => {
  const { rows } = parseLotImportMarkdown('| Carta | Prezzo | Data |\n|---|---|---|\n| Mew | 2,50 | 31/02/2026 |');
  const patches = [];
  const account = {
    upsertBinderEntry: async () => {},
    upsertPurchaseLot: async (_userId, _id, patch) => { patches.push(patch); return { created: false }; },
  };
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL('../lib/lotImport.server.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(code, {
    exports,
    require: (specifier) => {
      if (specifier === 'server-only' || specifier === './db.server') return {};
      if (specifier === './account.server') return account;
      if (specifier === './lotImport') return { narrowByDeclaredType };
      throw new Error(`Unexpected import dependency: ${specifier}`);
    },
  });
  await exports.writeImportedCard('test-user', 7, { costTotalCents: rows[0].priceCents, acquiredAt: rows[0].acquiredAt });
  assert.equal(patches.length, 1);
  assert.equal(patches[0].costTotalCents, 250);
  assert.equal(Object.hasOwn(patches[0], 'acquiredAt'), false, 'existing date cannot be cleared or replaced');
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

// narrowByDeclaredType: la review su questa funzionalita' ha trovato un bug
// reale in una versione precedente (".includes()" invece di un confronto
// esatto, che faceva scambiare una Illustration Rare per una Special
// Illustration Rare perche' la seconda stringa CONTIENE la prima) - questi
// test coprono esattamente quel caso, non solo il percorso felice.

test('narrowByDeclaredType picks the exact rarity when "IR" and "SIR" are both candidates (real bug: .includes() confused the two)', () => {
  const candidates = [
    { id: 1, rarity: 'Holo Rare' },
    { id: 2, rarity: 'Illustration Rare' },
    { id: 3, rarity: 'Special Illustration Rare' },
  ];
  const narrowed = narrowByDeclaredType(candidates, 'IR');
  assert.equal(narrowed.length, 1);
  assert.equal(narrowed[0].id, 2);
});

test('narrowByDeclaredType with "SIR" never picks the plain Illustration Rare candidate', () => {
  const candidates = [
    { id: 2, rarity: 'Illustration Rare' },
    { id: 3, rarity: 'Special Illustration Rare' },
  ];
  const narrowed = narrowByDeclaredType(candidates, 'SIR');
  assert.equal(narrowed.length, 1);
  assert.equal(narrowed[0].id, 3);
});

test('narrowByDeclaredType returns candidates unchanged when the declared type has no matching rarity (never an empty result)', () => {
  const candidates = [
    { id: 1, rarity: 'Common' },
    { id: 2, rarity: 'Uncommon' },
  ];
  const narrowed = narrowByDeclaredType(candidates, 'IR');
  assert.equal(narrowed.length, 2);
});

test('narrowByDeclaredType returns candidates unchanged for an unrecognized abbreviation', () => {
  const candidates = [{ id: 1, rarity: 'Illustration Rare' }, { id: 2, rarity: 'Common' }];
  const narrowed = narrowByDeclaredType(candidates, 'XYZ');
  assert.equal(narrowed.length, 2);
});

test('narrowByDeclaredType returns candidates unchanged when declaredType is null', () => {
  const candidates = [{ id: 1, rarity: 'Illustration Rare' }];
  const narrowed = narrowByDeclaredType(candidates, null);
  assert.equal(narrowed.length, 1);
});

test('narrowByDeclaredType is case-insensitive and trims whitespace on both the declared type and the rarity', () => {
  const candidates = [{ id: 1, rarity: '  Illustration Rare  ' }];
  const narrowed = narrowByDeclaredType(candidates, ' ir ');
  assert.equal(narrowed.length, 1);
});

// "IR TG" (Illustration Rare della Trainer Gallery): trovato con una
// simulazione di import reale contro il catalogo Postgres (2026-09-13,
// vedi docs/lot_import_markdown_format_2026-09-13.md) - una riga con
// questo Tipo restava ambigua (Common vs Illustration Rare dello stesso
// set) perche' "ir tg" non era tra le abbreviazioni riconosciute.
test('narrowByDeclaredType recognizes "IR TG" as an Illustration Rare hint (Trainer Gallery cards share the plain IR rarity in this catalog)', () => {
  const candidates = [
    { id: 1, rarity: 'Common' },
    { id: 2, rarity: 'Illustration Rare' },
  ];
  const narrowed = narrowByDeclaredType(candidates, 'IR TG');
  assert.equal(narrowed.length, 1);
  assert.equal(narrowed[0].id, 2);
});

// Il catalogo reale ha rarity "Special Illustration" (Dark Phantasma) e
// "Special Illustraion Rare" - refuso, Fusion Strike - invece del canonico
// "Special Illustration Rare" per alcuni set (vedi web/lib/rarity.ts,
// RARITY_ALIASES) - senza passare da normalizeRarity, "SIR" non le
// avrebbe mai riconosciute.
test('narrowByDeclaredType matches "SIR" against a catalog rarity alias ("Special Illustraion Rare" typo), not just the canonical spelling', () => {
  const candidates = [
    { id: 1, rarity: 'Common' },
    { id: 2, rarity: 'Special Illustraion Rare' },
  ];
  const narrowed = narrowByDeclaredType(candidates, 'SIR');
  assert.equal(narrowed.length, 1);
  assert.equal(narrowed[0].id, 2);
});
