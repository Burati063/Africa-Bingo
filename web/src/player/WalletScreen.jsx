import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { dt, etb, txLabel, txSign } from '../format.js';
import { useToast } from '../components/Toast.jsx';

const TELEBIRR_STEPS = [
  '1የ Telebirr አካውንት: 0972449537 - Leul',
  '2ከላይ ባለው የ Telebirr አካውንት ገንዘቡን ያስገቡ',
  '3ገንዘቡን ከላካችሁ በኋላ Telebirr የክፍያ ማረጋገጫ (receipt) ሊንክ ይደርሳችኋል',
  '4የደረሳችሁን የክፍያ ማረጋገጫ (receipt) ሊንክ ሙሉውን ኮፒ(copy) በማድረግ ከታች ባለው Verify Your Payment ማስገቢያ ላይ ፔስት(paste) በማድረግ Verify & add funds ይጫኑ',
];

export default function WalletScreen({ me, token, refreshMe }) {
  const [method, setMethod] = useState('telebirr');
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [deposits, setDeposits] = useState([]);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [tx, dep] = await Promise.all([
        api('/api/wallet/transactions', { token }),
        api('/api/wallet/deposits', { token }),
      ]);
      setTransactions(tx);
      setDeposits(dep);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [token, toast]);

  useEffect(() => {
    load();
  }, [load]);

  async function verify(event) {
    event.preventDefault();
    const value = link.trim();
    if (!value) {
      toast('Paste the transaction link from your receipt.', 'error');
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const result = await api('/api/wallet/deposit/verify-link', {
        token,
        method: 'POST',
        body: { link: value },
      });
      setMessage(result);
      if (result.status === 'verified') {
        toast(`${etb(result.amount)} ETB added to your balance.`);
        setLink('');
        await refreshMe();
        await load();
      } else {
        toast('Payment sent for manual review.', 'info');
        await load();
      }
    } catch (err) {
      toast(err.message, 'error');
      setMessage({ status: 'error', message: err.message });
    } finally {
      setBusy(false);
    }
  }

  const steps = TELEBIRR_STEPS;
  const accountNumber = '0972449537';

  async function copyAccount() {
    try {
      await navigator.clipboard.writeText(accountNumber);
      toast('Account number copied.');
    } catch {
      toast('Copy failed — select the number manually.', 'error');
    }
  }

  const hasHistory = transactions.length > 0;

  return (
    <div className="wallet-screen">
      <section className="balance-hero">
        <p className="eyebrow">Available Balance</p>
        <div className="balance-value">
          {etb(me?.user?.balance)} <span>ETB</span>
        </div>
        <div className="balance-sub">
          <span>Africa Bingo player account</span>
        </div>
        {me?.pendingDeposits > 0 && (
          <div className="notice">You have {me.pendingDeposits} deposit(s) waiting for manual review.</div>
        )}
      </section>

      <section className="panel" id="deposit">
        <div className="section-title">
          <h3>Deposit</h3>
          <span className="badge">Instant Verification</span>
        </div>

        <div className="method-cards">
          <button
            type="button"
            className={`method-card ${method === 'telebirr' ? 'active' : ''}`}
            onClick={() => setMethod('telebirr')}
          >
            <span className="method-logo telebirr">T</span>
            <span className="method-name">Telebirr</span>
            <span className="method-tag">Better Transaction Fee</span>
          </button>
        </div>

        <div className="instructions">
          <div className="instructions-head">
            <h4>Telebirr Payment Instructions</h4>
            <button type="button" className="copy-btn" onClick={copyAccount}>
              Copy account
            </button>
          </div>
          {steps.map((step) => (
            <p key={step} className="amharic-step">
              {step}
            </p>
          ))}
        </div>

        <form className="verify-card" onSubmit={verify}>
          <div className="section-title">
            <h4>Verify Your Payment</h4>
            <span className="badge gold">Receipt Link</span>
          </div>
          <p className="muted small">
            Paste the receipt link from the Telebirr SMS or app. We open the official receipt and credit the
            amount paid to the platform account.
          </p>
          <textarea
            value={link}
            onChange={(event) => setLink(event.target.value)}
            rows={3}
            placeholder="https://transactioninfo.ethiotelecom.et/receipt/…"
            spellCheck={false}
          />
          <div className="examples">
            <span>Examples:</span>
            <code>https://transactioninfo.ethiotelecom.et/receipt/CHQ0FJ403O</code>
            <span className="muted">Telebirr transaction numbers are also accepted.</span>
          </div>
          <p className="fine-print">
            Verifies official Telebirr receipts against the platform account. If the amount is above the
            auto-verify limit, an admin reviews it.
          </p>
          <button type="submit" className="btn primary big" disabled={busy}>
            {busy ? 'Verifying…' : 'Verify & add funds'}
          </button>
          {message && (
            <div className={`verify-result ${message.status}`}>
              {message.message}
              {message.txRef ? <span className="txref">Ref: {message.txRef}</span> : null}
            </div>
          )}
        </form>

        {deposits.filter((d) => d.status === 'PENDING_REVIEW').length > 0 && (
          <div className="pending-deposits">
            <h4>Pending review</h4>
            {deposits
              .filter((d) => d.status === 'PENDING_REVIEW')
              .map((d) => (
                <div className="pending-row" key={d.id}>
                  <span>{d.txRef}</span>
                  <span>{d.amount ? `${etb(d.amount)} ETB` : 'amount pending'}</span>
                  <span className="status-dot pending">PENDING</span>
                </div>
              ))}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="section-title">
          <h3>History</h3>
          <button type="button" className="link-btn" onClick={load}>
            Refresh
          </button>
        </div>

        {loading ? (
          <div className="skeleton-list">
            <div className="skeleton" />
            <div className="skeleton" />
          </div>
        ) : hasHistory ? (
          <div className="tx-list">
            {transactions.map((tx) => (
              <div className="tx-row" key={tx.id}>
                <span className={`tx-icon ${tx.type}`}>
                  {tx.type === 'deposit' ? '↓' : tx.type === 'withdrawal' ? '↑' : tx.type === 'win' ? '🏆' : tx.type === 'stake' ? '🎱' : '•'}
                </span>
                <div className="tx-main">
                  <strong>{txLabel[tx.type] || tx.type}</strong>
                  <span className="muted small">
                    {dt(tx.createdAt)} {tx.reference ? `· ${tx.reference}` : ''}
                  </span>
                </div>
                <div className="tx-amount">
                  <strong className={txSign(tx) === '+' ? 'positive' : 'negative'}>
                    {txSign(tx)}
                    {etb(Math.abs(tx.amount))} ETB
                  </strong>
                  <span className={`status-dot ${tx.status}`}>{tx.status}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <div className="empty-icon">🧾</div>
            <h4>No Transactions Yet</h4>
            <p>Your transaction history will appear here</p>
            <a className="btn primary" href="#deposit">
              Make Your First Deposit
            </a>
          </div>
        )}
      </section>
    </div>
  );
}
