-- Atomic caja close: tenants.caja_fondo_fijo update + caja_closings insert in one
-- transaction, callable by any tenant member regardless of role.
--
-- Fixes: closing caja as receptionist silently failed the fondo update because
-- tenants' RLS UPDATE policy only allows owner/partner_admin. SECURITY DEFINER
-- bypasses that, but since RLS no longer guards this write, the function checks
-- tenant membership itself via user_tenants.
--
-- Also fixes non-atomicity: previously the tenants update and caja_closings
-- insert were separate calls — if the insert failed, the fund had already
-- changed with no closing record to show it.

CREATE OR REPLACE FUNCTION close_caja(
  p_tenant_id        uuid,
  p_nuevo_fondo       numeric,
  p_fecha             date,
  p_fondo_inicial     numeric,
  p_efectivo_del_dia  numeric,
  p_gastos_efectivo   numeric,
  p_total_esperado    numeric,
  p_contado_fisico    numeric,
  p_depositado        numeric,
  p_credito           numeric,
  p_debito            numeric,
  p_qr_transferencia  numeric,
  p_notas             text,
  p_user_id           uuid
)
RETURNS tenants
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result tenants;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM user_tenants
    WHERE user_id = auth.uid() AND tenant_id = p_tenant_id AND active = true
  ) THEN
    RAISE EXCEPTION 'No pertenece a este tenant';
  END IF;

  UPDATE tenants
  SET caja_fondo_fijo = p_nuevo_fondo
  WHERE id = p_tenant_id
  RETURNING * INTO result;

  INSERT INTO caja_closings (
    tenant_id, fecha, fondo_inicial, efectivo_del_dia, gastos_efectivo,
    total_esperado, contado_fisico, depositado, fondo_resultante,
    credito, debito, qr_transferencia, notas, created_by
  ) VALUES (
    p_tenant_id, p_fecha, p_fondo_inicial, p_efectivo_del_dia, p_gastos_efectivo,
    p_total_esperado, p_contado_fisico, p_depositado, p_nuevo_fondo,
    p_credito, p_debito, p_qr_transferencia, p_notas, p_user_id
  );

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION close_caja(
  uuid, numeric, date, numeric, numeric, numeric, numeric, numeric, numeric,
  numeric, numeric, numeric, text, uuid
) TO authenticated;
