-- Links salary-related transactions (and the supplier-invoice rows that can
-- also carry a salary_operativo/salary_admin/salary_advance category) to a
-- specific employee and payroll period, so Liquidación Mensual can deduct
-- what's already been paid.
--
-- NOTE: no CHECK constraint on transactions.category (or supplier_invoices.
-- category) is tracked anywhere in this repo's migrations — categories are
-- validated client-side only (see CAT_LABELS / EXPENSE_CATEGORIES_CAJA in
-- Finanzas.tsx). If production actually has one, it needs to be updated
-- separately once confirmed; nothing here assumes its current definition.

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS employee_user_id UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS salary_period_year INTEGER,
  ADD COLUMN IF NOT EXISTS salary_period_month INTEGER;

ALTER TABLE supplier_invoices
  ADD COLUMN IF NOT EXISTS employee_user_id UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS salary_period_year INTEGER,
  ADD COLUMN IF NOT EXISTS salary_period_month INTEGER;
