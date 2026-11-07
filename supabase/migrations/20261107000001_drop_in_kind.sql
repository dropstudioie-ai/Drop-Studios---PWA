-- "Drop In": pay for a single regular class without a membership.
-- Own migration: a new enum value can't be used in the transaction that adds it.
alter type public.payment_kind add value if not exists 'drop_in';
