import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the actual TS ranking/parser in Node; database access is forbidden
// here because these regression cases supply explicit catalog entries.
function loadModule(path, dependencies = {}) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: (id) => {
    if (id in dependencies) return dependencies[id];
    throw new Error(`Unexpected dependency: ${id}`);
  }});
  return exports;
}
const parser = loadModule('../lib/scanner/collector-number.ts');
const catalog = loadModule('../lib/scanner/catalog.ts', {
  './collector-number': parser, '@/lib/db': {},
});

test('gallery identifiers survive OCR noise, case, spacing and zero padding', () => {
  for (const text of ['TG05/TG30', 'tg05 / tg30', 'TG O5 / TG 3O', 'Pikachu TG05-TG30']) {
    assert.equal(parser.extractCollectorNumber(text), 'TG5/TG30');
  }
  assert.equal(parser.extractCollectorNumber('GG05/GG70'), 'GG5/GG70');
  assert.equal(parser.extractCollectorNumber('SV001/SV122'), 'SV1/SV122');
  assert.equal(parser.extractCollectorNumber('RC01/RC032'), 'RC1/RC32');
});

test('numeric regressions and malformed prefixes do not become exact evidence', () => {
  assert.equal(parser.extractCollectorNumber('I95/I82'), '195/182');
  assert.equal(parser.extractCollectorNumber('005/030'), '5/30');
  for (const text of ['TG05/GG30', 'TG05/30', 'XX05/XX30', 'XX05/030', 'TG05/TG00', 'TG05']) {
    assert.equal(parser.extractCollectorNumber(text), null, text);
  }
});

test('S/B sono riparate come cifre (5/8) solo nella parte numerica, mai nel prefisso', () => {
  assert.equal(parser.extractCollectorNumber('S5/198'), '55/198');
  assert.equal(parser.extractCollectorNumber('1B5/198'), '185/198');
  assert.equal(parser.extractCollectorNumber('B5/B8'), '85/88');
  // "SV" resta il prefisso gallery, non "S" letto come cifra: l'alternanza
  // esplicita del prefisso viene tentata prima e vince sulla classe cifre.
  assert.equal(parser.extractCollectorNumber('SV107/SV122'), 'SV107/SV122');
});

test('metadata names and image URLs use the same gallery parser', () => {
  assert.equal(parser.stripCollectorNumbers('Pikachu TG05/TG30'), 'Pikachu  ');
  assert.equal(catalog.collectorNumberFromImageUrl('https://cardtrader.com/uploads/blueprints/image/221649/pikachu-ultra-rare-tg05-tg30-lost-origin.jpg'), 'TG5/TG30');
  assert.equal(catalog.collectorNumberFromImageUrl('https://example.test/blitzle-195-182.jpg'), '195/182');
  assert.equal(catalog.collectorNumberFromImageUrl('https://example.test/pikachu-tg05%2Ftg30.jpg'), 'TG5/TG30');
});

test('collectorParts normalizes zero-padding on its own, independent of extractCollectorNumber', () => {
  // Every current caller already routes through extractCollectorNumber() first
  // (which strips padding), but collectorParts is exported and has no way to
  // enforce that on a future direct caller - it must be correct standalone too.
  const padded = parser.collectorParts('TG05/TG30');
  assert.equal(padded.prefix, 'TG');
  assert.equal(padded.numerator, '5');
  assert.equal(padded.denominator, '30');

  const plain = parser.collectorParts('005/030');
  assert.equal(plain.prefix, '');
  assert.equal(plain.numerator, '5');
  assert.equal(plain.denominator, '30');

  const stripped = parser.collectorParts('TG5/TG30');
  assert.equal(stripped.numerator, padded.numerator);
  assert.equal(stripped.denominator, padded.denominator);
});

const entry = (id, version, name = 'Pikachu') => ({
  id, name, version, expansion_code: 'lorg', expansion_name: 'Lost Origin',
  image_url: null, rarity: null,
});

test('reported Pikachu beats other Pikachu printings', () => {
  const entries = [entry(1, '005/030'), entry(2, 'TG06/TG30'), entry(3, 'GG05/GG30'),
    entry(221649, 'Ultra Rare | TG05/TG30')];
  const ranked = catalog.rankScannerCandidates('Pikachu\nTG O5 / TG 3O\ndebolezza resistenza ritirata', entries);
  assert.equal(ranked[0].id, 221649);
  assert.equal(ranked[0].numberScore, 1);
  assert.equal(ranked[0].nameScore, 1);
  for (const id of [1, 3]) assert.equal(ranked.find(row => row.id === id).numberScore, 0);
});

test('number in name and URL works; ordinary numbers still disambiguate', () => {
  const correct = entry(221649, null, 'Pikachu TG05/TG30');
  assert.equal(catalog.rankScannerCandidates('Pikachu TG05/TG30', [entry(1, 'TG06/TG30'), correct])[0].id, 221649);
  correct.name = 'Pikachu';
  correct.image_url = 'https://example.test/pikachu-tg05-tg30.jpg';
  assert.equal(catalog.rankScannerCandidates('Pikachu TG05/TG30', [entry(1, 'TG06/TG30'), correct])[0].id, 221649);
  assert.equal(catalog.rankScannerCandidates('Blitzle I95/I82', [entry(1, '194/182', 'Blitzle'), entry(2, '195/182', 'Blitzle')])[0].id, 2);
});

test('collector code cannot disambiguate two sets with identical name and code', () => {
  const a = entry(1, 'TG05/TG30');
  const b = { ...entry(2, 'TG05/TG30'), expansion_code: 'other' };
  const ranked = catalog.rankScannerCandidates('Pikachu TG05/TG30', [a, b]);
  assert.equal(ranked[0].score, ranked[1].score);
});

test('full-art 30° anniversario: slash letto come cifra e nomi corti non battono la carta giusta', () => {
  const entries = [
    { id: 1, name: 'N', version: null, expansion_code: 'fco', expansion_name: 'Fates Collide', image_url: null, rarity: null },
    { id: 2, name: 'Alolan Meowth', version: 'Illustration Rare | 139/128', expansion_code: '30c', expansion_name: '30th Celebration', image_url: null, rarity: null },
    { id: 3, name: 'Alolan Meowth', version: '089/128', expansion_code: '30c', expansion_name: '30th Celebration', image_url: null, rarity: null },
  ];
  // Caso reale: il nome e' letto male, il numero "139/128" arriva come "1397 128".
  const withNumber = catalog.rankScannerCandidates('Meow N\n| 1397 128', entries);
  assert.equal(withNumber[0].id, 2);
  // Senza alcun indizio sul numero, "N" sperduta nell'OCR non deve identificare nulla.
  assert.equal(catalog.rankScannerCandidates('N resistenza', [entries[0]]).length, 0);
});

const card = (id, name, version, expansion_code = 'x') => ({ id, name, version, expansion_code, expansion_name: expansion_code, image_url: null, rarity: null });

test('il nome si cerca solo nella fascia del nome: parole del testo attacchi non creano match', () => {
  // Caso reale (Alolan Exeggutor 002/128): "Energy" negli attacchi faceva vincere
  // "Energy Retrieval" sul numero letto esatto.
  const entries = [card(1, 'Alolan Exeggutor', '002/128', '30c'), card(2, 'Energy Retrieval', '003/XY-P', 'xyp'), card(3, 'Darkness Energy', null, 'hif')];
  const ranked = catalog.rankScannerCandidates({ name: 'Alolan Exeggutor', number: '002/128' }, entries);
  assert.equal(ranked[0].id, 1);
  assert.equal(catalog.assessScan(ranked), 'certain');
  // Lo stesso testo degli attacchi passato come numero non porta alcun nome.
  const noName = catalog.rankScannerCandidates({ name: '', number: 'If this Pokémon has 6 or more Energy attached\n002/128' }, entries);
  assert.equal(noName[0].id, 1);
  assert.equal(catalog.assessScan(noName), 'probable');
});

test('"identificata" richiede nome e numero concordi; un solo indizio resta da confermare', () => {
  const entries = [card(1, 'Alolan Meowth', 'Illustration Rare | 139/128', '30c'), card(2, 'Alolan Meowth', '089/128', '30c'), card(3, 'Altaria', '036/XY-P', 'xyp')];
  assert.equal(catalog.assessScan(catalog.rankScannerCandidates({ name: 'Alolan Meowith', number: '| 139 128' }, entries)), 'certain');
  assert.equal(catalog.assessScan(catalog.rankScannerCandidates({ name: 'Alolan Meowth', number: '' }, entries)), 'probable');
  assert.equal(catalog.assessScan(catalog.rankScannerCandidates({ name: 'Bi I I -', number: 'T77iris 4' }, entries)), 'none');
  // Nome letto a meta' ("Alt" + rumore) non basta a proporre Altaria come certa.
  assert.notEqual(catalog.assessScan(catalog.rankScannerCandidates({ name: 'Altar ia', number: 'rr 2 |' }, entries)), 'certain');
});

test('numero esatto + nome parziale basta, ma non se un vicino ha il nome migliore', () => {
  const entries = [card(1, 'Hisuian Zoroark', '123/128', '30c'), card(2, 'Hisuian Zorua', '122/128', '30c'), card(3, 'Zoroark', '096/128', '30c')];
  // Caso reale: "Hisuian" non letto, "Zoroark" si', numero esatto.
  assert.equal(catalog.assessScan(catalog.rankScannerCandidates({ name: 'FER hn Zoroark', number: '123/128' }, entries)), 'certain');
  // Numero letto male di una cifra (122 invece di 123): Zorua ha il numero ma
  // Zoroark ha il nome nettamente migliore -> da confermare, non certa.
  assert.equal(catalog.assessScan(catalog.rankScannerCandidates({ name: 'Hisuian Zoroark', number: '122/128' }, entries)), 'probable');
});

test('due varianti con stesso nome e numero (es. timbro 30°) restano da confermare', () => {
  const entries = [card(1, 'Shining Celebi', '106/105', 'n4'), card(2, 'Shining Celebi', '30th Celebration Stamp | 106/105', '30c')];
  assert.equal(catalog.assessScan(catalog.rankScannerCandidates({ name: 'Shining Celebi', number: '106/105' }, entries)), 'probable');
});

test("l'immagine decide tra varianti con lo stesso nome solo se nettamente piu' simile", () => {
  const base = { score: 0.45, nameScore: 1, numberScore: 0 };
  const a = { ...card(1, 'Alolan Meowth', '139/128'), ...base, visualScore: 0.82 };
  const b = { ...card(2, 'Alolan Meowth', '089/128'), ...base, visualScore: 0.31 };
  const all = { complete: true };
  assert.equal(catalog.assessScan([a, b], all), 'certain');
  assert.equal(catalog.assessScan([a, { ...b, visualScore: 0.78 }], all), 'probable');
  assert.equal(catalog.assessScan([{ ...a, visualScore: 0.5 }, b], all), 'probable');
  // Un numero letto con sicurezza che indica un'altra carta esclude la scelta visiva.
  assert.equal(catalog.assessScan([a, { ...b, numberScore: 1 }], all), 'probable');
  // Caso reale (Alolan Exeggutor): stessa illustrazione in versione JP ed EN.
  // Se non tutte le carte con quel nome sono state confrontate, niente certezza.
  assert.equal(catalog.assessScan([a, b]), 'probable');
  assert.equal(catalog.assessScan([a, b, { ...card(3, 'Alolan Meowth', '115/103'), ...base, visualScore: null }], all), 'probable');
});

test('a parita di lettura vince il nome piu specifico', () => {
  const entries = [card(1, 'Exeggutor', '5/63'), card(2, 'Alolan Exeggutor', '002/128', '30c')];
  assert.equal(catalog.rankScannerCandidates({ name: 'Aiolan Exeggutor', number: '' }, entries)[0].id, 2);
});

test('numero esatto + immagine bastano quando il nome non si legge (font ex/V)', () => {
  const top = { ...card(1, 'Espeon ex', 'Ultra Rare | 070/128', '30c'), score: 0.7, nameScore: 0.33, numberScore: 1, visualScore: 0.97 };
  const near = { ...card(2, 'Espeon', '069/128', '30c'), score: 0.49, nameScore: 0.67, numberScore: 0.34, visualScore: 0.45 };
  assert.equal(catalog.assessScan([top, near], { complete: true }), 'certain');
  assert.equal(catalog.assessScan([top, near]), 'probable');
  assert.equal(catalog.assessScan([{ ...top, visualScore: 0.3 }, near], { complete: true }), 'probable');
});

test('nome e numero letti in parte + immagine netta: tre indizi concordi bastano', () => {
  // Caso reale (Alolan Meowth 139/128): nome "Meowith", numero con una cifra sporca.
  const top = { ...card(1, 'Alolan Meowth', 'Illustration Rare | 139/128', '30c'), score: 0.8, nameScore: 0.76, numberScore: 0.75, visualScore: 0.93 };
  const other = { ...card(2, 'Meowth', '74/124'), score: 0.39, nameScore: 0.86, numberScore: 0, visualScore: 0.22 };
  const all = { complete: true };
  assert.equal(catalog.assessScan([top, other], all), 'certain');
  assert.equal(catalog.assessScan([top, other]), 'probable');
  assert.equal(catalog.assessScan([{ ...top, visualScore: 0.4 }, other], all), 'probable');
  // Un'altra carta compatibile con entrambe le letture non confrontata con la foto.
  const unseen = { ...card(3, 'Alolan Meowth', '139/198'), score: 0.7, nameScore: 0.76, numberScore: 0.75, visualScore: null };
  assert.equal(catalog.assessScan([top, other, unseen], all), 'probable');
  // Un numero letto con certezza che indica un'altra carta.
  assert.equal(catalog.assessScan([top, { ...other, numberScore: 1, visualScore: 0.1 }], all), 'probable');
});

test('promo senza totale: sigla e numero (MEP, SVP, SWSH, SM, XY, BW e promo JP)', () => {
  assert.equal(JSON.stringify(parser.extractPromoNumbers('J MEP EN 099 *')), JSON.stringify(['MEP 99']));
  assert.equal(JSON.stringify(parser.extractPromoNumbers('MEPEN O99')), JSON.stringify(['MEP 99']));
  assert.equal(JSON.stringify(parser.extractPromoNumbers('STAFF Promo | MEP 085')), JSON.stringify(['MEP 85']));
  assert.equal(JSON.stringify(parser.extractPromoNumbers('SVP 223')), JSON.stringify(['SVP 223']));
  assert.equal(JSON.stringify(parser.extractPromoNumbers('Cosmos Holo | SWSH220')), JSON.stringify(['SWSH 220']));
  assert.equal(JSON.stringify(parser.extractPromoNumbers('20th Stamp Holo Promo | XY143')), JSON.stringify(['XY 143']));
  assert.equal(JSON.stringify(parser.extractPromoNumbers('081/S-P')), JSON.stringify(['81/S-P']));
  assert.equal(JSON.stringify(parser.extractPromoNumbers('BW-P 234')), JSON.stringify(['234/BW-P']));
  assert.equal(JSON.stringify(parser.extractPromoNumbers('Gym Promo | XY-P')), JSON.stringify([]));
  assert.equal(JSON.stringify(parser.extractPromoNumbers('SVI EN 123/198')), JSON.stringify([]));
  // Prima "339/S-P" diventava il numero normale "339/5" (S letta come cifra).
  assert.equal(parser.extractCollectorNumber('339/S-P'), null);
  assert.equal(parser.extractCollectorNumber('greninja-ex-017-066-pokemon.jpg'), '17/66');
});

test('promo MEP del 30esimo: sigla+numero e nome la identificano (caso reale Greninja ex 099)', () => {
  const entries = [
    card(397600, 'Greninja ex', 'MEP 099', 'mep'),
    card(2, 'Greninja', '339/S-P', 's-p'),
    card(3, 'Greninja', '41/146', 'xy-en'),
    card(4, 'Greninja ex', 'Ultra Rare | 021/128', '30c'),
    card(5, 'Mega Greninja ex', 'MEP 081', 'mep'),
  ];
  const ranked = catalog.rankScannerCandidates({ name: 'Greninja @X', number: 'J MEP EN 099 *' }, entries, 10);
  assert.equal(ranked[0].id, 397600);
  assert.equal(ranked[0].numberScore, 1);
  assert.equal(catalog.assessScan(ranked), 'certain');
  // Senza numero promo letto resta una proposta.
  assert.notEqual(catalog.assessScan(catalog.rankScannerCandidates({ name: 'Greninja', number: '' }, entries, 10)), 'certain');
  assert.equal(catalog.entryNumberLabel(entries[0]), 'MEP 99');
  assert.ok(catalog.catalogNumberKeys(entries).has('MEP 99'));
});

test('formati trovati sul campione di 705 carte: promo JP lette con 5, 30th-P, MEE, simbolo attaccato al totale', () => {
  const promos = (text) => JSON.stringify(parser.extractPromoNumbers(text));
  assert.equal(promos('231/5V-P'), JSON.stringify(['231/SV-P']));
  assert.equal(promos('PROMO 0 118/5-P 2020'), JSON.stringify(['118/S-P']));
  assert.equal(promos('049/5m-P 2017'), JSON.stringify(['49/SM-P']));
  assert.equal(promos('025/30th-P'), JSON.stringify(['25/30TH-P']));
  assert.equal(promos('MEE 007'), JSON.stringify(['MEE 7']));
  assert.equal(parser.extractCollectorNumber('231/5V-P'), null);

  const entries = [
    card(1, 'Pikachu', '043/049', 'sm11b'),
    card(2, 'Zekrom', 'Ultra Rare | 105a/124', 'fco'),
    card(3, 'Zamazenta V', 'Prerelease 023', 'swshbs'),
    card(4, 'Ogerpon ex', 'Premium Collection | TWM 040', 'svpromo'),
    card(5, 'Pikachu', 'TG19/TG30', 'brs'),
    card(6, 'Cinderace', 'SV9', 'shf'),
  ];
  const numberScore = (number, id) =>
    catalog.rankScannerCandidates({ name: '', number }, entries, 10).find((c) => c.id === id)?.numberScore ?? 0;
  // "043/0490": il simbolo di rarita' letto come una cifra in piu'.
  assert.equal(numberScore('Inc i c 043/0490 N 02019', 1), 0.9);
  assert.equal(catalog.entryNumberLabel(entries[1]), '105/124');
  assert.equal(catalog.entryNumberLabel(entries[2]), 'SWSH 23');
  assert.equal(numberScore('2020 0 SWSH023 2020', 3), 1);
  assert.equal(catalog.entryPromoNumber(entries[3]), null);
  assert.equal(numberScore('VMLX TG19/TIG30 4', 5), 1);
  assert.equal(catalog.entryNumberLabel(entries[5]), 'SV9/SV122');
});

test('promo con sigla e numero letti in passate diverse (Greninja ex MEP 099 reale)', () => {
  const entries = [
    card(397600, 'Greninja ex', 'MEP 099', 'mep'),
    card(2, 'Greninja', '339/S-P', 's-p'),
    card(3, 'Greninja', 'Holo Promo | SWSH 305', 'swshbs'),
    card(4, 'Pikachu', 'MEP 099', 'mep'),
  ];
  const ocr = { name: '== Greninja(Z,<  7 {', number: ' INTER 099 EH i -\ni i MEP E -    oY  wr is noce' };
  const ranked = catalog.rankScannerCandidates(ocr, entries, 10);
  assert.equal(ranked[0].id, 397600);
  assert.equal(ranked[0].numberScore, 0.75);
  // Senza la sigla, "099" da solo non basta.
  const noCode = catalog.rankScannerCandidates({ ...ocr, number: 'INTER 099 EH' }, entries, 10);
  assert.notEqual(noCode[0]?.numberScore, 0.75);
});

test('"Evolves from X" sotto il nome non conta come nome (caso reale Mismagius SM245)', () => {
  const entries = [card(1, 'Mismagius', 'SM245', 'smbs'), card(2, 'Misdreavus', '067/193', 'm2a')];
  const ranked = catalog.rankScannerCandidates({ name: 'smce1 | MSE\noS Evolves from Misdreavus ~', number: '' }, entries, 10);
  assert.equal(ranked.find((c) => c.id === 2), undefined);
  assert.equal(catalog.rankScannerCandidates({ name: 'Mismagius\nEvolves from Misdreavus', number: '' }, entries, 10)[0].id, 1);
  assert.equal(catalog.rankScannerCandidates({ name: 'Si evolve da Misdreavus', number: '' }, entries, 10).length, 0);
});

test('sigla stampata accanto al numero: separa 151 inglese e giapponese con stesso nome e numero', () => {
  const entries = [card(1, 'Mew ex', 'Ultra Rare | 151/165', 'mew'), card(2, 'Mew ex', '151/165', 'sv2a')];
  const ranked = catalog.rankScannerCandidates({ name: 'Mew ex', number: 'MEW EN 151/165' }, entries, Infinity);
  assert.equal(ranked[0].id, 1);
  assert.equal(ranked[0].setCodeMatch, true);
  assert.equal(catalog.assessScan(ranked, { complete: true }), 'certain');
  // Senza sigla letta restano due carte uguali: da confermare, a meno che la
  // lingua letta escluda quella giapponese.
  const blind = catalog.rankScannerCandidates({ name: 'Mew ex', number: '151/165' }, entries, Infinity);
  assert.equal(catalog.assessScan(blind, { complete: true }), 'probable');
  assert.equal(catalog.assessScan(blind, { complete: true, language: 'it' }), 'certain');
  // La riga del copyright non e' una sigla.
  const copyright = catalog.rankScannerCandidates({ name: 'Mew ex', number: '151/165\n©2023 Pokemon MEW' }, entries, Infinity);
  assert.notEqual(copyright[0].setCodeMatch, true);
});

test('numero + sigla + immagine bastano senza nome (nome tradotto sulle carte italiane)', () => {
  const top = { ...card(1, 'Brute Bonnet', 'Rare | 123/182', 'par'), score: 0.63, nameScore: 0, numberScore: 1, setCodeMatch: true, visualScore: 0.5 };
  const other = { ...card(2, 'Brute Bonnet', '123/182', 'sv4'), score: 0.55, nameScore: 0, numberScore: 1, visualScore: 0.49 };
  assert.equal(catalog.assessScan([top, other], { complete: true }), 'certain');
  assert.equal(catalog.assessScan([{ ...top, visualScore: 0.3 }, other], { complete: true }), 'probable');
  assert.equal(catalog.assessScan([top, { ...other, visualScore: 0.7 }], { complete: true }), 'probable');
});

test("l'immagine smentisce un vicino letto per caso, ma non una carta su cui nome e numero concordano", () => {
  // Caso reale (Servine BLK 2/86): numero esatto e illustrazione identica, nome
  // non letto; un'altra carta con mezza parola del nome e un numero simile
  // bloccava la certezza pur non somigliando affatto alla foto.
  const top = { ...card(1, 'Servine', '002/086', 'blk'), score: 0.55, nameScore: 0, numberScore: 1, visualScore: 0.98 };
  const neighbour = { ...card(2, 'Serperior', '003/086', 'blk'), score: 0.56, nameScore: 0.42, numberScore: 0.68, visualScore: 0.53 };
  assert.equal(catalog.assessScan([top, neighbour], { complete: true }), 'certain');
  assert.equal(catalog.assessScan([top, { ...neighbour, visualScore: 0.8 }], { complete: true }), 'probable');
  // Con nome e numero entrambi compatibili il vicino resta un'alternativa vera.
  assert.equal(catalog.assessScan([top, { ...neighbour, nameScore: 0.6 }], { complete: true }), 'probable');
});

test('numero + immagine sulle foto: somiglianza media ma molto sopra tutte le altre', () => {
  const top = { ...card(1, 'Healing Scarf', '084/108', 'ros'), score: 0.73, nameScore: 0.41, numberScore: 1, visualScore: 0.55 };
  const other = { ...card(2, 'Hawlucha', '064/108', 'ros'), score: 0.58, nameScore: 0.45, numberScore: 0.68, visualScore: 0.19 };
  assert.equal(catalog.assessScan([top, other], { complete: true }), 'certain');
  assert.equal(catalog.assessScan([top, { ...other, visualScore: 0.35 }], { complete: true }), 'probable');
  assert.equal(catalog.assessScan([{ ...top, visualScore: 0.38 }, { ...other, visualScore: 0 }], { complete: true }), 'probable');
});

test('numero corto con la barra letta come cifra, e barra nel nome', () => {
  const entries = [card(1, 'Articuno', '27/99', 'nxd'), card(2, 'Articuno', '17/108', 'roaring')];
  const ranked = catalog.rankScannerCandidates({ name: 'Articuno', number: 'O 27199 x' }, entries, Infinity);
  assert.equal(ranked[0].id, 1);
  assert.equal(ranked[0].numberScore, 0.75);
  // Quattro cifre attaccate non bastano: troppo facili da trovare per caso.
  assert.equal(catalog.rankScannerCandidates({ name: 'Articuno', number: '12799 3' }, entries, Infinity)[0].numberScore, 0);
  const servine = catalog.rankScannerCandidates({ name: 'mecl/Sarvine', number: '' }, [card(3, 'Servine', '002/086', 'blk')], Infinity);
  assert.ok(servine[0]?.nameScore >= 0.75);
});

test('suffissi ex/V non letti non contano contro il nome', () => {
  const entries = [card(1, 'Glimmora ex', 'Double Rare | 123/197', 'obf'), card(2, 'Glimmora', '124/197', 'obf')];
  const ranked = catalog.rankScannerCandidates({ name: 'Glimmora', number: '123/197' }, entries, Infinity);
  assert.equal(ranked[0].id, 1);
  assert.equal(ranked[0].nameScore, 1);
});
