import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { etb } from '../format.js';
import { BarChart, LineChart, PieChart } from '../components/Charts.jsx';

const money = (santim) =>
  `${Number(etb(santim)).toLocaleString('en-US', { maximumFractionDigits: 2 })} ETB`;

function Stat({ label, value, hint, tone = '' }) {
  return (
    <div className={`stat-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {hint && <small>{hint}</small>}
    </div>
  );
}

export default function Overview({ token, onNavigate }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      setData(await api('/api/admin/overview', { token }));
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (!data) return <div className="panel">{error ? <div className="form-error">{error}</div> : 'Loading analytics…'}</div>;

  const t = data.totals;
  const pie = data.pie.map((item) => ({
    label: item.label.charAt(0).toUpperCase() + item.label.slice(1),
    value: item.value,
  }));

  return (
    <div className="overview">
      {error && <div className="form-error">{error}</div>}

      <div className="stat-grid">
        <Stat label="Total deposits" value={money(t.deposits)} hint="Verified player deposits" tone="gold" />
        <Stat label="Total withdrawals" value={money(t.withdrawals)} hint="Approved payouts" />
        <Stat label="Platform fees" value={money(t.platformFees)} hint="Entry fee margin on real stakes" tone="green" />
        <Stat label="Agent commissions" value={money(t.agentCommissions)} hint={`Includes ${money(t.referralBonuses)} referral bonuses`} />
        <Stat label="Net revenue" value={money(t.netRevenue)} hint="Fees − agent commissions" tone="green" />
        <Stat label="Prize payouts" value={money(t.winPayouts)} hint="Paid to players" />
        <Stat label="Players" value={t.players.toLocaleString()} hint={`+${t.newUsersWeek} this week`} />
        <Stat label="Active players" value={`${data.active.daily} / ${data.active.weekly} / ${data.active.monthly}`} hint="Daily / weekly / monthly" />
        <Stat label="Rounds played" value={data.gameStats.rounds.toLocaleString()} hint={`Avg stake ${etb(data.gameStats.avgStake)} ETB`} />
        <Stat label="Biggest win" value={money(data.gameStats.biggestWin)} hint={`Avg players/round ${data.gameStats.avgPlayers.toFixed(1)}`} />
        <Stat label="GMV (stakes)" value={money(t.gmv)} hint="Last 14 days" />
        <Stat label="Avg prize pool" value={money(data.gameStats.avgPrize)} hint="Per finished round" />
      </div>

      <div className="pending-row-cards">
        <button type="button" className="pending-card" onClick={() => onNavigate('withdrawals')}>
          <span>Pending player withdrawals</span>
          <strong>{data.pending.withdrawals}</strong>
        </button>
        <button type="button" className="pending-card" onClick={() => onNavigate('withdrawals')}>
          <span>Pending agent withdrawals</span>
          <strong>{data.pending.agentWithdrawals}</strong>
        </button>
        <button type="button" className="pending-card" onClick={() => onNavigate('withdrawals')}>
          <span>Deposits needing review</span>
          <strong>{data.pending.deposits}</strong>
        </button>
      </div>

      <div className="chart-grid">
        <section className="panel wide">
          <div className="section-title">
            <h3>Deposits vs withdrawals</h3>
            <span className="muted small">Last 14 days (ETB)</span>
          </div>
          <LineChart
            data={data.series}
            series={[
              { key: 'deposits', label: 'Deposits', color: '#f5c542' },
              { key: 'withdrawals', label: 'Withdrawals', color: '#60a5fa' },
              { key: 'winPayouts', label: 'Win payouts', color: '#4ade80' },
            ]}
          />
        </section>

        <section className="panel">
          <div className="section-title">
            <h3>Rounds per day</h3>
            <span className="muted small">Last 14 days</span>
          </div>
          <BarChart data={data.series} valueKey="rounds" />
        </section>

        <section className="panel">
          <div className="section-title">
            <h3>Money flow</h3>
            <span className="muted small">Completed transactions</span>
          </div>
          <PieChart data={pie} />
        </section>
      </div>

      <p className="muted small">
        All amounts are in ETB. Net revenue deducts agent commissions and referral bonuses from platform fees.
      </p>
    </div>
  );
}
