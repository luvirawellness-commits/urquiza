-- Online seña payments (mp-webhook) used category = 'deposit', while the
-- in-person seña flow (useRegisterDeposit) already used 'session' — an
-- oversight, not a deliberate distinction, that silently excluded online
-- señas from the P&L's Sesiones line. mp-webhook now inserts 'session'
-- going forward; this backfills the handful of rows written before that fix.
UPDATE transactions SET category = 'session' WHERE category = 'deposit';
