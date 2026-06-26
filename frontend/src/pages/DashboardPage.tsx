import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import client from '../api/client';
import { clearAccessToken } from '../store/authStore';

interface Account {
  account_id: string;
  account_type: 'SAVINGS' | 'CURRENT' | 'FD';
  masked_number: string;
  available_balance: number;
  currency: string;
}
interface Transaction {
  id: string | number;
  entry_type: 'DEBIT' | 'CREDIT';
  amount: number;
  running_balance: number;
  transfer_mode: string;
  narration: string | null;
  transaction_date: string;
}

const ACCOUNT_ICON: Record<string, string> = { SAVINGS: 'account_balance', CURRENT: 'credit_card', FD: 'lock' };

function SkeletonCard() {
  return (
    <div className="sand-card" style={{ padding: 24, marginBottom: 4 }}>
      <div className="skeleton" style={{ height: 16, width: '35%', marginBottom: 10 }} />
      <div className="skeleton" style={{ height: 32, width: '55%', marginBottom: 8 }} />
      <div className="skeleton" style={{ height: 12, width: '25%' }} />
    </div>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [miniStatements, setMiniStatements] = useState<Record<string, Transaction[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryIn, setRetryIn] = useState<number | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true); setError(null); setRetryIn(null);
    try {
      const res = await client.get<Account[] | { data: Account[] }>('/accounts');
      const accts = Array.isArray(res.data) ? res.data : (res.data as { data: Account[] }).data ?? [];
      setAccounts(accts);
      const statements: Record<string, Transaction[]> = {};
      await Promise.all(accts.map(async (acct) => {
        try {
          const r = await client.get<Transaction[] | { data: Transaction[] }>(`/accounts/${acct.account_id}/mini-statement`);
          statements[acct.account_id] = Array.isArray(r.data) ? r.data : (r.data as { data: Transaction[] }).data ?? [];
        } catch { statements[acct.account_id] = []; }
      }));
      setMiniStatements(statements);
    } catch (err: unknown) {
      const status = (err as { response?: { status: number } }).response?.status ?? 0;
      if (status === 503) { setError('Service temporarily unavailable.'); setRetryIn(30); }
      else if (status === 401) { clearAccessToken(); navigate('/login'); }
      else setError('Failed to load account data. Please retry.');
    } finally { setLoading(false); }
  }, [navigate]);

  useEffect(() => { void fetchData(); }, [fetchData]);
  useEffect(() => {
    if (retryIn === null || retryIn <= 0) return;
    const t = setTimeout(() => setRetryIn((r) => (r !== null ? r - 1 : null)), 1000);
    return () => clearTimeout(t);
  }, [retryIn]);

  const totalBalance = accounts.reduce((sum, a) => sum + a.available_balance, 0);

  return (
    <>
      {/* ── Page header ── */}
      <div className="page-header">
        <div>
          <p style={{ fontSize: '0.9rem', color: 'var(--on-surface-var)', marginBottom: 4 }}>
            {loading ? 'Loading…' : `${accounts.length} account${accounts.length !== 1 ? 's' : ''} · All balances in INR`}
          </p>
          <div className="page-title">Total Portfolio</div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn-ghost" onClick={() => navigate('/transfer')}>
            <span className="ms" style={{ fontSize: 18 }}>payments</span>
            Transfer
          </button>
          <button className="btn-ghost" onClick={() => navigate('/loan')}>
            <span className="ms" style={{ fontSize: 18 }}>account_balance_wallet</span>
            Loan
          </button>
        </div>
      </div>

      <div className="page-body">
        {/* Error banner */}
        {error && (
          <div className="alert alert-warning" style={{ marginBottom: 24 }} role="alert">
            <span className="ms" style={{ fontSize: 20, flexShrink: 0 }}>warning</span>
            <span>
              {error}
              {retryIn !== null && retryIn > 0 && <> Retrying in {retryIn}s…</>}
              {retryIn === 0 && (
                <button className="btn-ghost" style={{ marginLeft: 12, padding: '4px 12px' }}
                  onClick={() => void fetchData()}>Retry</button>
              )}
            </span>
          </div>
        )}

        {/* Bento grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 20 }}>

          {/* ── Total portfolio hero (span 8) ── */}
          {!loading && accounts.length > 0 && (
            <div className="sand-card" style={{
              gridColumn: 'span 8', padding: '32px 28px',
              position: 'relative', overflow: 'hidden',
            }}>
              {/* Decorative blob */}
              <div style={{
                position: 'absolute', top: -40, right: -40, width: 200, height: 200,
                background: 'rgba(254,212,136,0.25)', borderRadius: '50%', filter: 'blur(50px)',
                pointerEvents: 'none',
              }} />
              <div style={{ position: 'relative' }}>
                <p style={{ fontSize: '0.72rem', fontWeight: 600, letterSpacing: '0.07em',
                  textTransform: 'uppercase', color: 'var(--on-surface-var)', marginBottom: 8 }}>
                  Total Portfolio
                </p>
                <div style={{ fontFamily: 'Outfit', fontSize: '2.4rem', fontWeight: 600,
                  color: 'var(--primary)', letterSpacing: '-0.02em', lineHeight: 1.1, marginBottom: 6 }}>
                  ₹{totalBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 28 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3,
                    padding: '3px 10px', borderRadius: 100,
                    background: 'rgba(46,125,50,0.1)', color: 'var(--color-success)',
                    fontSize: '0.78rem', fontWeight: 600 }}>
                    <span className="ms" style={{ fontSize: 14 }}>trending_up</span>
                    Active
                  </span>
                  <span style={{ fontSize: '0.8rem', color: 'var(--on-surface-var)' }}>
                    across {accounts.length} account{accounts.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 12 }}>
                  <button className="btn-primary" style={{ width: 'auto', padding: '11px 22px' }}
                    onClick={() => navigate('/transfer')}>
                    <span className="ms" style={{ fontSize: 18 }}>payments</span>
                    Transfer Funds
                  </button>
                  <button className="btn-ghost" onClick={() => navigate('/loan')}>
                    <span className="ms" style={{ fontSize: 18 }}>account_balance_wallet</span>
                    Loan Check
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── First account quick card (span 4) ── */}
          {!loading && accounts[0] && (
            <div className="glass" style={{ gridColumn: 'span 4', padding: '24px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                <div>
                  <p style={{ fontSize: '0.8rem', color: 'var(--on-surface-var)', marginBottom: 2 }}>
                    {accounts[0].account_type} Account
                  </p>
                  <p style={{ fontFamily: 'Outfit', fontWeight: 500, color: 'var(--primary)' }}>
                    Aura {accounts[0].account_type.charAt(0) + accounts[0].account_type.slice(1).toLowerCase()}
                  </p>
                </div>
                <span className="ms" style={{ fontSize: 22, color: 'var(--outline)' }}>
                  {ACCOUNT_ICON[accounts[0].account_type]}
                </span>
              </div>
              <div>
                <div style={{ fontFamily: 'Outfit', fontSize: '1.5rem', fontWeight: 600, color: 'var(--primary)', marginBottom: 4 }}>
                  ₹{accounts[0].available_balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </div>
                <p style={{ fontSize: '0.8rem', color: 'var(--on-surface-var)', fontFamily: 'monospace' }}>
                  {accounts[0].masked_number}
                </p>
              </div>
            </div>
          )}

          {/* Skeleton state */}
          {loading && (
            <>
              <div style={{ gridColumn: 'span 8' }}><SkeletonCard /></div>
              <div style={{ gridColumn: 'span 4' }}><SkeletonCard /></div>
            </>
          )}

          {/* ── Account cards with mini-statements ── */}
          {!loading && accounts.map((account) => {
            const txns = miniStatements[account.account_id] ?? [];
            return (
              <div key={account.account_id} className="sand-card" style={{ gridColumn: 'span 12', overflow: 'hidden' }}>
                {/* Account header */}
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '20px 24px', borderBottom: '1px solid var(--sand-border)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <div style={{
                      width: 44, height: 44, borderRadius: 10,
                      background: 'var(--surface-high)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <span className="ms filled" style={{ fontSize: 22, color: 'var(--primary)' }}>
                        {ACCOUNT_ICON[account.account_type]}
                      </span>
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--primary)' }}>
                        {account.account_type} Account
                      </div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--outline)', fontFamily: 'monospace', marginTop: 1 }}>
                        {account.masked_number}
                      </div>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '0.68rem', color: 'var(--outline)', letterSpacing: '0.06em',
                      textTransform: 'uppercase', marginBottom: 3 }}>
                      Available Balance
                    </div>
                    <div style={{ fontFamily: 'Outfit', fontSize: '1.4rem', fontWeight: 600, color: 'var(--primary)' }}>
                      ₹{account.available_balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </div>
                  </div>
                </div>

                {/* Mini statement */}
                <div style={{ padding: '16px 24px 20px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <span style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--outline)',
                      letterSpacing: '0.07em', textTransform: 'uppercase' }}>
                      Recent Activity
                    </span>
                    <button className="btn-ghost" style={{ padding: '5px 12px', fontSize: '0.78rem' }}
                      onClick={() => navigate(`/transactions/${account.account_id}`)}>
                      View all
                      <span className="ms" style={{ fontSize: 15 }}>arrow_forward</span>
                    </button>
                  </div>

                  {txns.length === 0 ? (
                    <div style={{ color: 'var(--outline)', fontSize: '0.875rem', padding: '20px 0', textAlign: 'center' }}>
                      No recent transactions
                    </div>
                  ) : (
                    <table className="sb-table">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Narration</th>
                          <th>Mode</th>
                          <th style={{ textAlign: 'right' }}>Amount</th>
                          <th style={{ textAlign: 'right' }}>Balance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {txns.map((tx) => (
                          <tr key={tx.id}>
                            <td style={{ color: 'var(--on-surface-var)', whiteSpace: 'nowrap', fontSize: '0.85rem' }}>
                              {new Date(tx.transaction_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })}
                            </td>
                            <td style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {tx.narration ?? tx.transfer_mode}
                            </td>
                            <td>
                              <span style={{ fontSize: '0.68rem', padding: '2px 8px', borderRadius: 4,
                                background: 'var(--surface-highest)', color: 'var(--outline)',
                                fontWeight: 600, letterSpacing: '0.04em' }}>
                                {tx.transfer_mode}
                              </span>
                            </td>
                            <td style={{ textAlign: 'right', fontWeight: 600,
                              color: tx.entry_type === 'CREDIT' ? 'var(--color-success)' : 'var(--color-danger)' }}>
                              {tx.entry_type === 'CREDIT' ? '+' : '−'}
                              ₹{tx.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                            </td>
                            <td style={{ textAlign: 'right', color: 'var(--on-surface-var)', fontSize: '0.85rem' }}>
                              ₹{tx.running_balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            );
          })}

          {/* Empty state */}
          {!loading && accounts.length === 0 && !error && (
            <div className="sand-card" style={{ gridColumn: 'span 12', padding: '48px', textAlign: 'center' }}>
              <span className="ms" style={{ fontSize: 48, color: 'var(--outline-var)', display: 'block', marginBottom: 12 }}>
                account_balance
              </span>
              <p style={{ color: 'var(--on-surface-var)' }}>No accounts found.</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
