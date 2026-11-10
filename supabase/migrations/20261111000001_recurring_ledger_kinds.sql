-- Ledger entries for recurring memberships (kept in their own migration:
-- a new enum value can't be used in the transaction that adds it).
alter type public.ledger_kind add value if not exists 'grant_renewal';
alter type public.ledger_kind add value if not exists 'period_expired';
alter type public.ledger_kind add value if not exists 'grant_reward';
