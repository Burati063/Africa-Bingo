import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { dt } from '../format.js';

export default function Audit({ token }) {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');

  async function load() {
    try {
      setRows(await api('/api/admin/audit', { token }));
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <section className="panel">
      <div className="section-title">
        <h3>Admin audit log</h3>
        <button type="button" className="btn ghost small" onClick={load}>
          Refresh
        </button>
      </div>
      {error && <div className="form-error">{error}</div>}
      <div className="audit-list">
        {rows.map((row) => (
          <div className="audit-row" key={row.id}>
            <span className="badge gold">{row.actionType}</span>
            <code className="audit-details">{row.details}</code>
            <span className="muted small">{dt(row.createdAt)}</span>
          </div>
        ))}
        {rows.length === 0 && <p className="muted">No admin actions recorded yet.</p>}
      </div>
      <p className="fine-print">
        Balance adjustments, winner overrides, withdrawal approvals, settings changes, voice uploads and broadcasts are all
        recorded here with timestamps.
      </p>
    </section>
  );
}
