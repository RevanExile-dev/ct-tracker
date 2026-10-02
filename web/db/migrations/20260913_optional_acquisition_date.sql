-- Preserva le date esistenti; le acquisizioni senza data restano NULL.
BEGIN;
ALTER TABLE binder_lots ALTER COLUMN acquired_at DROP NOT NULL;
ALTER TABLE binder_lots ALTER COLUMN acquired_at DROP DEFAULT;
COMMIT;
