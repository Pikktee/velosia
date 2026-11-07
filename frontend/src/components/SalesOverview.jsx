import { TrendingUp } from 'lucide-react';
import { listingPlatforms } from '../utils/listingStatus';

const PREFIX = { kleinanzeigen: 'ka', vinted: 'vinted' };
const MONTHS = 6;

const parseUtc = (v) => (v ? Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : `${v}Z`) : NaN);
const euro = (v) => `${Math.round(v).toLocaleString('de-DE')} €`;

// One sale per draft sold on a platform: when it was marked/detected as sold
// (status_at stays put once terminal) and for how much (the price read from the
// ad, else the draft's). Drafts deleted in Velosia are gone from this history.
export function salesStats(drafts, now = new Date()) {
  const sales = [];
  for (const d of drafts || []) {
    const sold = listingPlatforms(d)
      .filter((p) => p.status === 'verkauft')
      .map((p) => ({ at: parseUtc(p.at), price: d[`${PREFIX[p.key]}_online_price`] ?? d.price ?? 0 }))
      .filter((s) => !Number.isNaN(s.at))
      .sort((a, b) => a.at - b.at)[0];
    if (sold) sales.push(sold);
  }
  const months = [];
  for (let i = MONTHS - 1; i >= 0; i -= 1) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    const inMonth = sales.filter((s) => s.at >= start.getTime() && s.at < end.getTime());
    months.push({
      key: `${start.getFullYear()}-${start.getMonth()}`,
      label: start.toLocaleDateString('de-DE', { month: 'short' }).replace('.', ''),
      count: inMonth.length,
      sum: inMonth.reduce((a, s) => a + (Number(s.price) || 0), 0),
    });
  }
  return {
    months,
    current: months[months.length - 1],
    total: { count: sales.length, sum: sales.reduce((a, s) => a + (Number(s.price) || 0), 0) },
  };
}

// Settings: what Velosia sold for you — this month large, the last six months as
// quiet bars, the all-time total underneath.
export default function SalesOverview({ drafts }) {
  const { months, current, total } = salesStats(drafts);
  const max = Math.max(...months.map((m) => m.sum), 1);

  return (
    <div className="detail-section-unboxed sales-overview">
      <h3 className="detail-section-title" style={{ margin: 0 }}>
        <TrendingUp size={18} style={{ color: 'var(--primary)' }} />
        <span>Verkäufe</span>
      </h3>

      {total.count === 0 ? (
        <p className="sales-empty">Hier erscheinen deine Verkäufe.</p>
      ) : (
        <>
          <div className="sales-hero">
            <span className="sales-hero-sum">{euro(current.sum)}</span>
            <span className="sales-hero-label">
              diesen Monat · {current.count} Artikel
            </span>
          </div>

          <div className="sales-bars" role="img" aria-label={months.map((m) => `${m.label}: ${euro(m.sum)}`).join(', ')}>
            {months.map((m, i) => (
              <div key={m.key} className={`sales-bar${i === months.length - 1 ? ' current' : ''}`}>
                <div className="sales-bar-track">
                  <div className="sales-bar-fill" style={{ height: `${m.sum > 0 ? Math.max(6, (m.sum / max) * 100) : 0}%` }} />
                </div>
                <span className="sales-bar-label">{m.label}</span>
              </div>
            ))}
          </div>

          <div className="sales-total">
            <span>Insgesamt</span>
            <strong>{euro(total.sum)}</strong>
            <span className="sales-total-count">{total.count} Artikel</span>
          </div>
        </>
      )}
    </div>
  );
}
