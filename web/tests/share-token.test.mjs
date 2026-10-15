import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Stesso metodo degli altri test unitari: il .ts viene trascritto e caricato,
// cosi' non dipende dalla versione di Node.
const exports = {};
const code = ts.transpileModule(readFileSync(new URL("../lib/shareToken.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
vm.runInNewContext(code, { exports });
const { isValidShareToken, normalizeShareTitle, isShareKind, defaultShareTitle, sharePath, SHARE_TOKEN_BYTES, SHARE_TOKEN_LENGTH, MAX_SHARE_TITLE_LENGTH } = exports;

test("un token generato come in share.server.ts ha la forma attesa", () => {
  const token = randomBytes(SHARE_TOKEN_BYTES).toString("base64url");
  assert.equal(token.length, SHARE_TOKEN_LENGTH);
  assert.ok(isValidShareToken(token));
});

test("token inventati o malformati non passano (nessuna query sul database)", () => {
  for (const bad of ["", "abc", "a".repeat(31), "a".repeat(33), "a".repeat(31) + "!", "a".repeat(31) + " ", "../".repeat(11), null, undefined, 42, ["a".repeat(32)]]) {
    assert.equal(isValidShareToken(bad), false, String(bad));
  }
  assert.ok(isValidShareToken("A".repeat(32)));
  assert.ok(isValidShareToken("-_".repeat(16)));
});

test("tipi di link", () => {
  assert.ok(isShareKind("binder") && isShareKind("wishlist"));
  assert.equal(isShareKind("lots"), false);
  assert.equal(isShareKind(undefined), false);
});

test("il titolo e' ripulito, vuoto diventa nessun titolo, troppo lungo o non testo e' rifiutato", () => {
  assert.equal(normalizeShareTitle(undefined), null);
  assert.equal(normalizeShareTitle(null), null);
  assert.equal(normalizeShareTitle("   "), null);
  assert.equal(normalizeShareTitle("  Il  mio\tbinder \n"), "Il mio binder");
  assert.equal(normalizeShareTitle("a".repeat(MAX_SHARE_TITLE_LENGTH)), "a".repeat(MAX_SHARE_TITLE_LENGTH));
  assert.equal(normalizeShareTitle("a".repeat(MAX_SHARE_TITLE_LENGTH + 1)), undefined);
  assert.equal(normalizeShareTitle(5), undefined);
  assert.equal(normalizeShareTitle({}), undefined);
});

test("titoli e percorso di default non contengono dati dell'account", () => {
  assert.equal(defaultShareTitle("binder"), "Un binder condiviso");
  assert.equal(defaultShareTitle("wishlist"), "Una lista desideri condivisa");
  assert.equal(sharePath("abc"), "/s/abc");
});
