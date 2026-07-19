-- Registers an internal transfer between two payment methods of the same
-- tenant as a matched pair of transactions (expense from origin, income to
-- destination) in a single atomic statement, so a partial write is impossible.

CREATE OR REPLACE FUNCTION create_internal_transfer(
  p_tenant_id    uuid,
  p_user_id      uuid,
  p_from_method  text,
  p_to_method    text,
  p_amount       numeric,
  p_date         date,
  p_description  text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Only owners may register internal transfers
  IF NOT EXISTS (
    SELECT 1 FROM user_tenants
    WHERE user_id = p_user_id
      AND tenant_id = p_tenant_id
      AND role = 'owner'
      AND active = true
  ) THEN
    RAISE EXCEPTION 'No autorizado para registrar transferencias internas';
  END IF;

  IF p_from_method = p_to_method THEN
    RAISE EXCEPTION 'El medio de origen y destino no pueden ser el mismo';
  END IF;

  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'El monto debe ser mayor a cero';
  END IF;

  INSERT INTO transactions (
    tenant_id, type, category, amount, date,
    description, payment_method, user_id, status, is_recurring
  ) VALUES (
    p_tenant_id, 'expense', 'internal_transfer', p_amount, p_date,
    p_description, p_from_method, p_user_id, 'paid', false
  );

  INSERT INTO transactions (
    tenant_id, type, category, amount, date,
    description, payment_method, user_id, status, is_recurring
  ) VALUES (
    p_tenant_id, 'income', 'internal_transfer', p_amount, p_date,
    p_description, p_to_method, p_user_id, 'paid', false
  );
END;
$$;
