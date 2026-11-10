export const etb = (santim) => (Number(santim || 0) / 100).toFixed(2);

export const etbShort = (santim) => {
  const value = Number(santim || 0) / 100;
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
};

export const dt = (iso) => {
  if (!iso) return '—';
  const date = new Date(iso);
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const dateOnly = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

export const seconds = (ms) => Math.max(0, Math.ceil(Number(ms || 0) / 1000));

export const txLabel = {
  deposit: 'Deposit',
  withdrawal: 'Withdrawal',
  stake: 'Stake',
  win: 'Win',
  adjustment: 'Adjustment',
  refund: 'Refund',
};

export const txSign = (tx) => {
  if (tx.type === 'deposit' || tx.type === 'win' || tx.type === 'refund') return '+';
  if (tx.type === 'withdrawal' || tx.type === 'stake') return '−';
  return tx.amount >= 0 ? '+' : '−';
};
