import React, { useState, useEffect, useCallback } from 'react';
import client from '../api/client';

interface Account {
  account_id: string;
  account_type: string;
  masked_number: string;
  available_balance: number;
  currency: string;
}
interface Beneficiary {
  id: string;
  account_number: string;
  ifsc_code: string;
  name: string;
  bank_name: string | null;
  status: 'PENDING' | 'VERIFIED' | 'DELETED';
  daily_limit: number;
}
interface TransferResult {
  transfer_ref_id: string;
  status: string;
  created_at: string;
}

/** Initials avatar for beneficiaries without photos */
function Avatar({ name, verified }: { name: string; verified: boolean }) {
  const initials = name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <div style={{
      width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
      background: verified ? 'rgba(46,125,50,0.12)' : 'rgba(254,212,136,0.3)',
      color: verified ? 'var(--color-success)' : 'var(--secondary)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'Outfit', fontWeight: 600, fontSize: '0.85rem',
    }}>
      {initials}
    </div>
  );
}

export default function FundTransferPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [sourceAccountId, setSourceAccountId] = useState('');
  const [destAccountId, setDestAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const [transferMode, setTransferMode] = useState<'NEFT' | 'IMPS'>('NEFT');
  const [narration, setNarration] = useState('');
  const [transferResult, setTransferResult] = useState<TransferResult | null>(null);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [transferring, setTransferring] = useState(false);

  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([]);
  const [showAddBene, setShowAddBene] = useState(false);
  const [beneAccountNumber, setBeneAccountNumber] = useState('');
  const [beneIfsc, setBeneIfsc] = useState('');
  const [beneName, setBeneName] = useState('');
  const [beneBankName, setBeneBankName] = useState('');
  const [addingBene, setAddingBene] = useState(false);
  const [beneError, setBeneError] = useState<string | null>(null);
  const [beneSuccess, setBeneSuccess] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadAccounts = useCallback(async () => {
    try {
      const res = await client.get<Account[] | { data: Account[] }>('/accounts');
      const accts = Array.isArray(res.data) ? res.data : (res.data as { data: Account[] }).data ?? [];
      setAccounts(accts);
    } catch { /* silent */ }
  }, []);

  const loadBeneficiaries = useCallback(async () => {
    try {
      const res = await client.get<Beneficiary[] | { data: Beneficiary[] }>('/beneficiaries');
      const benes = Array.isArray(res.data) ? res.data : (res.data as { data: Beneficiary[] }).data ?? [];
      setBeneficiaries(benes.filter((b) => b.status !== 'DELETED'));
    } catch { /* silent */ }
  }, []);

  useEffect(() => { void loadAccounts(); void loadBeneficiaries(); }, [loadAccounts, loadBeneficiaries]);

  async function handleTransfer(e: React.FormEvent) {
    e.preventDefault();
    setTransferError(null); setTransferResult(null); setTransferring(true);
    try {
      const res = await client.post<TransferResult>('/transfers', {
        source_account_id: sourceAccountId,
        dest_account_id: destAccountId,
        amount: parseFloat(amount),
        transfer_mode: transferMode,
        idempotency_key: crypto.randomUUID(),
        narration: narration || undefined,
      });
      setTransferResult(res.data);
      setAmount(''); setNarration('');
      void loadAccounts();
    } catch (err: unknown) {
      const data = (err as { response?: { data?: { code?: string; detail?: { available_balance?: number } } } }).response?.data;
      if (data?.code === 'INSUFFICIENT_FUNDS') {
        const bal = data.detail?.available_balance;
        setTransferError(`Insufficient funds. Available: ${bal !== undefined ? `₹${bal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : 'N/A'}`);
      } else if (data?.code === 'INVALID_AMOUNT') {
        setTransferError('Amount must be greater than zero.');
      } else if (data?.code === 'DAILY_LIMIT_EXCEEDED') {
        setTransferError('Daily transfer limit exceeded for this beneficiary.');
      } else {
        setTransferError('Transfer failed. Please try again.');
      }
    } finally { setTransferring(false); }
  }

  async function handleAddBeneficiary(e: React.FormEvent) {
    e.preventDefault();
    setBeneError(null); setBeneSuccess(null); setAddingBene(true);
    const savedName = beneName;
    try {
      await client.post('/beneficiaries', {
        account_number: beneAccountNumber, ifsc_code: beneIfsc,
        name: beneName, bank_name: beneBankName || undefined,
      });
      setBeneAccountNumber(''); setBeneIfsc(''); setBeneName(''); setBeneBankName('');
      setBeneSuccess(`${savedName} added as beneficiary (pending verification).`);
      setShowAddBene(false);
      await loadBeneficiaries();
    } catch { setBeneError('Failed to add beneficiary. Please check the details and try again.'); }
    finally { setAddingBene(false); }
  }

  async function handleDeleteBeneficiary(id: string) {
    setDeletingId(id);
    try {
      await client.delete(`/beneficiaries/${id}`);
      await loadBeneficiaries();
    } catch { setBeneError('Failed to remove beneficiary. Please try again.'); }
    finally { setDeletingId(null); }
  }

  const sourceAccount = accounts.find((a) => a.account_id === sourceAccountId);

  return (
    <>
      {/* ── Page header ── */}
      <div className="page-header">
        <div>
          <div className="page-title">Fund Transfer</div>
          <div className="page-subtitle">Initiate a transfer or manage your beneficiaries</div>
        </div>
      </div>

      <div className="page-body">
        {/* 12-col grid matching the mockup */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 24 }}>

          {/* ── Transfer form — col-span 8 ── */}
          <div className="sand-card" style={{ gridColumn: 'span 8', padding: '32px' }}>
            <h2 style={{ marginBottom: 24 }}>Initiate Transfer</h2>

            {transferResult && (
              <div className="alert alert-success" style={{ marginBottom: 24 }} role="status">
                <span className="ms filled" style={{ fontSize: 18, flexShrink: 0 }}>check_circle</span>
                <span>
                  Transfer completed successfully.{' '}
                  <span style={{ fontSize: '0.8rem', fontFamily: 'monospace', opacity: 0.75 }}>
                    Ref: {transferResult.transfer_ref_id}
                  </span>
                </span>
              </div>
            )}
            {transferError && (
              <div className="alert alert-error" style={{ marginBottom: 24 }} role="alert">
                <span className="ms" style={{ fontSize: 18, flexShrink: 0 }}>error</span>
                {transferError}
              </div>
            )}

            <form onSubmit={handleTransfer}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>

                {/* From account */}
                <div className="form-field">
                  <label className="sb-label" htmlFor="source">From Account</label>
                  <select id="source" className="sb-select"
                    value={sourceAccountId}
                    onChange={(e) => { setSourceAccountId(e.target.value); setTransferResult(null); }}
                    required>
                    <option value="">Select source account</option>
                    {accounts.map((a) => (
                      <option key={a.account_id} value={a.account_id}>
                        {a.account_type} {a.masked_number} — ₹{a.available_balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </option>
                    ))}
                  </select>
                </div>

                {/* To account */}
                <div className="form-field">
                  <label className="sb-label" htmlFor="dest">To Account</label>
                  <select id="dest" className="sb-select"
                    value={destAccountId}
                    onChange={(e) => { setDestAccountId(e.target.value); setTransferResult(null); }}
                    required>
                    <option value="">Select destination account</option>
                    {accounts.filter((a) => a.account_id !== sourceAccountId).map((a) => (
                      <option key={a.account_id} value={a.account_id}>
                        {a.account_type} {a.masked_number}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Amount + mode */}
                <div className="grid-2">
                  <div className="form-field">
                    <label className="sb-label" htmlFor="amount">
                      Amount (₹)
                      {sourceAccount && (
                        <span style={{ float: 'right', fontWeight: 400, textTransform: 'none',
                          letterSpacing: 0, color: 'var(--outline)' }}>
                          Available: ₹{sourceAccount.available_balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </span>
                      )}
                    </label>
                    {/* Big editorial-style amount input */}
                    <div style={{ position: 'relative' }}>
                      <span style={{
                        position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)',
                        fontFamily: 'Outfit', fontSize: '1.5rem', color: 'var(--on-surface-var)',
                      }}>₹</span>
                      <input id="amount"
                        style={{
                          width: '100%', paddingLeft: 24, paddingBottom: 8,
                          background: 'transparent', border: 'none',
                          borderBottom: '1px solid var(--sand-border)',
                          fontFamily: 'Outfit', fontSize: '1.75rem', fontWeight: 600,
                          color: 'var(--on-surface)', outline: 'none',
                          transition: 'border-color 0.2s',
                        }}
                        onFocus={(e) => e.currentTarget.style.borderBottomColor = 'var(--primary-container)'}
                        onBlur={(e) => e.currentTarget.style.borderBottomColor = 'var(--sand-border)'}
                        type="number" min="0.01" step="0.01" placeholder="0.00"
                        value={amount} onChange={(e) => setAmount(e.target.value)}
                        required aria-required="true"
                      />
                    </div>
                  </div>

                  <div className="form-field">
                    <label className="sb-label">Transfer Mode</label>
                    <div className="radio-group" style={{ marginTop: 8 }}>
                      {(['NEFT', 'IMPS'] as const).map((mode) => (
                        <div className="radio-pill" key={mode}>
                          <input type="radio" id={`mode-${mode}`} name="transfer-mode"
                            value={mode} checked={transferMode === mode}
                            onChange={() => setTransferMode(mode)} />
                          <label htmlFor={`mode-${mode}`}>{mode}</label>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Narration */}
                <div className="form-field">
                  <label className="sb-label" htmlFor="narration">Remarks (Optional)</label>
                  <input id="narration" className="sb-input" type="text" maxLength={500}
                    placeholder="e.g. Rent payment, Consulting fees…"
                    value={narration} onChange={(e) => setNarration(e.target.value)} />
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12,
                  paddingTop: 20, borderTop: '1px solid var(--outline-var)' }}>
                  <button type="button" className="btn-ghost"
                    onClick={() => { setAmount(''); setNarration(''); setTransferResult(null); setTransferError(null); }}>
                    Cancel
                  </button>
                  <button type="submit" className="btn-primary"
                    style={{ width: 'auto', padding: '13px 28px' }}
                    disabled={transferring}>
                    {transferring
                      ? <><div className="spinner" /> Processing…</>
                      : <>Review Transfer <span className="ms" style={{ fontSize: 18 }}>arrow_forward</span></>}
                  </button>
                </div>
              </div>
            </form>
          </div>

          {/* ── Beneficiaries sidebar — col-span 4 ── */}
          <div style={{ gridColumn: 'span 4', display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div className="sand-card" style={{ padding: '24px', flex: 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <h3 style={{ margin: 0, fontSize: '1.05rem', color: 'var(--primary)' }}>Quick Transfer</h3>
                <button
                  onClick={() => { setShowAddBene((v) => !v); setBeneError(null); setBeneSuccess(null); }}
                  style={{
                    width: 32, height: 32, borderRadius: '50%', border: 'none',
                    background: showAddBene ? 'var(--surface-high)' : 'transparent',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: 'var(--primary)', transition: 'background 0.2s',
                  }}
                  aria-label={showAddBene ? 'Cancel' : 'Add beneficiary'}
                >
                  <span className="ms" style={{ fontSize: 20 }}>{showAddBene ? 'close' : 'add'}</span>
                </button>
              </div>

              {beneSuccess && (
                <div className="alert alert-success" style={{ marginBottom: 16, fontSize: '0.8rem' }} role="status">
                  <span className="ms filled" style={{ fontSize: 16 }}>check_circle</span>
                  {beneSuccess}
                </div>
              )}
              {beneError && (
                <div className="alert alert-error" style={{ marginBottom: 16, fontSize: '0.8rem' }} role="alert">
                  <span className="ms" style={{ fontSize: 16 }}>error</span>
                  {beneError}
                </div>
              )}

              {/* Add beneficiary inline form */}
              {showAddBene && (
                <div className="glass-sm" style={{ padding: '16px', marginBottom: 20 }}>
                  <p className="sb-label" style={{ marginBottom: 12 }}>New Beneficiary</p>
                  <form onSubmit={handleAddBeneficiary}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                      <div className="form-field">
                        <label className="sb-label" htmlFor="bn">Name</label>
                        <input id="bn" className="sb-input" type="text" value={beneName}
                          onChange={(e) => setBeneName(e.target.value)} required maxLength={255} placeholder="Full name" />
                      </div>
                      <div className="form-field">
                        <label className="sb-label" htmlFor="ba">Account Number</label>
                        <input id="ba" className="sb-input" type="text" value={beneAccountNumber}
                          onChange={(e) => setBeneAccountNumber(e.target.value)} required maxLength={20} placeholder="Account number" />
                      </div>
                      <div className="form-field">
                        <label className="sb-label" htmlFor="bi">IFSC Code</label>
                        <input id="bi" className="sb-input" type="text" value={beneIfsc}
                          onChange={(e) => setBeneIfsc(e.target.value.toUpperCase())}
                          required maxLength={15} pattern="[A-Z]{4}0[A-Z0-9]{6}"
                          title="Format: XXXX0XXXXXX" placeholder="e.g. HDFC0001234" />
                      </div>
                      <div className="form-field">
                        <label className="sb-label" htmlFor="bb">Bank (optional)</label>
                        <input id="bb" className="sb-input" type="text" value={beneBankName}
                          onChange={(e) => setBeneBankName(e.target.value)} maxLength={255} placeholder="Bank name" />
                      </div>
                      <button className="btn-primary" type="submit" disabled={addingBene} style={{ marginTop: 4 }}>
                        {addingBene ? <><div className="spinner" /> Adding…</> : 'Add Beneficiary'}
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* Beneficiary list */}
              {beneficiaries.length === 0 && !showAddBene && (
                <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--outline)' }}>
                  <span className="ms" style={{ fontSize: 36, display: 'block', marginBottom: 8, opacity: 0.4 }}>person_add</span>
                  <p style={{ fontSize: '0.875rem' }}>No beneficiaries yet</p>
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {beneficiaries.map((b) => (
                  <div key={b.id} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 12px', borderRadius: 'var(--radius-md)',
                    cursor: 'pointer', transition: 'background 0.15s',
                    border: '1px solid transparent',
                  }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'var(--surface-high)';
                      e.currentTarget.style.borderColor = 'var(--outline-var)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent';
                      e.currentTarget.style.borderColor = 'transparent';
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
                      <Avatar name={b.name} verified={b.status === 'VERIFIED'} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <p style={{ fontSize: '0.9rem', fontWeight: 500, color: 'var(--on-surface)',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {b.name}
                          </p>
                          {b.status === 'VERIFIED' && (
                            <span className="ms filled" style={{ fontSize: 14, color: 'var(--color-success)', flexShrink: 0 }}>verified</span>
                          )}
                        </div>
                        <p style={{ fontSize: '0.75rem', color: 'var(--outline)', fontFamily: 'monospace' }}>
                          {b.ifsc_code} {b.account_number.slice(-4).padStart(b.account_number.length, '•')}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => void handleDeleteBeneficiary(b.id)}
                      disabled={deletingId === b.id}
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: 'var(--outline)', padding: 4, flexShrink: 0,
                        transition: 'color 0.15s',
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.color = 'var(--color-danger)'}
                      onMouseLeave={(e) => e.currentTarget.style.color = 'var(--outline)'}
                      aria-label={`Remove ${b.name}`}
                    >
                      <span className="ms" style={{ fontSize: 18 }}>
                        {deletingId === b.id ? 'hourglass_empty' : 'delete_outline'}
                      </span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── Security notice — full width ── */}
          <div className="sand-card" style={{
            gridColumn: 'span 12', padding: '20px 24px',
            borderLeft: '4px solid var(--primary-container)',
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
              <span className="ms" style={{ fontSize: 22, color: 'var(--primary)', flexShrink: 0, marginTop: 1 }}>info</span>
              <div>
                <p style={{ fontWeight: 500, fontSize: '0.95rem', color: 'var(--on-surface)', marginBottom: 4 }}>
                  Important Security Notice
                </p>
                <p style={{ fontSize: '0.85rem', color: 'var(--on-surface-var)', lineHeight: 1.6 }}>
                  Transfers above ₹50,000 may require additional verification. Ensure your
                  registered mobile/email is accessible. New beneficiaries require verification
                  by a branch manager before transfers exceeding the ₹10,000 daily limit.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
