import { useState, useEffect, useCallback } from 'react';
import client from '../api/client';

interface Account { account_id: string; account_type: string; masked_number: string; available_balance: number; }
interface FD {
  id: string; fd_account_id: string; source_account_id: string;
  principal: number; interest_rate: number; tenure_months: number;
  status: 'ACTIVE'|'MATURED'|'CLOSED';
  maturity_date: string; maturity_amount: number; interest_earned: number;
  days_remaining: number; progress_pct: number;
  premature_closed_at: string|null; penalty_amount: number|null; actual_payout: number|null;
  created_at: string; fd_account_number: string;
}
interface RateSlab { months: number; label: string; rate: number; preview: { maturityAmount: number; interestEarned: number }; }

const TENURE_OPTS = [
  { months: 3,  label: '3 months' },
  { months: 6,  label: '6 months' },
  { months: 12, label: '1 year'   },
  { months: 24, label: '2 years'  },
  { months: 36, label: '3 years'  },
  { months: 60, label: '5 years'  },
];

function fmt(n: number) { return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

function StatusBadge({ status }: { status: FD['status'] }) {
  const m = { ACTIVE:{ cls:'badge-verified', icon:'lock' }, MATURED:{ cls:'badge-pending', icon:'check_circle' }, CLOSED:{ cls:'badge-debit', icon:'cancel' } }[status];
  return <span className={`badge ${m.cls}`} style={{ display:'inline-flex', alignItems:'center', gap:4 }}><span className="ms" style={{ fontSize:12 }}>{m.icon}</span>{status}</span>;
}

function ProgressBar({ pct }: { pct: number }) {
  return (
    <div style={{ height:4, borderRadius:2, background:'var(--outline-var)', overflow:'hidden', marginTop:8 }}>
      <div style={{ height:'100%', width:`${pct}%`, background:'var(--primary)', borderRadius:2, transition:'width 0.6s ease' }} />
    </div>
  );
}

export default function FixedDepositPage() {
  const [fds, setFDs] = useState<FD[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [rates, setRates] = useState<RateSlab[]>([]);
  const [loading, setLoading] = useState(true);
  const [showOpen, setShowOpen] = useState(false);

  // Form
  const [srcAccount, setSrcAccount] = useState('');
  const [amount, setAmount] = useState('');
  const [tenure, setTenure] = useState(12);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string|null>(null);
  const [openSuccess, setOpenSuccess] = useState<string|null>(null);

  // Premature close
  const [closingId, setClosingId] = useState<string|null>(null);
  const [confirmClose, setConfirmClose] = useState<FD|null>(null);
  const [closeResult, setCloseResult] = useState<{ payout: number; penalty: number }|null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [fdRes, acctRes, rateRes] = await Promise.all([
        client.get<{ data: FD[] }>('/fd'),
        client.get<{ data: Account[] }|Account[]>('/accounts'),
        client.get<{ data: RateSlab[] }>('/fd/rates'),
      ]);
      setFDs(fdRes.data.data ?? []);
      const accts = Array.isArray(acctRes.data) ? acctRes.data : (acctRes.data as { data: Account[] }).data ?? [];
      setAccounts(accts.filter(a => a.account_type !== 'FD'));
      setRates(rateRes.data.data ?? []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const selectedRate = rates.find(r => r.months === tenure);
  // Compute live preview proportionally from the ₹1L base rate slab
  const amtNum = parseFloat(amount) || 0;
  const livePreview = selectedRate && amtNum >= 1000 ? {
    maturityAmount: amtNum * (selectedRate.preview.maturityAmount / 100000),
    interestEarned: amtNum * (selectedRate.preview.interestEarned / 100000),
  } : null;

  async function handleOpen(e: React.FormEvent) {
    e.preventDefault();
    setOpenError(null); setOpening(true);
    try {
      await client.post('/fd', { source_account_id: srcAccount, principal: parseFloat(amount), tenure_months: tenure });
      setOpenSuccess(`FD of ₹${fmt(parseFloat(amount))} opened successfully.`);
      setAmount(''); setSrcAccount(''); setTenure(12); setShowOpen(false);
      void load();
      setTimeout(() => setOpenSuccess(null), 5000);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } }).response?.data?.message;
      setOpenError(msg ?? 'Failed to open FD. Please try again.');
    } finally { setOpening(false); }
  }

  async function handleClose(fd: FD) {
    setClosingId(fd.id);
    try {
      const res = await client.delete<{ payout: number; penalty: number }>(`/fd/${fd.id}`);
      setCloseResult(res.data);
      setConfirmClose(null);
      void load();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } }).response?.data?.message;
      setOpenError(msg ?? 'Failed to close FD.');
    } finally { setClosingId(null); }
  }

  const activeFDs = fds.filter(f => f.status === 'ACTIVE');
  const totalPrincipal = activeFDs.reduce((s, f) => s + f.principal, 0);
  const totalMaturity  = activeFDs.reduce((s, f) => s + f.maturity_amount, 0);
  const nextMaturity   = activeFDs.slice().sort((a, b) => new Date(a.maturity_date).getTime() - new Date(b.maturity_date).getTime())[0];

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Fixed Deposits</div>
          <div className="page-subtitle">{!loading && `${activeFDs.length} active FD${activeFDs.length !== 1 ? 's' : ''} · Quarterly compounding`}</div>
        </div>
        <button className="btn-primary" style={{ width:'auto', padding:'11px 22px' }} onClick={() => { setShowOpen(v => !v); setOpenError(null); }}>
          <span className="ms" style={{ fontSize:18 }}>{showOpen ? 'close' : 'add'}</span>
          {showOpen ? 'Cancel' : 'Open New FD'}
        </button>
      </div>

      <div className="page-body">

        {/* Flash */}
        {openSuccess && <div className="alert alert-success" style={{ marginBottom:20 }} role="alert"><span className="ms" style={{ fontSize:18, flexShrink:0 }}>check_circle</span>{openSuccess}</div>}
        {openError  && <div className="alert alert-error"   style={{ marginBottom:20 }} role="alert"><span className="ms" style={{ fontSize:18, flexShrink:0 }}>error</span>{openError}<button onClick={() => setOpenError(null)} style={{ marginLeft:'auto', background:'none', border:'none', cursor:'pointer', color:'inherit' }}><span className="ms" style={{ fontSize:16 }}>close</span></button></div>}
        {closeResult && <div className="alert alert-success" style={{ marginBottom:20 }} role="alert"><span className="ms" style={{ fontSize:18, flexShrink:0 }}>check_circle</span>FD closed. Payout of ₹{fmt(closeResult.payout)} credited to your account (penalty: ₹{fmt(closeResult.penalty)}).<button onClick={() => setCloseResult(null)} style={{ marginLeft:'auto', background:'none', border:'none', cursor:'pointer', color:'inherit' }}><span className="ms" style={{ fontSize:16 }}>close</span></button></div>}

        {/* Stats */}
        {!loading && activeFDs.length > 0 && (
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:16, marginBottom:24 }}>
            {[
              { label:'Total Principal', value:`₹${fmt(totalPrincipal)}`, icon:'savings' },
              { label:'Total at Maturity', value:`₹${fmt(totalMaturity)}`, icon:'trending_up' },
              { label:'Next Maturity', value: nextMaturity ? `${nextMaturity.days_remaining}d` : '—', icon:'event' },
            ].map(s => (
              <div key={s.label} className="sand-card" style={{ padding:'18px 22px' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:8 }}>
                  <span style={{ fontSize:'0.68rem', fontWeight:600, color:'var(--outline)', letterSpacing:'0.07em', textTransform:'uppercase' }}>{s.label}</span>
                  <span className="ms filled" style={{ fontSize:20, color:'var(--primary)' }}>{s.icon}</span>
                </div>
                <div style={{ fontFamily:'Outfit', fontSize:'1.6rem', fontWeight:600, color:'var(--primary)', letterSpacing:'-0.02em' }}>{s.value}</div>
              </div>
            ))}
          </div>
        )}

        {/* Open FD form */}
        {showOpen && (
          <div className="sand-card" style={{ padding:'28px', marginBottom:24 }}>
            <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:22 }}>
              <span className="ms filled" style={{ fontSize:22, color:'var(--primary)' }}>add_circle</span>
              <h2 style={{ fontSize:'1.05rem' }}>Open Fixed Deposit</h2>
            </div>
            <form onSubmit={e => void handleOpen(e)}>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'20px 24px' }}>
                <div className="form-field">
                  <label className="sb-label" htmlFor="fd-src">Source Account</label>
                  <select id="fd-src" className="sb-select" value={srcAccount} onChange={e => setSrcAccount(e.target.value)} required>
                    <option value="">Select account…</option>
                    {accounts.map(a => (
                      <option key={a.account_id} value={a.account_id}>
                        {a.account_type} · {a.masked_number} · ₹{fmt(a.available_balance)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-field">
                  <label className="sb-label" htmlFor="fd-amt">Amount (min ₹1,000)</label>
                  <input id="fd-amt" className="sb-input-filled" type="number" min={1000} step={100}
                    value={amount} onChange={e => setAmount(e.target.value)} placeholder="e.g. 50000" required />
                </div>
              </div>

              {/* Tenure pills */}
              <div style={{ marginTop:20 }}>
                <div className="sb-label" style={{ marginBottom:10 }}>Tenure</div>
                <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                  {TENURE_OPTS.map(opt => {
                    const slab = rates.find(r => r.months === opt.months);
                    return (
                      <button key={opt.months} type="button"
                        onClick={() => setTenure(opt.months)}
                        style={{
                          padding:'10px 18px', borderRadius:8, cursor:'pointer', textAlign:'center',
                          border:`1.5px solid ${tenure === opt.months ? 'var(--primary-container)' : 'var(--sand-border)'}`,
                          background: tenure === opt.months ? 'rgba(34,64,154,0.08)' : 'var(--surface)',
                          color: tenure === opt.months ? 'var(--primary)' : 'var(--on-surface-var)',
                          transition:'all var(--transition)',
                        }}>
                        <div style={{ fontWeight:600, fontSize:'0.875rem' }}>{opt.label}</div>
                        {slab && <div style={{ fontSize:'0.72rem', color: tenure === opt.months ? 'var(--primary)' : 'var(--outline)', marginTop:2 }}>{slab.rate}% p.a.</div>}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Live preview */}
              {livePreview && (
                <div style={{ marginTop:20, padding:'16px 20px', background:'rgba(34,64,154,0.06)', borderRadius:10, display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12 }}>
                  <div>
                    <div className="sb-label" style={{ marginBottom:4 }}>Interest Rate</div>
                    <div style={{ fontFamily:'Outfit', fontSize:'1.4rem', fontWeight:600, color:'var(--primary)' }}>{selectedRate?.rate ?? '—'}%</div>
                    <div style={{ fontSize:'0.72rem', color:'var(--outline)' }}>per annum</div>
                  </div>
                  <div>
                    <div className="sb-label" style={{ marginBottom:4 }}>Interest Earned</div>
                    <div style={{ fontFamily:'Outfit', fontSize:'1.4rem', fontWeight:600, color:'var(--color-success)' }}>₹{fmt(livePreview.interestEarned)}</div>
                    <div style={{ fontSize:'0.72rem', color:'var(--outline)' }}>quarterly compounding</div>
                  </div>
                  <div>
                    <div className="sb-label" style={{ marginBottom:4 }}>Maturity Amount</div>
                    <div style={{ fontFamily:'Outfit', fontSize:'1.4rem', fontWeight:600, color:'var(--primary)' }}>₹{fmt(livePreview.maturityAmount)}</div>
                    <div style={{ fontSize:'0.72rem', color:'var(--outline)' }}>on {TENURE_OPTS.find(o => o.months === tenure)?.label}</div>
                  </div>
                </div>
              )}

              <div style={{ display:'flex', gap:12, marginTop:22 }}>
                <button type="submit" className="btn-primary" disabled={opening} style={{ width:'auto', padding:'11px 28px' }}>
                  {opening ? <><div className="spinner" />&nbsp;Opening…</> : <><span className="ms" style={{ fontSize:18 }}>lock</span>Open FD</>}
                </button>
                <button type="button" className="btn-ghost" onClick={() => { setShowOpen(false); setOpenError(null); }}>Cancel</button>
              </div>
            </form>
          </div>
        )}

        {/* Confirm premature close dialog */}
        {confirmClose && (
          <div style={{ position:'fixed', inset:0, zIndex:300, background:'rgba(22,29,46,0.5)', display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
            <div className="sand-card" style={{ width:'100%', maxWidth:440, padding:'28px' }}>
              <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:16 }}>
                <span className="ms filled" style={{ fontSize:24, color:'var(--color-warning)' }}>warning</span>
                <h2 style={{ fontSize:'1.05rem' }}>Premature Closure</h2>
              </div>
              <p style={{ fontSize:'0.875rem', color:'var(--on-surface-var)', lineHeight:1.6, marginBottom:16 }}>
                Closing <strong>₹{fmt(confirmClose.principal)}</strong> FD before maturity incurs a 1% interest rate penalty. You will receive a payout based on the months held at the reduced rate.
              </p>
              <div style={{ padding:'12px 16px', background:'rgba(186,26,26,0.06)', borderRadius:8, fontSize:'0.82rem', color:'var(--color-danger)', marginBottom:20 }}>
                Maturity amount forfeited: ₹{fmt(confirmClose.maturity_amount - confirmClose.principal)} (estimated interest)
              </div>
              <div style={{ display:'flex', gap:12 }}>
                <button className="btn-danger" disabled={closingId === confirmClose.id}
                  onClick={() => void handleClose(confirmClose)} style={{ flex:1 }}>
                  {closingId === confirmClose.id ? <><div className="spinner" style={{ borderTopColor:'var(--color-danger)', borderColor:'rgba(186,26,26,0.2)' }} />&nbsp;Closing…</> : 'Confirm Close'}
                </button>
                <button className="btn-ghost" style={{ flex:1 }} onClick={() => setConfirmClose(null)}>Cancel</button>
              </div>
            </div>
          </div>
        )}

        {/* FD list */}
        {loading ? (
          <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
            {[1,2].map(i => <div key={i} className="sand-card" style={{ padding:24 }}><div className="skeleton" style={{ height:14, width:'40%', marginBottom:12 }} /><div className="skeleton" style={{ height:32, width:'60%', marginBottom:8 }} /><div className="skeleton" style={{ height:4 }} /></div>)}
          </div>
        ) : fds.length === 0 ? (
          <div className="sand-card" style={{ padding:'56px', textAlign:'center' }}>
            <span className="ms" style={{ fontSize:52, color:'var(--outline-var)', display:'block', marginBottom:14 }}>lock</span>
            <p style={{ fontFamily:'Outfit', fontSize:'1.05rem', color:'var(--primary)', marginBottom:6 }}>No Fixed Deposits yet</p>
            <p style={{ fontSize:'0.875rem', color:'var(--on-surface-var)' }}>Open an FD to earn guaranteed returns with quarterly compounding.</p>
          </div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
            {fds.map(fd => (
              <div key={fd.id} className="sand-card" style={{ overflow:'hidden' }}>
                <div style={{ padding:'20px 24px', display:'grid', gridTemplateColumns:'1fr auto', gap:16, alignItems:'start' }}>
                  <div>
                    <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:4 }}>
                      <span className="ms filled" style={{ fontSize:20, color:'var(--primary)' }}>lock</span>
                      <span style={{ fontFamily:'Outfit', fontSize:'1rem', fontWeight:600, color:'var(--primary)' }}>{fd.fd_account_number}</span>
                      <StatusBadge status={fd.status} />
                    </div>
                    <div style={{ fontFamily:'Outfit', fontSize:'1.8rem', fontWeight:600, color:'var(--primary)', letterSpacing:'-0.02em', marginBottom:2 }}>
                      ₹{fmt(fd.principal)}
                    </div>
                    <div style={{ fontSize:'0.82rem', color:'var(--on-surface-var)' }}>
                      {fd.interest_rate}% p.a. · {fd.tenure_months >= 12 ? `${fd.tenure_months/12}yr` : `${fd.tenure_months}m`} · Quarterly
                    </div>
                  </div>
                  <div style={{ textAlign:'right' }}>
                    <div style={{ fontSize:'0.68rem', color:'var(--outline)', letterSpacing:'0.06em', textTransform:'uppercase', marginBottom:4 }}>Maturity Amount</div>
                    <div style={{ fontFamily:'Outfit', fontSize:'1.4rem', fontWeight:600, color:'var(--color-success)' }}>₹{fmt(fd.maturity_amount)}</div>
                    <div style={{ fontSize:'0.78rem', color:'var(--outline)', marginTop:2 }}>+₹{fmt(fd.interest_earned)} interest</div>
                  </div>
                </div>

                <div style={{ padding:'0 24px 16px', borderTop:'1px solid var(--outline-var)', paddingTop:14 }}>
                  <div style={{ display:'flex', justifyContent:'space-between', fontSize:'0.78rem', color:'var(--on-surface-var)', marginBottom:4 }}>
                    <span>Opened {new Date(fd.created_at).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'2-digit' })}</span>
                    <span>
                      {fd.status === 'ACTIVE'
                        ? `${fd.days_remaining} days remaining · Matures ${new Date(fd.maturity_date).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' })}`
                        : fd.premature_closed_at ? `Closed ${new Date(fd.premature_closed_at).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'2-digit' })} · Payout ₹${fmt(fd.actual_payout ?? 0)}`
                        : `Matured ${new Date(fd.maturity_date).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'2-digit' })}`}
                    </span>
                  </div>
                  <ProgressBar pct={fd.progress_pct} />
                </div>

                {fd.status === 'ACTIVE' && (
                  <div style={{ padding:'10px 24px 16px', display:'flex', justifyContent:'flex-end' }}>
                    <button className="btn-danger" style={{ padding:'6px 16px', fontSize:'0.78rem' }}
                      onClick={() => setConfirmClose(fd)}>
                      <span className="ms" style={{ fontSize:16 }}>lock_open</span>
                      Close Prematurely
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
