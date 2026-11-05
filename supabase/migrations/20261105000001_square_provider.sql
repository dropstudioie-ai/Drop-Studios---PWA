-- Online payments move from Stripe to Square (the studio's existing provider).
-- Own migration: a new enum value can't be used in the transaction that adds it.
-- 'stripe' stays in the type so older rows (if any) remain valid.
alter type public.payment_provider add value if not exists 'square';
