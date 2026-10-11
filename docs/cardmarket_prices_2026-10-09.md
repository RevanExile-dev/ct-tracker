# Prezzi Cardmarket di riferimento (TCGdex), 2026-10-09

Il sito e' italiano: il riferimento di mercato che serve e' Cardmarket in euro.
Questo documento spiega cosa fa `scripts/sync_cardmarket_prices.py`, perche' e
come e' stato misurato. Il quadro generale delle fonti esterne (TCGplayer,
JustTCG, eBay, PriceCharting...) e' nel report di ricerca della stessa data.

## Regola di fondo

Sono **medie per carta, senza lingua ne' condizione**, non annunci. Vivono in
`external_prices` (source = `cardmarket`) e **non** entrano in `latest_prices`,
nei tre profili di prezzo (min / best / it_nm_zero), nei movers e negli
allarmi. Il sito le mostrera' solo in una sezione "Riferimenti di mercato" con
la data, mai al posto del prezzo di un annuncio.

## Fonte

TCGdex (`api.tcgdex.net/v2`): gratuita, senza chiave, database con licenza MIT,
nessun limite di richieste dichiarato ("sii ragionevole", FAQ). Ogni carta
riporta `pricing.cardmarket` in EUR: `trend`, `low`, `avg`, `avg1/7/30` piu' le
stesse voci con suffisso `-holo`. Si aggiorna **una volta al giorno, in blocco,
verso le 22:54 UTC**: il job gira alle 23:17 UTC. Una carta per richiesta,
nessuna richiesta multipla (GraphQL non espone i prezzi).

| `external_prices` | Cardmarket |
|---|---|
| `price_cents` | trend |
| `low_cents` | low |
| `mid_cents` | avg |
| `avg1/7/30_cents` | medie a 1/7/30 giorni |
| `variant` | `''` normale, `'holo'` riga `-holo` della fonte |
| `source_updated_at` | data riportata da TCGdex |

Una riga `holo` si scrive solo se c'e' almeno un prezzo vero: TCGdex mette `0`
in `trend-holo` quando la riga non esiste, e 0 non e' mai un prezzo Cardmarket
(minimo reale 0,02 EUR), quindi 0 vale "assente".

## Abbinamento carta CardTrader -> carta TCGdex

CardTrader e TCGdex non hanno una chiave in comune (l'id CardTrader compare in
TCGdex solo nel ~6% delle carte). Si abbina per **set + numero**, con le stesse
regole di `sync_artists.py` (set per codice PTCGO / nome / id giapponese,
numero senza zeri, nome simile per le inglesi), piu' tre aggiunte:
ripiego per nome set CardTrader (set usciti dopo lo snapshot artisti), ripiego
per id set (promo `svp`, `swshp`, `smp`, `xyp`, `bwp`), numeri "nudi" ("62")
dei promo e un'eccezione (`promosv` = promo giapponesi `SV-P`).
L'abbinamento e' per `expansion_id`, non per codice (`ltr`, `upr` esistono due
volte). Una carta e' abbinata solo se il numero e' unico nel set: se due carte
CardTrader cadono sulla stessa carta TCGdex nessuna delle due viene abbinata.

**Misurato sul catalogo vero (30.189 carte, 236 espansioni):** 23.106 abbinate
(76,5%). Le altre non si possono abbinare perche' **TCGdex non ha le carte**:
molti set giapponesi vecchi esistono su TCGdex solo come guscio vuoto (verificato:
S4a, S4, S10b, XY3, S8a ecc. hanno `cards: 0`), e mancano i promo `sm-p`, `s-p`,
`pxy`, `bwpr` e diversi starter deck. Alcuni promo (`swshbs`, `smbs`, `xybsp`)
sono abbinati solo in parte perche' CardTrader scrive il numero in modi
irregolari ("Prerelease 006").

**Controllo di identita' a ogni scarico.** Se TCGdex riporta l'id CardTrader (o,
in mancanza, TCGplayer) della carta e **non coincide col nostro**, l'abbinamento
viene annullato e il prezzo non si scrive. Su 2.000 carte abbinate a caso: 852
verificabili (124 con id CardTrader, 728 con id TCGplayer), **0 conflitti sugli
id CardTrader, 2 sui TCGplayer** (Melmetal Pokemon GO 046/078, Arctibax SVP 064):
rifiutati. Sulle altre 1.148 non esiste un id con cui verificare: li' ci si
affida a set + numero + nome.

## Quante richieste, quando

- Abbinamento: ~200 richieste (elenchi dei set), 16 s, solo per carte nuove e,
  ogni 14 giorni, per quelle non trovate. Risultato salvato in `external_card_map`.
- Scarico: 13,8 richieste/s con 4 thread e 0,1 s di pausa per thread (2.000
  richieste in 145 s, 0 errori).
- Ogni giorno: carte di binder/desideri/allarmi attivi, carte da 10 EUR in su
  e carte appena abbinate e ancora senza prezzo (solo per 7 giorni), piu'
  **1/7 delle altre a rotazione** (`id % 7`). Stima: ~6.000 richieste, ~8
  minuti. Primo giro: fino a 15.000 carte (tetto di sicurezza), ~20 minuti; il
  resto il giorno dopo.
- 97% delle carte scaricate ha un prezzo; il 56% anche la riga `holo`.

## Neon (piano free)

- Una sola scrittura al giorno, a blocchi di 400 carte (un INSERT multiplo e un
  commit per blocco). La connessione si chiude durante le attese di rete.
- Spazio: ~23.000 carte x fino a 2 righe: ~3-4 MB di dati + indice
  (misura locale: 1.636 righe = 240 kB); `external_card_map` ha una riga per
  carta (~3 MB con l'indice).
- Gruppo di concorrenza proprio (`ct-tracker-external-prices`): non aspetta e
  non blocca il giro CardTrader (`ct-tracker-db-write`).
- Nessun DELETE automatico. `fetched_at` / `source_updated_at` dicono quanto e'
  vecchio un prezzo; una riga che sparisce dalla fonte resta.
- Lo schema (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`) e'
  additivo e idempotente, come tutto `schema.sql`.

## Verifiche fatte

- 25 test sulle parti pure (`scripts/test_sync_cardmarket_prices.py`, in CI).
- Giro vero su Postgres 16 locale con il catalogo reale (30.189 carte) e TCGdex
  reale: 800 + 300 carte scritte, secondo giro idempotente, `--dry-run` che non
  scrive.
- Le stesse istruzioni SQL provate su Postgres 18 del ramo Neon di prova, in uno
  schema separato `cm_test` (non toccata la produzione): upsert corretto, riga di
  una carta inesistente saltata dalla JOIN.

## Non verificato

- Tempo di rete reale tra Actions e Neon (stima 20-70 s totali).
- Termini d'uso di TCGdex (nessuno scritto oltre alla licenza MIT del database).
- Quanto TCGdex ritarda sui set appena usciti.
- Se il prezzo Cardmarket di una carta giapponese e' quello della carta
  giapponese o della sua gemella inglese: TCGdex riporta un `idProduct`
  Cardmarket, ma non l'ho confrontato con Cardmarket.
- Il caso "repo privato": ~8 minuti al giorno (~250 al mese) di minuti Actions.
