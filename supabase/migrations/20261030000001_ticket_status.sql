-- A spot held while a workshop ticket is being paid for. Kept in its own
-- migration because a new enum value can't be used in the transaction that adds it.
alter type public.booking_status add value if not exists 'pending_payment';
