-- Track which plan was last purchased per tenant so Super Admin
-- can show "Plan actual" without querying transaction history.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS last_plan TEXT;
