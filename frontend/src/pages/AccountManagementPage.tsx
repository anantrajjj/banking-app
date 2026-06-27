import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import client from '../api/client';

interface Account {
  account_id: string; account_type: 'SAVINGS'|'CURRENT'|'FD';
  masked_number: string; available_balance: number; currency: string;
}
interface CardSummary {
  id: string; account_id: string; last_four: string; expiry: string;
  cardholder_name: string; network: 'VISA'|'MASTERCARD'|'RUPAY';
  status: 'ACTIVE'|'BLOCKED'|'EXPIRED';
  is_domestic_enabled: boolean; is_international_enabled: boolean;
  is_atm_enabled: boolean; is_online_enabled: boolean;
  daily_atm_limit: number; daily_pos_limit: number;
  per_transaction_limit: number; monthly_limit: number;
}
interface CardReveal { number: string; cvv: string; expiry: string; }

// ─── Debit card visual ────────────────────────────────────────────────────────

function DebitCard({ card, onReveal, revealed, countdown }: {
  card: CardSummary;
  onReveal: () => void;
  revealed: CardReveal | null;
  countdown: number;
}) {
  const networkColor = card.network === 'VISA' ? '#1a1f71' : card.network === 'MASTERCARD' ? '#eb001b' : '#2b7bb9';
  const masked = `•••• •••• •••• ${card.last_four}`;

  return (
    <div style={{ perspective: 800 }}>
      <div style={{
        width: '100%', maxWidth: 360, aspectRatio: '1.586',
        borderRadius: 16, overflow: 'hidden', position: 'relative',
        background: 'linear-gradient(135deg, #1A3E8C 0%, #0A6EBD 60%, #22409A 100%)',
        boxShadow: '0 12px 40px rgba(26,62,140,0.35)',
        color: '#fff', fontFamily: "'Inter', sans-serif",
        userSelect: 'none',
      }}>
        {/* Decorative circles */}
        <div style={{ position:'absolute', top:-40, right:-40, width:200, height:200, borderRadius:'50%', background:'rgba(255,255,255,0.07)' }} />
        <div style={{ position:'absolute', bottom:-60, left:-20, width:240, height:240, borderRadius:'50%', background:'rgba(255,255,255,0.05)' }} />

        <div style={{ position:'relative', height:'100%', padding:'20px 24px', display:'flex', flexDirection:'column', justifyContent:'space-between' }}>

          {/* Top row */}
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
            <div>
              <div style={{ fontSize:'0.68rem', fontWeight:700, letterSpacing:'0.1em', textTransform:'uppercase', opacity:0.75 }}>Aura Private</div>
              <div style={{ fontSize:'0.6rem', opacity:0.5, marginTop:1 }}>SecureBank</div>
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:4 }}>
              {card.status !== 'ACTIVE' && (
                <span style={{ fontSize:'0.6rem', background:'rgba(186,26,26,0.8)', padding:'2px 7px', borderRadius:4, fontWeight:700, letterSpacing:'0.05em' }}>{card.status}</span>
              )}
              {/* Chip */}
              <div style={{ width:36, height:28, borderRadius:5, background:'linear-gradient(135deg, #d4a843, #f0c960, #b8882c)', border:'1px solid rgba(255,255,255,0.3)', display:'flex', flexDirection:'column', justifyContent:'space-around', padding:'4px 2px', gap:2 }}>
                {[1,2,3].map(i => <div key={i} style={{ height:2, background:'rgba(160,100,10,0.6)', borderRadius:1, margin:'0 3px' }} />)}
              </div>
            </div>
          </div>

          {/* Card number */}
          <div>
            <div style={{ fontFamily:"'Courier New', monospace", fontSize:'1.05rem', fontWeight:700, letterSpacing:'0.22em', display:'flex', alignItems:'center', gap:10 }}>
              <span>{revealed ? revealed.number : masked}</span>
              <button onClick={onReveal} disabled={!!revealed && countdown > 0}
                style={{ background:'none', border:'none', cursor:'pointer', color:'rgba(255,255,255,0.7)', padding:4, display:'flex', alignItems:'center', transition:'color 0.15s' }}
                title={revealed ? `Auto-hides in ${countdown}s` : 'Reveal card number'}>
                <span className="ms" style={{ fontSize:20 }}>{revealed ? 'visibility_off' : 'visibility'}</span>
              </button>
            </div>
            {revealed && (
              <div style={{ marginTop:4, fontSize:'0.7rem', opacity:0.65, fontFamily:'monospace' }}>
                CVV: {revealed.cvv} · Auto-hides in {countdown}s
              </div>
            )}
          </div>

          {/* Bottom row */}
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-end' }}>
            <div>
              <div style={{ fontSize:'0.55rem', opacity:0.6, letterSpacing:'0.06em', textTransform:'uppercase', marginBottom:2 }}>Card Holder</div>
              <div style={{ fontSize:'0.82rem', fontWeight:600, letterSpacing:'0.06em' }}>{card.cardholder_name}</div>
            </div>
            <div style={{ textAlign:'right' }}>
              <div style={{ fontSize:'0.55rem', opacity:0.6, letterSpacing:'0.06em', textTransform:'uppercase', marginBottom:2 }}>Expires</div>
              <div style={{ fontSize:'0.82rem', fontWeight:600, letterSpacing:'0.08em' }}>{revealed ? revealed.expiry : card.expiry}</div>
            </div>
          </div>

          {/* Network watermark */}
          <div style={{ position:'absolute', bottom:16, right:22, fontSize:'0.9rem', fontWeight:900, fontStyle:'italic', letterSpacing:'-0.02em', color:'rgba(255,255,255,0.55)' }}>
            {card.network}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Toggle row ───────────────────────────────────────────────────────────────

function ToggleRow({ label, desc, checked, onChange, disabled }: {
  label: string; desc: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'12px 0', borderBottom:'1px solid var(--outline-var)' }}>
      <div>
        <div style={{ fontWeight:500, fontSize:'0.875rem', color:'var(--on-surface)' }}>{label}</div>
        <div style={{ fontSize:'0.75rem', color:'var(--outline)', marginTop:1 }}>{desc}</div>
      </div>
      <button role="switch" aria-checked={checked} disabled={disabled}
        onClick={() => onChange(!checked)}
        style={{
          width:44, height:24, borderRadius:12, cursor:'pointer', border:'none', outline:'none',
          background: checked ? 'var(--primary)' : 'var(--outline-var)',
          position:'relative', transition:'background 0.2s', flexShrink:0,
          opacity: disabled ? 0.5 : 1,
        }}>
        <div style={{
          position:'absolute', top:2, left: checked ? 22 : 2,
          width:20, height:20, borderRadius:'50%', background:'#fff',
          boxShadow:'0 1px 4px rgba(0,0,0,0.3)',
          transition:'left 0.18s cubic-bezier(0.4,0,0.2,1)',
        }} />
      </button>
    </div>
  );
}

// ─── Limit input ─────────────────────────────────────────────────────────────

function LimitInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="form-field">
      <label className="sb-label">{label}</label>
      <div style={{ position:'relative', display:'flex', alignItems:'center' }}>
        <span style={{ position:'absolute', left:12, fontSize:'0.9rem', color:'var(--outline)', fontWeight:600 }}>₹</span>
        <input className="sb-input-filled" type="number" min={0} step={1000}
          value={value}
          onChange={e => onChange(parseFloat(e.target.value) || 0)}
          style={{ paddingLeft:26 }} />
      </div>
    </div>
  );
}

// ─── Card settings panel ──────────────────────────────────────────────────────

function CardSettingsPanel({ card, onSave }: { card: CardSummary; onSave: (updated: CardSummary) => void }) {
  const [settings, setSettings] = useState({ ...card });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string|null>(null);

  async function handleSave() {
    setSaving(true); setErr(null); setSaved(false);
    try {
      const res = await client.patch<CardSummary>(`/cards/${card.id}/settings`, {
        is_domestic_enabled:      settings.is_domestic_enabled,
        is_international_enabled: settings.is_international_enabled,
        is_atm_enabled:           settings.is_atm_enabled,
        is_online_enabled:        settings.is_online_enabled,
        daily_atm_limit:          settings.daily_atm_limit,
        daily_pos_limit:          settings.daily_pos_limit,
        per_transaction_limit:    settings.per_transaction_limit,
        monthly_limit:            settings.monthly_limit,
      });
      onSave(res.data);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e: unknown) {
      setErr((e as { response?: { data?: { message?: string } } }).response?.data?.message ?? 'Failed to save settings.');
    } finally { setSaving(false); }
  }

  return (
    <div style={{ padding:'20px 24px', borderTop:'1px solid var(--outline-var)' }}>
      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:18 }}>
        <span className="ms filled" style={{ fontSize:20, color:'var(--primary)' }}>tune</span>
        <h3 style={{ fontFamily:'Outfit', fontWeight:600, fontSize:'0.95rem', color:'var(--primary)' }}>Card Controls & Limits</h3>
        {saved && <span style={{ display:'inline-flex', alignItems:'center', gap:4, fontSize:'0.78rem', color:'var(--color-success)', marginLeft:'auto' }}><span className="ms" style={{ fontSize:16 }}>check_circle</span>Saved</span>}
      </div>

      {err && <div className="alert alert-error" style={{ marginBottom:14 }}><span className="ms" style={{ fontSize:16, flexShrink:0 }}>error</span>{err}</div>}

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0 40px' }}>
        {/* Toggles */}
        <div>
          <div style={{ fontSize:'0.68rem', fontWeight:600, color:'var(--outline)', letterSpacing:'0.07em', textTransform:'uppercase', marginBottom:8 }}>Controls</div>
          <ToggleRow label="Domestic transactions"   desc="POS & online payments in India"            checked={settings.is_domestic_enabled}      onChange={v => setSettings(s => ({...s, is_domestic_enabled: v}))}      />
          <ToggleRow label="International usage"     desc="Payments & ATM withdrawals abroad"          checked={settings.is_international_enabled} onChange={v => setSettings(s => ({...s, is_international_enabled: v}))} />
          <ToggleRow label="ATM withdrawals"         desc="Cash withdrawals from ATMs"                 checked={settings.is_atm_enabled}           onChange={v => setSettings(s => ({...s, is_atm_enabled: v}))}           />
          <ToggleRow label="Online / e-commerce"    desc="Card-not-present & internet transactions"   checked={settings.is_online_enabled}        onChange={v => setSettings(s => ({...s, is_online_enabled: v}))}        />
        </div>

        {/* Limits */}
        <div>
          <div style={{ fontSize:'0.68rem', fontWeight:600, color:'var(--outline)', letterSpacing:'0.07em', textTransform:'uppercase', marginBottom:8 }}>Spending Limits</div>
          <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
            <LimitInput label="Daily ATM limit"        value={settings.daily_atm_limit}       onChange={v => setSettings(s => ({...s, daily_atm_limit: v}))}       />
            <LimitInput label="Daily POS / swipe limit" value={settings.daily_pos_limit}      onChange={v => setSettings(s => ({...s, daily_pos_limit: v}))}      />
            <LimitInput label="Per-transaction limit"   value={settings.per_transaction_limit} onChange={v => setSettings(s => ({...s, per_transaction_limit: v}))} />
            <LimitInput label="Monthly total limit"     value={settings.monthly_limit}         onChange={v => setSettings(s => ({...s, monthly_limit: v}))}         />
          </div>
        </div>
      </div>

      <div style={{ marginTop:20, display:'flex', gap:12 }}>
        <button className="btn-primary" style={{ width:'auto', padding:'10px 24px' }} disabled={saving} onClick={() => void handleSave()}>
          {saving ? <><div className="spinner" />&nbsp;Saving…</> : <><span className="ms" style={{ fontSize:18 }}>save</span>Save Settings</>}
        </button>
        <button className="btn-ghost" onClick={() => setSettings({ ...card })}>Reset</button>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AccountManagementPage() {
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [cards, setCards] = useState<Map<string, CardSummary>>(new Map());
  const [loading, setLoading] = useState(true);

  // Reveal state per card
  const [revealed, setRevealed] = useState<Map<string, CardReveal>>(new Map());
  const [countdowns, setCountdowns] = useState<Map<string, number>>(new Map());
  const [revealing, setRevealing] = useState<Set<string>>(new Set());
  const timers = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [acctRes, cardRes] = await Promise.all([
        client.get<{data:Account[]}|Account[]>('/accounts'),
        client.get<{data:CardSummary[]}>('/cards'),
      ]);
      const accts = Array.isArray(acctRes.data) ? acctRes.data : (acctRes.data as {data:Account[]}).data ?? [];
      setAccounts(accts);
      const cardMap = new Map<string, CardSummary>();
      (cardRes.data.data ?? []).forEach(c => cardMap.set(c.account_id, c));
      setCards(cardMap);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Cleanup timers on unmount
  useEffect(() => () => { timers.current.forEach(clearInterval); }, []);

  async function handleReveal(card: CardSummary) {
    if (revealed.has(card.id)) {
      // Hide immediately
      clearInterval(timers.current.get(card.id));
      timers.current.delete(card.id);
      setRevealed(m => { const n = new Map(m); n.delete(card.id); return n; });
      setCountdowns(m => { const n = new Map(m); n.delete(card.id); return n; });
      return;
    }

    setRevealing(s => new Set(s).add(card.id));
    try {
      const res = await client.get<CardReveal>(`/cards/${card.id}/reveal`);
      setRevealed(m => new Map(m).set(card.id, res.data));
      setCountdowns(m => new Map(m).set(card.id, 30));

      const interval = setInterval(() => {
        setCountdowns(m => {
          const cur = m.get(card.id) ?? 0;
          if (cur <= 1) {
            clearInterval(timers.current.get(card.id));
            timers.current.delete(card.id);
            setRevealed(rv => { const n = new Map(rv); n.delete(card.id); return n; });
            const nn = new Map(m); nn.delete(card.id); return nn;
          }
          return new Map(m).set(card.id, cur - 1);
        });
      }, 1000);
      timers.current.set(card.id, interval);
    } catch { /* silent */ }
    finally { setRevealing(s => { const n = new Set(s); n.delete(card.id); return n; }); }
  }

  const ICON: Record<string, string> = { SAVINGS:'account_balance', CURRENT:'credit_card', FD:'lock' };

  if (loading) {
    return (
      <div className="page-body" style={{ paddingTop:40 }}>
        {[1,2].map(i => (
          <div key={i} className="sand-card" style={{ padding:28, marginBottom:20 }}>
            <div className="skeleton" style={{ height:16, width:'25%', marginBottom:12 }} />
            <div className="skeleton" style={{ height:32, width:'40%', marginBottom:8 }} />
            <div className="skeleton" style={{ height:12, width:'20%' }} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Account Management</div>
          <div className="page-subtitle">{accounts.length} account{accounts.length !== 1 ? 's' : ''} · All balances in INR</div>
        </div>
      </div>

      <div className="page-body">
        {accounts.length === 0 ? (
          <div className="sand-card" style={{ padding:'48px', textAlign:'center' }}>
            <span className="ms" style={{ fontSize:48, color:'var(--outline-var)', display:'block', marginBottom:12 }}>account_balance</span>
            <p style={{ color:'var(--on-surface-var)' }}>No accounts found.</p>
          </div>
        ) : accounts.map(account => {
          const card = cards.get(account.account_id);
          const rev = card ? revealed.get(card.id) ?? null : null;
          const cd  = card ? (countdowns.get(card.id) ?? 0) : 0;
          const isRevealing = card ? revealing.has(card.id) : false;

          return (
            <div key={account.account_id} className="sand-card" style={{ marginBottom:20, overflow:'hidden' }}>
              {/* Account header */}
              <div style={{ display:'grid', gridTemplateColumns:'1fr auto', gap:20, padding:'22px 28px', borderBottom: card ? '1px solid var(--outline-var)' : 'none' }}>
                {/* Account info */}
                <div style={{ display:'flex', gap:16, alignItems:'flex-start' }}>
                  <div style={{ width:52, height:52, borderRadius:12, background:'var(--surface-highest)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                    <span className="ms filled" style={{ fontSize:26, color:'var(--primary)' }}>{ICON[account.account_type]}</span>
                  </div>
                  <div>
                    <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
                      <span style={{ fontWeight:600, fontSize:'1rem', color:'var(--primary)' }}>{account.account_type} Account</span>
                      <span className="badge" style={{ background:'rgba(34,64,154,0.08)', color:'var(--primary)', border:'1px solid rgba(34,64,154,0.2)' }}>{account.currency}</span>
                    </div>
                    <div style={{ fontSize:'0.82rem', color:'var(--outline)', fontFamily:'monospace', marginBottom:8 }}>{account.masked_number}</div>
                    <div style={{ fontFamily:'Outfit', fontSize:'1.6rem', fontWeight:600, color:'var(--primary)', letterSpacing:'-0.02em' }}>
                      ₹{account.available_balance.toLocaleString('en-IN', { minimumFractionDigits:2 })}
                    </div>
                    <div style={{ fontSize:'0.75rem', color:'var(--outline)', marginTop:2 }}>Available balance</div>
                  </div>
                </div>

                {/* Action buttons */}
                <div style={{ display:'flex', flexDirection:'column', gap:8, alignItems:'flex-end', justifyContent:'center' }}>
                  <button className="btn-primary" style={{ width:'auto', padding:'8px 18px', fontSize:'0.78rem' }}
                    onClick={() => navigate(`/transactions/${account.account_id}`)}>
                    <span className="ms" style={{ fontSize:16 }}>receipt_long</span>
                    Statement
                  </button>
                  {account.account_type !== 'FD' && (
                    <button className="btn-ghost" style={{ padding:'7px 18px', fontSize:'0.78rem' }}
                      onClick={() => navigate('/transfer')}>
                      <span className="ms" style={{ fontSize:16 }}>payments</span>
                      Transfer
                    </button>
                  )}
                </div>
              </div>

              {/* Debit card + settings (only for SAVINGS/CURRENT) */}
              {account.account_type !== 'FD' && (
                <div style={{ padding:'22px 28px', borderBottom:'1px solid var(--outline-var)' }}>
                  <div style={{ display:'grid', gridTemplateColumns:'auto 1fr', gap:32, alignItems:'start' }}>

                    {/* Card visual */}
                    <div style={{ minWidth:0 }}>
                      <div style={{ fontSize:'0.68rem', fontWeight:600, color:'var(--outline)', letterSpacing:'0.07em', textTransform:'uppercase', marginBottom:12 }}>Linked Debit Card</div>
                      {card ? (
                        <>
                          <DebitCard card={card} onReveal={() => void handleReveal(card)} revealed={rev} countdown={cd} />
                          {isRevealing && <div style={{ marginTop:8, fontSize:'0.75rem', color:'var(--outline)', display:'flex', alignItems:'center', gap:4 }}><div className="spinner" style={{ width:12, height:12, borderTopColor:'var(--primary)', borderColor:'var(--outline-var)' }} />Fetching secure details…</div>}
                        </>
                      ) : (
                        <div style={{ width:360, aspectRatio:'1.586', borderRadius:16, background:'var(--surface-highest)', border:'2px dashed var(--outline-var)', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', color:'var(--outline)', gap:8 }}>
                          <span className="ms" style={{ fontSize:36 }}>credit_card_off</span>
                          <div style={{ fontSize:'0.82rem', textAlign:'center' }}>No card linked.<br/>Contact your branch.</div>
                        </div>
                      )}
                    </div>

                    {/* Card quick stats */}
                    {card && (
                      <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                        <div style={{ fontSize:'0.68rem', fontWeight:600, color:'var(--outline)', letterSpacing:'0.07em', textTransform:'uppercase', marginBottom:4 }}>Card Status</div>
                        <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                          {[
                            { label:'Domestic',      on: card.is_domestic_enabled },
                            { label:'International', on: card.is_international_enabled },
                            { label:'ATM',           on: card.is_atm_enabled },
                            { label:'Online',        on: card.is_online_enabled },
                          ].map(s => (
                            <span key={s.label} className={`badge ${s.on ? 'badge-verified' : 'badge-debit'}`} style={{ display:'inline-flex', alignItems:'center', gap:4 }}>
                              <span className="ms" style={{ fontSize:12 }}>{s.on ? 'check' : 'close'}</span>
                              {s.label}
                            </span>
                          ))}
                        </div>
                        <div style={{ marginTop:4 }}>
                          <div style={{ fontSize:'0.68rem', fontWeight:600, color:'var(--outline)', letterSpacing:'0.07em', textTransform:'uppercase', marginBottom:10 }}>Limits</div>
                          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                            {[
                              { label:'Daily ATM',   val: card.daily_atm_limit },
                              { label:'Daily POS',   val: card.daily_pos_limit },
                              { label:'Per Txn',     val: card.per_transaction_limit },
                              { label:'Monthly',     val: card.monthly_limit },
                            ].map(l => (
                              <div key={l.label} style={{ padding:'10px 14px', background:'var(--surface-high)', borderRadius:8 }}>
                                <div style={{ fontSize:'0.65rem', color:'var(--outline)', letterSpacing:'0.05em', textTransform:'uppercase', marginBottom:3 }}>{l.label}</div>
                                <div style={{ fontFamily:'Outfit', fontWeight:600, fontSize:'0.95rem', color:'var(--primary)' }}>₹{l.val.toLocaleString('en-IN')}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Settings panel */}
              {card && (
                <CardSettingsPanel
                  key={card.id}
                  card={card}
                  onSave={updated => setCards(m => new Map(m).set(updated.account_id, updated))}
                />
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
