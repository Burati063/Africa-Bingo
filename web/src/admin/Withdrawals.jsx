import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { dt, etb } from '../format.js';
import { useToast } from '../components/Toast.jsx';

const TABS = [
  { id: 'player', label: 'Player withdrawals' },
  { id: 'agent', label: 'Agent withdrawals' },
  { id: 'deposits', label: 'Deposit review' },
];

export default function Withdrawals({ token }) {
  const [tab, setTab] = useState('player');
  const [status, setStatus] = useState('PENDING');
  const [rows, setRows] = useState([]);
  const [notes, setNotes] = useState({});
  const [depositAmounts, setDepositAmounts] = useState({});
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function load() {
    try {
      const queryStatus = tab === 'deposits' ? (status === 'PENDING' ? 'PENDING_REVIEW' : status) : status;
      const path =
        tab === 'player'
          ? `/api/admin/withdrawals?status=${queryStatus}`
          : tab === 'agent'
            ? `/api/admin/agent-withdrawals?status=${queryStatus}`
            : `/api/admin/deposits?status=${queryStatus}`;
      setRows(await api(path, { token }));
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, tab, status]);

  async function act(row, action) {
    if (busy) return;
    setBusy(true);
    try {
      let path;
      let body = { notes: notes[`${tab}-${row.id}`] || '' };
      if (tab === 'player') path = `/api/admin/withdrawals/${row.id}/${action}`;
      else if (tab === 'agent') path = `/api/admin/agent-withdrawals/${row.id}/${action}`;
      else {
        path = `/api/admin/deposits/${row.id}/${action}`;
        if (action === 'approve' && depositAmounts[row.id]) body.amount = Number(depositAmounts[row.id]);
      }
      await api(path, { token, method: 'POST', body });
      toast(`Request ${action === 'approve' ? 'approved' : 'rejected'}.`);
      await load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  const statusOptions = tab === 'deposits' ? ['PENDING', 'ALL', 'VERIFIED', 'REJECTED'] : ['PENDING', 'ALL', 'APPROVED', 'REJECTED'];

  return (
    <div className="withdrawals-tab">
      <div className="sub-tabs">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={tab === item.id ? 'active' : ''}
            onClick={() => {
              setTab(item.id);
              setStatus('PENDING');
            }}
          >
            {item.label}
          </button>
        ))}
      </div>

      <section className="panel">
        <div className="section-title">
          <h3>{TABS.find((t) => t.id === tab)?.label}</h3>
          <div className="head-actions">
            <select value={status} onChange={(event) => setStatus(event.target.value)} className="compact-select">
              {statusOptions.map((option) => (
                <option key={option} value={option}>
                  {option === 'PENDING' ? 'Pending only' : option === 'ALL' ? 'All statuses' : option}
                </option>
              ))}
            </select>
            <button type="button" className="btn ghost small" onClick={load}>
              Refresh
            </button>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              {tab === 'deposits' ? (
                <tr>
                  <th>User</th>
                  <th>Transaction</th>
                  <th>Provider</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              ) : (
                <tr>
                  <th>{tab === 'player' ? 'Player' : 'Agent'}</th>
                  <th>Amount</th>
                  <th>Bank details</th>
                  <th>Requested</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              )}
            </thead>
            <tbody>
              {rows.map((row) => {
                const noteKey = `${tab}-${row.id}`;
                if (tab === 'deposits') {
                  return (
                    <tr key={row.id}>
                      <td>
                        <strong>{row.user?.firstName || row.user?.username || row.userId}</strong>
                        <div className="muted small">@{row.user?.username || row.user?.telegramId}</div>
                      </td>
                      <td>
                        <code>{row.txRef}</code>
                        {row.receiptUrl ? (
                          <div className="muted small">
                            <a href={row.receiptUrl} target="_blank" rel="noreferrer">
                              Open receipt
                            </a>
                          </div>
                        ) : row.rawSms ? (
                          <div className="muted small sms-preview" title={row.rawSms}>
                            {row.rawSms.slice(0, 80)}…
                          </div>
                        ) : null}
                        {row.reviewNote && <div className="muted small">{row.reviewNote}</div>}
                        {row.status === 'PENDING_REVIEW' && row.autoRetry ? (
                          <div className="muted small">
                            Auto re-check queued (attempt {row.retryCount + 1})
                          </div>
                        ) : null}
                      </td>
                      <td>{row.provider}</td>
                      <td>
                        <strong>{etb(row.amount)} ETB</strong>
                      </td>
                      <td>
                        <span className={`status-dot ${row.status === 'VERIFIED' ? 'completed' : row.status === 'REJECTED' ? 'rejected' : 'pending'}`}>
                          {row.status}
                        </span>
                      </td>
                      <td>
                        {row.status === 'PENDING_REVIEW' ? (
                          <div className="action-cell">
                            <input
                              type="number"
                              placeholder="Amount ETB"
                              value={depositAmounts[row.id] ?? ''}
                              onChange={(event) =>
                                setDepositAmounts((prev) => ({ ...prev, [row.id]: event.target.value }))
                              }
                            />
                            <input
                              placeholder="Note"
                              value={notes[noteKey] || ''}
                              onChange={(event) => setNotes((prev) => ({ ...prev, [noteKey]: event.target.value }))}
                            />
                            <button type="button" className="btn small success" onClick={() => act(row, 'approve')}>
                              Approve
                            </button>
                            <button type="button" className="btn small danger" onClick={() => act(row, 'reject')}>
                              Reject
                            </button>
                          </div>
                        ) : (
                          <span className="muted small">—</span>
                        )}
                      </td>
                    </tr>
                  );
                }
                const person =
                  tab === 'player'
                    ? row.user
                      ? `${row.user.firstName || row.user.username} (@${row.user.username || row.user.telegramId})`
                      : `User ${row.userId}`
                    : row.agent?.user
                      ? `${row.agent.user.firstName || row.agent.user.username} (@${row.agent.user.username || 'agent'})`
                      : `Agent ${row.agentId}`;
                return (
                  <tr key={row.id}>
                    <td>
                      <strong>{person}</strong>
                      <div className="muted small">#{row.id}</div>
                    </td>
                    <td>
                      <strong>{etb(row.amount)} ETB</strong>
                    </td>
                    <td>
                      <div>{row.bank}</div>
                      <div className="muted small">
                        {row.accountNumber} · {row.accountName}
                      </div>
                    </td>
                    <td className="muted small">{dt(row.createdAt)}</td>
                    <td>
                      <span className={`status-dot ${row.status.toLowerCase()}`}>{row.status}</span>
                      {row.adminNotes && <div className="muted small">{row.adminNotes}</div>}
                    </td>
                    <td>
                      {row.status === 'PENDING' ? (
                        <div className="action-cell">
                          <input
                            placeholder="Note"
                            value={notes[noteKey] || ''}
                            onChange={(event) => setNotes((prev) => ({ ...prev, [noteKey]: event.target.value }))}
                          />
                          <button type="button" className="btn small success" onClick={() => act(row, 'approve')}>
                            Approve
                          </button>
                          <button type="button" className="btn small danger" onClick={() => act(row, 'reject')}>
                            Reject
                          </button>
                        </div>
                      ) : (
                        <span className="muted small">Processed</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    Nothing here.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="fine-print">
          {tab === 'deposits'
            ? 'Open the receipt link and confirm the amount was paid to the platform Telebirr/CBE account before approving — approval credits the wallet instantly.'
            : 'Approving a withdrawal confirms you have manually sent the money via Telebirr/CBE. Rejections automatically refund the reserved balance.'}
        </p>
      </section>
    </div>
  );
}
