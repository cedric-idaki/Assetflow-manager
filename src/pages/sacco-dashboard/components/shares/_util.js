/**
 * Shared vocabulary for the share market — admin dashboard and member portal.
 *
 * The engine is the source of truth for anything that moves a share; these
 * helpers only *read* what it produced, so a number shown here and a number in
 * the ledger can never drift apart.
 */
import { KES } from '../_shared';

export const today = () => new Date().toISOString().slice(0, 10);

export const num = (v) => parseFloat(v) || 0;
export const int = (v) => parseInt(v, 10) || 0;

export const pct = (n, digits = 2) =>
  `${(Math.round(n * 10 ** digits) / 10 ** digits).toLocaleString()}%`;

// Compact money for stat cards: 13.5M reads better than 13,500,000.
export const KESshort = (n) => {
  const v = num(n);
  const a = Math.abs(v);
  if (a >= 1e9) return `KES ${(v / 1e9).toFixed(2).replace(/\.00$/, '')}B`;
  if (a >= 1e6) return `KES ${(v / 1e6).toFixed(2).replace(/\.00$/, '')}M`;
  if (a >= 1e5) return `KES ${(v / 1e3).toFixed(1).replace(/\.0$/, '')}K`;
  return KES(v);
};

export const gainTone = (n) => (n > 0 ? 'text-emerald-600' : n < 0 ? 'text-red-600' : 'text-muted-foreground');
export const gainSign = (n) => (n > 0 ? '+' : '');

export const TXN_LABELS = {
  issue: 'Shares issued', purchase: 'Bought', sale: 'Sold',
  transfer_in: 'Received', transfer_out: 'Transferred out',
  allotment: 'Allotted', buyback: 'Bought back', retire: 'Retired',
  adjustment: 'Adjustment', dividend: 'Dividend', reversal: 'Reversal',
};

export const DIVIDEND_STATUS_HINT = {
  draft: 'Not yet declared',
  declared: 'Declared — run the calculation to allocate it',
  calculated: 'Allocated to members — ready to pay',
  paid: 'Paid out',
  cancelled: 'Cancelled',
};

// Defaults mirror the migration, so the tab still renders sensibly on a sacco
// whose settings row has not been created yet.
export const SETTINGS_DEFAULTS = {
  par_value: 100, min_holding: 0, max_holding_shares: 0, max_holding_percent: 0,
  trading_fee_percent: 0, commission_percent: 0,
  dividend_formula: 'pro_rata', dividend_tax_percent: 0, votes_per_share: 0,
  allow_member_transfers: true, require_transfer_approval: false, auto_settle: true,
  allow_partial_fills: true, price_floor_is_par: true, lock_in_days: 0,
  market_open_time: '00:00', market_close_time: '00:00',
  market_days: [0, 1, 2, 3, 4, 5, 6], trading_suspended: false,
  require_kyc_to_trade: true, large_trade_threshold: 0, certificate_prefix: 'CERT',
};

export const withDefaults = (s) => ({ ...SETTINGS_DEFAULTS, ...(s || {}) });

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Is the market taking orders right now? Mirrors sacco_share_market_open(). */
export const marketIsOpen = (settings) => {
  const s = withDefaults(settings);
  if (s.trading_suspended) return false;
  // Kenyan local time, matching the engine's Africa/Nairobi clock.
  const now = new Date(Date.now() + (new Date().getTimezoneOffset() + 180) * 60000);
  if (!(s.market_days || []).includes(now.getDay())) return false;
  const open = String(s.market_open_time || '00:00').slice(0, 5);
  const close = String(s.market_close_time || '00:00').slice(0, 5);
  if (open === close) return true;
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return open < close ? (hhmm >= open && hhmm < close) : (hhmm >= open || hhmm < close);
};

/** Shares still available on an order. */
export const remaining = (l) => Math.max(0, int(l?.shares) - int(l?.filled_shares));

export const isLive = (l) => ['open', 'pending_approval'].includes(l?.status);

/**
 * The CEO's ten-second read of the market. Everything on the Shares overview
 * comes from here so the cards, the reports and the charts agree.
 */
export const marketOverview = ({
  shares = [], treasury, sharePrices = [], listings = [], transfers = [],
  dividends = [], dividendAllocations = [],
}) => {
  const memberOwned = shares.reduce((s, r) => s + int(r.shares_held), 0);
  const treasuryPool = int(treasury?.treasury_shares);
  const totalIssued = memberOwned + treasuryPool;
  const price = num(sharePrices[0]?.market_value);
  const par = num(treasury?.par_value);
  const effective = price || par;

  const settled = transfers.filter((t) => t.status === 'settled');
  const day = today();
  const todaysTrades = settled.filter((t) => String(t.settled_at || t.created_at || '').slice(0, 10) === day);

  // Only the latest non-cancelled declaration describes the current policy.
  const liveDividend = dividends.find((d) => d.status !== 'cancelled') || null;
  const payable = dividendAllocations
    .filter((a) => a.status === 'pending')
    .reduce((s, a) => s + num(a.net_amount), 0);

  const prev = num(sharePrices[1]?.market_value);
  return {
    memberOwned, treasuryPool, totalIssued,
    price, par, effective,
    marketCap: totalIssued * effective,
    priceDelta: price - prev,
    hasPrevPrice: sharePrices.length > 1,
    openOrders: listings.filter((l) => l.status === 'open'),
    buyOrders: listings.filter((l) => l.side === 'buy' && l.status === 'open'),
    sellOrders: listings.filter((l) => (l.side || 'sell') === 'sell' && l.status === 'open'),
    settled,
    todaysTrades,
    todaysVolume: todaysTrades.reduce((s, t) => s + int(t.shares), 0),
    todaysValue: todaysTrades.reduce((s, t) => s + num(t.price), 0),
    pendingTransfers: transfers.filter((t) => t.status === 'pending'),
    tradedVolume: settled.reduce((s, t) => s + int(t.shares), 0),
    tradedValue: settled.reduce((s, t) => s + num(t.price), 0),
    liveDividend,
    dividendRate: liveDividend ? num(liveDividend.dividend_percent) : 0,
    dividendPayable: payable,
    shareholders: shares.filter((r) => int(r.shares_held) > 0).length,
  };
};

/** One member's full position, valued at the current market price. */
export const memberPosition = (holding, effectivePrice, totalIssued) => {
  const held = int(holding?.shares_held);
  const invested = num(holding?.total_invested);
  const value = held * effectivePrice;
  return {
    held,
    locked: int(holding?.locked_shares),
    free: Math.max(0, held - int(holding?.locked_shares)),
    avg: num(holding?.avg_buy_price),
    invested,
    value,
    unrealized: value - invested,
    unrealizedPct: invested > 0 ? ((value - invested) / invested) * 100 : 0,
    realized: num(holding?.realized_gain),
    dividends: num(holding?.dividends_earned),
    ownership: totalIssued > 0 ? (held / totalIssued) * 100 : 0,
    frozen: !!holding?.is_frozen,
  };
};

/**
 * A printable share certificate. Opened in its own window and sent straight to
 * the browser's print dialog — the same approach as the sacco invoice, which
 * keeps certificates dependency-free and lets the member "print to PDF".
 */
export const certificateHtml = (cert, { saccoName, memberName, memberNo, marketValue }) => {
  const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const shares = int(cert.shares);
  const issued = cert.issue_date ? new Date(cert.issue_date) : new Date(cert.created_at);
  const value = shares * (num(marketValue) || num(cert.par_value));

  return `<!doctype html><html><head><meta charset="utf-8">
<title>Share Certificate ${esc(cert.certificate_no)}</title>
<style>
  @page { size: A4 landscape; margin: 0; }
  *{box-sizing:border-box;}
  body{margin:0;font-family:Georgia,'Times New Roman',serif;color:#0f2733;background:#fff;}
  .sheet{width:297mm;height:210mm;padding:14mm;position:relative;}
  .frame{height:100%;border:3px double #1da8c5;border-radius:6px;padding:12mm 14mm;position:relative;overflow:hidden;}
  .frame:before{content:'';position:absolute;inset:6px;border:1px solid #bfe6ef;border-radius:4px;pointer-events:none;}
  .wm{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-24deg);
      font-size:120px;font-weight:800;color:rgba(29,168,197,.05);letter-spacing:8px;white-space:nowrap;}
  .top{display:flex;justify-content:space-between;align-items:flex-start;}
  .sacco{font-size:26px;font-weight:800;letter-spacing:.5px;}
  .sub{font-size:11px;text-transform:uppercase;letter-spacing:3px;color:#5c7c88;margin-top:4px;}
  .certno{text-align:right;font-size:12px;color:#5c7c88;}
  .certno b{display:block;font-size:18px;color:#0f2733;letter-spacing:1px;}
  h1{text-align:center;font-size:30px;letter-spacing:6px;margin:26px 0 4px;text-transform:uppercase;}
  .rule{width:120px;height:2px;background:#1da8c5;margin:0 auto 26px;}
  .body{text-align:center;font-size:15px;line-height:2.1;}
  .name{font-size:26px;font-weight:700;border-bottom:1px solid #cfe0e6;display:inline-block;padding:0 24px 4px;margin:0 6px;}
  .qty{font-size:22px;font-weight:700;color:#1da8c5;}
  .meta{display:flex;justify-content:space-between;margin-top:34px;font-size:12px;}
  .meta div{text-align:center;flex:1;}
  .meta .k{color:#5c7c88;text-transform:uppercase;letter-spacing:1.5px;font-size:9px;}
  .meta .v{font-size:14px;font-weight:700;margin-top:3px;}
  .sigs{display:flex;justify-content:space-between;margin-top:auto;padding-top:30px;}
  .sig{width:34%;text-align:center;}
  .sig .line{border-top:1px solid #0f2733;margin-bottom:5px;}
  .sig .role{font-size:10px;text-transform:uppercase;letter-spacing:2px;color:#5c7c88;}
  .foot{position:absolute;bottom:8mm;left:14mm;right:14mm;text-align:center;font-size:9px;color:#8aa3ac;font-family:Arial,sans-serif;}
  .void{position:absolute;top:40mm;left:0;right:0;text-align:center;font-size:64px;font-weight:800;
        color:rgba(220,38,38,.18);letter-spacing:14px;transform:rotate(-8deg);}
</style></head><body>
  <div class="sheet"><div class="frame">
    <div class="wm">${esc(saccoName || 'SACCO')}</div>
    ${cert.status !== 'active' ? `<div class="void">${esc(cert.status).toUpperCase()}</div>` : ''}
    <div class="top">
      <div>
        <div class="sacco">${esc(saccoName || 'Sacco Society')}</div>
        <div class="sub">Share Certificate</div>
      </div>
      <div class="certno">Certificate No.<b>${esc(cert.certificate_no)}</b></div>
    </div>

    <h1>Certificate of Shares</h1>
    <div class="rule"></div>

    <div class="body">
      This is to certify that<br>
      <span class="name">${esc(memberName || '—')}</span><br>
      ${memberNo ? `member no. <strong>${esc(memberNo)}</strong><br>` : ''}
      is the registered holder of<br>
      <span class="qty">${shares.toLocaleString()} ordinary share${shares === 1 ? '' : 's'}</span><br>
      of ${esc(KES(cert.par_value))} each, fully paid, in the above-named society,
      subject to its by-laws.
    </div>

    <div class="meta">
      <div><div class="k">Shares held</div><div class="v">${shares.toLocaleString()}</div></div>
      <div><div class="k">Par value</div><div class="v">${esc(KES(cert.par_value))}</div></div>
      <div><div class="k">Value at issue</div><div class="v">${esc(KES(value))}</div></div>
      <div><div class="k">Date of issue</div><div class="v">${issued.toLocaleDateString('en-KE', { year: 'numeric', month: 'long', day: 'numeric' })}</div></div>
    </div>

    <div class="sigs">
      <div class="sig"><div class="line"></div><div class="role">Chairperson</div></div>
      <div class="sig"><div class="line"></div><div class="role">Treasurer</div></div>
      <div class="sig"><div class="line"></div><div class="role">Secretary</div></div>
    </div>

    <div class="foot">
      Generated ${new Date().toLocaleString('en-KE')} · Reference ${esc(String(cert.id || '').slice(0, 8))}
      · This certificate is superseded automatically whenever the holding changes.
    </div>
  </div></div>
  <script>window.onload=function(){window.print();}</script>
</body></html>`;
};

/** Open a certificate in a print window. Returns false if the pop-up was blocked. */
export const printCertificate = (cert, meta) => {
  const w = window.open('', '_blank', 'width=1100,height=800');
  if (!w) return false;
  w.document.write(certificateHtml(cert, meta));
  w.document.close();
  return true;
};
