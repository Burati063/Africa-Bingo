import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { dt, etb, etbShort } from '../format.js';
import { useToast } from '../components/Toast.jsx';

export default function WithdrawScreen({ me, token, refreshMe }) {
  const [amount, setAmount] = useState('');
  const [bank, setBank] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountName, setAccountName] = useState(me?.user?.firstName || '');
  const [busy, setBusy] = useState(false);
  const [withdrawals, setWithdrawals] = useState([]);
  const toast = useToast();

  const load = async () => {
    try {
      setWithdrawals(await api('/api/wallet/withdrawals', { token }));
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const banks = me?.config?.banks || ['Telebirr', 'CBE'];
  const pending = withdrawals.find((w) => w.status === 'PENDING') || me?.pendingWithdrawal;
  const amountValue = Number(amount);
  const minWithdraw = me?.config?.minWithdraw || 5000;

  async function submit(event) {
    event.preventDefault();
    if (!amountValue || amountValue <= 0) {
      toast('Enter a valid withdrawal amount.', 'error');
      return;
    }
    if (amountValue * 100 < minWithdraw) {
      toast(`Minimum withdrawal is ${etbShort(minWithdraw)} ETB.`, 'error');
      return;
    }
    if (!bank) {
      toast('Select a bank / wallet.', 'error');
      return;
    }
    setBusy(true);
    try {
      await api('/api/wallet/withdrawals', {
        token,
        method: 'POST',
        body: {
          amount: amountValue,
          bank,
          accountNumber,
          accountName,
        },
      });
      toast('Withdrawal request submitted. Please wait for approval.');
      setAmount('');
      await load();
      await refreshMe();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="withdraw-screen">
      <section className="withdraw-note amharic">
        <p>ውድ ደምበኞቻችን</p>
        <p>
          ይህ የማኑአል (Manual) ወጪ ማድረጊያ ፎርም ነው። 1 ጥያቄ ከተየቁ እስከ 30 ደኪካ ድረስ እንዲታገሱን በክብር እንጠይቃለን
        </p>
        <p>ከለሊት 6 ሰዓት እስከ ጠዋቱ 3 ሰዓት ድረስ ለጊዜው Withdraw አይዘዙ</p>
      </section>

      <section className="balance-chip-row">
        <div>
          <span className="muted small">Available balance</span>
          <strong>
            {etb(me?.user?.balance)} <small>ETB</small>
          </strong>
        </div>
        <span className="badge">Min {etbShort(minWithdraw)} ETB</span>
      </section>

      {pending && (
        <div className="notice">
          You already have a withdrawal of {etb(pending.amount)} ETB pending approval. You can submit another request
          once it is processed.
        </div>
      )}

      <form className="panel withdraw-form" onSubmit={submit}>
        <h3>Withdraw</h3>

        <label className="field">
          <span>Amount(የገንዘብ መጠን)</span>
          <div className="amount-input">
            <input
              type="number"
              min="1"
              step="1"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="0"
            />
            <span>ETB</span>
          </div>
        </label>

        <label className="field">
          <span>Bank (ባንክ ይምረጡ)</span>
          <select value={bank} onChange={(event) => setBank(event.target.value)}>
            <option value="">ባንክ ይምረጡ</option>
            {banks.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Account Number (የሂሳብ ቁጥር)</span>
          <input
            value={accountNumber}
            onChange={(event) => setAccountNumber(event.target.value)}
            placeholder="የሂሳብ ቁጥር"
            inputMode="numeric"
          />
        </label>

        <label className="field">
          <span>Account Holder Name (የሂሳብ ባለቤት ስም)</span>
          <input
            value={accountName}
            onChange={(event) => setAccountName(event.target.value)}
            placeholder="የሂሳብ ባለቤት ስም"
          />
        </label>

        <div className="summary-panel">
          <div className="summary-head">
            <span>Withdrawal Summary</span>
            <span className="status-dot pending">PENDING APPROVAL</span>
          </div>
          <div className="summary-row">
            <span>Amount</span>
            <strong>{amountValue ? `${etb(amountValue * 100)} ETB` : '0 ETB'}</strong>
          </div>
          <div className="summary-row">
            <span>Bank</span>
            <strong>{bank || 'Not selected'}</strong>
          </div>
          <div className="summary-row">
            <span>Account Number</span>
            <strong>{accountNumber || 'Not provided'}</strong>
          </div>
          <div className="summary-row">
            <span>Processing Time</span>
            <strong>15 - 30 Minutes</strong>
          </div>
        </div>

        <button type="submit" className="btn primary big" disabled={busy || Boolean(pending)}>
          {busy ? 'Submitting…' : '📤 Submit Withdrawal Request'}
        </button>
      </form>

      {withdrawals.length > 0 && (
        <section className="panel">
          <div className="section-title">
            <h3>Withdrawal requests</h3>
            <button type="button" className="link-btn" onClick={load}>
              Refresh
            </button>
          </div>
          <div className="tx-list">
            {withdrawals.map((w) => (
              <div className="tx-row" key={w.id}>
                <span className="tx-icon withdrawal">↑</span>
                <div className="tx-main">
                  <strong>{etb(w.amount)} ETB</strong>
                  <span className="muted small">
                    {w.bank} · {w.accountNumber} · {dt(w.createdAt)}
                  </span>
                  {w.adminNotes && <span className="muted small">Note: {w.adminNotes}</span>}
                </div>
                <span className={`status-dot ${w.status.toLowerCase()}`}>{w.status}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
