# Prezzi di riferimento da altri portali (external_prices)

Stato al 2026-10-09: implementata solo la fonte **TCGplayer** (via tcgcsv). Cardmarket (via TCGdex) e
l'interfaccia nella pagina carta sono i passi successivi.

## Perche' questa strada
- Cardmarket e TCGplayer **non concedono piu' accesso API** a nuovi sviluppatori
  (help.cardmarket.com/en/cardmarket-api, docs.tcgplayer.com/docs/getting-started).
- pokemontcg.io e' deprecato (chiavi valide fino al 2027-03-01), PriceCharting vieta la
  ripubblicazione dei prezzi, Scrydex costa da 29 $/mese: scartati (zero spese).
- **tcgcsv.com** specchia i dati TCGplayer con un file per set, aggiornato verso le 20:00 UTC.
  Aggancio per `blueprints.tcg_player_id` = `productId` (stesso numero che CardTrader riporta):
  81% del catalogo ha gia' l'id, 93% del campione misurato e' presente in tcgcsv.
- **TCGdex** (api.tcgdex.net) da' i prezzi Cardmarket in euro, una carta per richiesta, aggiornati in
  blocco la sera (~22:54 UTC). Nel campione di 200 carte: 74% trovato per set+numero, 0 abbinamenti
  sbagliati su 72 verificabili; l'id CardTrader compare solo nel 6% dei casi (non usarlo come chiave).
  Attenzione: `expansions.code` NON e' unico (`ltr`, `upr` doppi), abbinare per `expansion_id`.

## Regole da non rompere
- Sono **medie per prodotto, senza lingua ne' condizione**: vivono in `external_prices`, mai in
  `latest_prices`, e non entrano nei tre profili di prezzo, nei movers, negli allarmi. L'interfaccia li
  mostra come "riferimento di mercato", con fonte, valuta originale e data.
- Nessun DELETE automatico; chi legge scarta le righe con `fetched_at` vecchio.
- Il job ha un gruppo di concorrenza suo (`ct-tracker-external-prices`): non blocca il giro CardTrader.
- Una richiesta alla volta, con User-Agent identificabile e pausa di 0,25 s. Nessun termine d'uso
  scritto da tcgcsv/TCGdex: non rivendere i dati e non esporre un'API di massa.

## Misure (2026-10-09)
- Giro completo: 681 set (Pokemon EN cat. 3 + Giappone cat. 85), ~255-270 s, 11,4 MB, 0 errori.
- Scrittura a blocchi su Neon (80.496 righe di prova): 1,7 s, 11 MB; dopo una riscrittura completa 19 MB
  finche' autovacuum non recupera lo spazio.
