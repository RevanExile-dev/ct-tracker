-- Preserva le date esistenti; le acquisizioni senza data restano NULL.
--
-- lock_timeout/statement_timeout impostati qui via SET LOCAL (non come
-- parametro di startup PGOPTIONS nel workflow, vedi commit precedente): la
-- connessione pooled di Neon (pgbouncer) rifiuta parametri di startup non
-- riconosciuti con un errore di CONNESSIONE, prima ancora che psql possa
-- eseguire una query ("unsupported startup parameter in options:
-- lock_timeout") - fallito in produzione al primo tentativo reale (run
-- 36992644050), non colto da nessuna review ne' dalla CI (che testa contro
-- un Postgres 16 diretto, non il pooler Neon). SET LOCAL e' un comando SQL
-- normale esegubile su qualunque connessione, scoped alla transazione.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE binder_lots ALTER COLUMN acquired_at DROP NOT NULL;
ALTER TABLE binder_lots ALTER COLUMN acquired_at DROP DEFAULT;
COMMIT;
