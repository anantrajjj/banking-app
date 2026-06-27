import { useState, useEffect, useCallback } from 'react';
import client from '../api/client';

interface Beneficiary {
  id: string;
  account_number: string;
  ifsc_code: string;
  name: string;
  bank_name: string | null;
  status: 'PENDING' | 'VERIFIED' | 'DELETED';
  daily_limit: number;
  created_at: string;
}

function StatusBadge({ status }: { status: Beneficiary['status'] }) {
  const map: Record<Beneficiary['status'], { cls: string; icon: string; label: string }> = {
    VERIFIED: { cls: 'badge-verified', icon: 'verified', label: 'Verified' },
    PENDING:  { cls: 'badge-pending',  icon: 'schedule', label: 'Pending' },
    DELETED:  { cls: 'badge-debit',    icon: 'cancel',   label: 'Deleted' },
  };
  const m = map[status];
  return (
    <span className={`badge ${m.cls}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span className="ms" style={{ fontSize: 12 }}>{m.icon}</span>
      {m.label}
    </span>
  );
}

function Initials({ name, status }: { name: string; status: Beneficiary['status'] }) {
  const letters = name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const bg = status === 'VERIFIED'
    ? 'rgba(46,125,50,0.12)' : status === 'PENDING'
    ? 'rgba(178,106,0,0.12)' : 'rgba(186,26,26,0.10)';
  const color = status === 'VERIFIED'
    ? 'var(--color-success)' : status === 'PENDING'
    ? 'var(--color-warning)' : 'var(--color-danger)';
  return (
    <div style={{
      width: 44, height: 44, borderRadius: '50%', flexShrink: 0,
      background: bg, color,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'Outfit', fontWeight: 700, fontSize: '0.9rem',
    }}>
      {letters}
    </div>
  );
}

export default function BeneficiaryPage() {
  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [filter, setFilter] = useState<'ALL' | 'VERIFIED' | 'PENDING'>('ALL');

  // Form state
  const [name, setName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [bankName, setBankName] = useState('');
  const [adding, setAdding] = useState(false);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await client.get<{ data: Beneficiary[] }>('/beneficiaries');
      const raw = Array.isArray(res.data) ? res.data : res.data.data ?? [];
      setBeneficiaries(raw.filter((b) => b.status !== 'DELETED'));
    } catch {
      setError('Failed to load beneficiaries.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Auto-clear flash messages
  useEffect(() => {
    if (!success) return;
    const t = setTimeout(() => setSuccess(null), 4000);
    return () => clearTimeout(t);
  }, [success]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setAdding(true);
    try {
      await client.post('/beneficiaries', {
        name,
        account_number: accountNumber,
        ifsc_code: ifsc.toUpperCase(),
        bank_name: bankName || undefined,
      });
      setSuccess('Beneficiary added. Awaiting branch manager verification.');
      setName(''); setAccountNumber(''); setIfsc(''); setBankName('');
      setShowAdd(false);
      void load();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } }).response?.data?.message;
      setError(msg ?? 'Failed to add beneficiary. Please try again.');
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      await client.delete(`/beneficiaries/${id}`);
      setSuccess('Beneficiary removed successfully.');
      setBeneficiaries((prev) => prev.filter((b) => b.id !== id));
    } catch {
      setError('Failed to remove beneficiary.');
    } finally {
      setDeletingId(null);
    }
  }

  const filtered = filter === 'ALL'
    ? beneficiaries
    : beneficiaries.filter((b) => b.status === filter);

  const verifiedCount = beneficiaries.filter((b) => b.status === 'VERIFIED').length;
  const pendingCount  = beneficiaries.filter((b) => b.status === 'PENDING').length;

  return (
    <>
      {/* ── Page header ── */}
      <div className="page-header">
        <div>
          <div className="page-title">Beneficiaries</div>
          <div className="page-subtitle">
            {!loading && `${verifiedCount} verified · ${pendingCount} pending verification`}
          </div>
        </div>
        <button
          className="btn-primary"
          style={{ width: 'auto', padding: '11px 22px' }}
          onClick={() => { setShowAdd((v) => !v); setError(null); }}
        >
          <span className="ms" style={{ fontSize: 18 }}>
            {showAdd ? 'close' : 'person_add'}
          </span>
          {showAdd ? 'Cancel' : 'Add Beneficiary'}
        </button>
      </div>

      <div className="page-body">

        {/* Flash messages */}
        {error && (
          <div className="alert alert-error" style={{ marginBottom: 20 }} role="alert">
            <span className="ms" style={{ fontSize: 18, flexShrink: 0 }}>error</span>
            {error}
            <button onClick={() => setError(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}>
              <span className="ms" style={{ fontSize: 16 }}>close</span>
            </button>
          </div>
        )}
        {success && (
          <div className="alert alert-success" style={{ marginBottom: 20 }} role="alert">
            <span className="ms" style={{ fontSize: 18, flexShrink: 0 }}>check_circle</span>
            {success}
          </div>
        )}

        {/* ── Add beneficiary form ── */}
        {showAdd && (
          <div className="sand-card" style={{ padding: '28px 28px 24px', marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 22 }}>
              <span className="ms filled" style={{ fontSize: 22, color: 'var(--primary)' }}>person_add</span>
              <h2 style={{ fontSize: '1.05rem' }}>Add New Beneficiary</h2>
            </div>
            <form onSubmit={(e) => void handleAdd(e)}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px 24px' }}>
                <div className="form-field" style={{ gridColumn: 'span 2' }}>
                  <label className="sb-label" htmlFor="bene-name">Full Name</label>
                  <input id="bene-name" className="sb-input-filled" type="text"
                    value={name} onChange={(e) => setName(e.target.value)}
                    placeholder="Beneficiary full name" required maxLength={255} />
                </div>
                <div className="form-field">
                  <label className="sb-label" htmlFor="bene-acc">Account Number</label>
                  <input id="bene-acc" className="sb-input-filled" type="text"
                    value={accountNumber} onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, ''))}
                    placeholder="e.g. 1234567890" required maxLength={20} />
                </div>
                <div className="form-field">
                  <label className="sb-label" htmlFor="bene-ifsc">IFSC Code</label>
                  <input id="bene-ifsc" className="sb-input-filled" type="text"
                    value={ifsc} onChange={(e) => setIfsc(e.target.value.toUpperCase())}
                    placeholder="e.g. SBIN0001234" required maxLength={15} />
                </div>
                <div className="form-field" style={{ gridColumn: 'span 2' }}>
                  <label className="sb-label" htmlFor="bene-bank">Bank Name <span style={{ color: 'var(--outline)', fontWeight: 400 }}>(optional)</span></label>
                  <input id="bene-bank" className="sb-input-filled" type="text"
                    value={bankName} onChange={(e) => setBankName(e.target.value)}
                    placeholder="e.g. State Bank of India" maxLength={255} />
                </div>
              </div>
              <div style={{ marginTop: 20, padding: '12px 16px', background: 'rgba(34,64,154,0.06)', borderRadius: 8, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <span className="ms" style={{ fontSize: 18, color: 'var(--primary)', flexShrink: 0, marginTop: 1 }}>info</span>
                <span style={{ fontSize: '0.82rem', color: 'var(--on-surface-var)', lineHeight: 1.5 }}>
                  New beneficiaries require verification by a branch manager before transfers can be made. This typically takes 1–2 business days.
                </span>
              </div>
              <div style={{ display: 'flex', gap: 12, marginTop: 22 }}>
                <button type="submit" className="btn-primary" disabled={adding}
                  style={{ width: 'auto', padding: '11px 28px' }}>
                  {adding ? <><div className="spinner" />&nbsp;Adding…</> : <>
                    <span className="ms" style={{ fontSize: 18 }}>check</span>
                    Submit for Verification
                  </>}
                </button>
                <button type="button" className="btn-ghost"
                  onClick={() => { setShowAdd(false); setError(null); }}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* ── Filter pills ── */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
          {(['ALL', 'VERIFIED', 'PENDING'] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className="btn-ghost"
              style={{
                padding: '6px 18px', fontSize: '0.78rem', fontWeight: 600,
                letterSpacing: '0.04em', textTransform: 'uppercase',
                background: filter === f ? 'rgba(34,64,154,0.10)' : 'transparent',
                borderColor: filter === f ? 'var(--primary-container)' : 'var(--outline-var)',
                color: filter === f ? 'var(--primary)' : 'var(--on-surface-var)',
              }}>
              {f === 'ALL' ? `All (${beneficiaries.length})` : f === 'VERIFIED' ? `Verified (${verifiedCount})` : `Pending (${pendingCount})`}
            </button>
          ))}
        </div>

        {/* ── Beneficiary list ── */}
        {loading ? (
          <div className="sand-card" style={{ padding: 0 }}>
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} style={{ padding: '20px 24px', borderBottom: '1px solid var(--outline-var)', display: 'flex', gap: 16, alignItems: 'center' }}>
                <div className="skeleton" style={{ width: 44, height: 44, borderRadius: '50%', flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div className="skeleton" style={{ height: 14, width: '30%', marginBottom: 8 }} />
                  <div className="skeleton" style={{ height: 12, width: '50%' }} />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="sand-card" style={{ padding: '56px', textAlign: 'center' }}>
            <span className="ms" style={{ fontSize: 52, color: 'var(--outline-var)', display: 'block', marginBottom: 14 }}>people</span>
            <p style={{ fontFamily: 'Outfit', fontSize: '1.05rem', color: 'var(--primary)', marginBottom: 6 }}>
              {beneficiaries.length === 0 ? 'No beneficiaries yet' : 'No beneficiaries in this filter'}
            </p>
            <p style={{ fontSize: '0.875rem', color: 'var(--on-surface-var)' }}>
              {beneficiaries.length === 0
                ? 'Add a beneficiary to start transferring funds to external accounts.'
                : 'Try switching the filter above.'}
            </p>
          </div>
        ) : (
          <div className="sand-card" style={{ overflow: 'hidden' }}>
            {filtered.map((b, idx) => (
              <div key={b.id} style={{
                display: 'flex', alignItems: 'center', gap: 16,
                padding: '18px 24px',
                borderBottom: idx < filtered.length - 1 ? '1px solid var(--outline-var)' : 'none',
                transition: 'background var(--transition)',
              }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(34,64,154,0.03)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <Initials name={b.name} status={b.status} />

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 3 }}>
                    <span style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--primary)' }}>
                      {b.name}
                    </span>
                    <StatusBadge status={b.status} />
                  </div>
                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.82rem', color: 'var(--on-surface-var)', fontFamily: 'monospace' }}>
                      {b.account_number}
                    </span>
                    <span style={{ fontSize: '0.82rem', color: 'var(--outline)' }}>
                      {b.ifsc_code}
                    </span>
                    {b.bank_name && (
                      <span style={{ fontSize: '0.82rem', color: 'var(--outline)' }}>
                        {b.bank_name}
                      </span>
                    )}
                  </div>
                  {b.status === 'PENDING' && (
                    <div style={{ marginTop: 4, fontSize: '0.75rem', color: 'var(--color-warning)', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span className="ms" style={{ fontSize: 13 }}>schedule</span>
                      Awaiting branch manager verification · Added {new Date(b.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                    </div>
                  )}
                  {b.status === 'VERIFIED' && (
                    <div style={{ marginTop: 4, fontSize: '0.75rem', color: 'var(--color-success)', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span className="ms" style={{ fontSize: 13 }}>check_circle</span>
                      Daily limit ₹{b.daily_limit.toLocaleString('en-IN')} · Ready for transfers
                    </div>
                  )}
                </div>

                <button
                  className="btn-danger"
                  style={{ flexShrink: 0 }}
                  disabled={deletingId === b.id}
                  onClick={() => void handleDelete(b.id)}
                >
                  {deletingId === b.id
                    ? <div className="spinner" style={{ borderTopColor: 'var(--color-danger)', borderColor: 'rgba(186,26,26,0.2)' }} />
                    : <span className="ms" style={{ fontSize: 18 }}>delete</span>
                  }
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
