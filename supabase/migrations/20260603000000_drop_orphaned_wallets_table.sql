/*
  # Drop orphaned `wallets` table

  The app migrated to a `transactions` ledger as the single source of truth for
  player balances (balance = SUM of a player's transactions). After that move the
  `wallets` table was only written by the unused `complete-session` edge function
  (now deleted) and read by an old version of `monthly-email` (since fixed to read
  the ledger). Nothing references it anymore.

  ⚠️ DESTRUCTIVE & IRREVERSIBLE: this permanently deletes the `wallets` table and
  any rows in it. The data there is stale (it has not tracked real balances since
  the ledger migration), but if you want to keep a backup, export the table from
  the Supabase dashboard BEFORE applying this migration. If you are not ready to
  drop it, simply delete this migration file — the table is harmless if left in place.

  CASCADE also removes the RLS policies attached to the table.
*/

DROP TABLE IF EXISTS wallets CASCADE;
