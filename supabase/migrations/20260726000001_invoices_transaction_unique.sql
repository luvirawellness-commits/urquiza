-- Prevents issuing two invoices for the same transaction. Partial (WHERE
-- transaction_id IS NOT NULL) since most existing invoice call sites don't
-- populate transaction_id yet (see Agenda.tsx/VenderMembresiaModal.tsx/
-- GiftCards.tsx, which only pass appointment_id or nothing) — a plain unique
-- index would otherwise treat all those NULLs as needing to be distinct from
-- each other, which they already are in Postgres (NULL <> NULL), but the
-- WHERE clause keeps the index small and its intent explicit either way.
--
-- Run the duplicate-check query (see chat) before applying this — if any
-- transaction_id already has more than one invoice, this CREATE will fail.
CREATE UNIQUE INDEX IF NOT EXISTS invoices_transaction_id_unique
  ON invoices(transaction_id) WHERE transaction_id IS NOT NULL;
