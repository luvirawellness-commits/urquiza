-- Splits the single 'salary_advance' expense category into
-- 'salary_advance_operativo' / 'salary_advance_admin', mirroring the existing
-- salary_operativo/salary_admin split, so advances can be attributed to the
-- correct P&L bucket without inspecting the employee's job position.

ALTER TABLE transactions
DROP CONSTRAINT txn_expense_category_valid;

ALTER TABLE transactions
ADD CONSTRAINT txn_expense_category_valid CHECK (
  (type <> 'expense') OR (category = ANY (ARRAY[
    'supplies', 'rent', 'utilities', 'salary_operativo',
    'salary_admin', 'salary', 'social_charges', 'marketing',
    'management', 'bank_fees', 'maintenance', 'depreciation',
    'withdrawal', 'royalty', 'cash_transfer', 'other',
    'aguinaldo', 'vacaciones', 'internal_transfer',
    'salary_advance_operativo', 'salary_advance_admin'
  ]))
);
