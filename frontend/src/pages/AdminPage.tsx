import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import client from '../api/client';
import { getAccessToken } from '../store/authStore';
import { getUserRole, isAtLeast } from '../store/userStore';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Stats {
  total_users: number;
  active_accounts: number;
  pending_loans: number;
  pending_beneficiaries: number;
  transactions_today: number;
  locked_users: number;
}
interface AdminUser {
  id: string; username: string; email: string; phone: string;
  role: 'CUSTOMER' | 'BRANCH_MANAGER' | 'ADMIN';
  is_locked: boolean; locked_reason: string | null;
  failed_attempts: number; created_at: string;
}
interface AdminAccount {
  account_id: string; account_number: string; account_type: string;
  available_balance: number; currency: string; is_active: boolean;
  username: string; email: string;
}
interface AdminLoan {
  id: string; customer_id: string; username: string;
  loan_amount: number; tenure_months: number;
  annual_interest_rate: number; calculated_emi: number | null;
  decision: 'APPROVED' | 'REJECTED' | 'PENDING';
  rejection_reason: string | null; submitted_at: string;
}
interface AdminBeneficiary {
  id: string; owner_user_id: string; owner_username: string;
  account_number: string; ifsc_code: string; name: string;
  bank_name: string | null; status: string;
  daily_limit: number; created_at: string;
}
interface Paginated<T> { data: T[]; total: number; }

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({ icon, label, value, accent }: { icon: string; label: string; value: number | string; accent?: string }) {
  return (
    <div className="sand-card" style={{ padding: '20px 22px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <span style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--outline)', letterSpacing: '0.07em', textTransform: 'uppercase' }}>{label}</span>
        <span className="ms filled" style={{ fontSize: 22, color: accent ?? 'var(--primary)' }}>{icon}</span>
      </div>
      <div style={{ fontFamily: 'Outfit', fontSize: '2rem', fontWeight: 600, color: accent ?? 'var(--primary)', letterSpacing: '-0.02em' }}>
        {typeof value === 'number' ? value.toLocaleString('en-IN') : value}
      </div>
    </div>
  );
}

function DecisionBadge({ decision }: { decision: AdminLoan['decision'] }) {
  const map = {
    APPROVED: { cls: 'badge-verified', label: 'Approved' },
    REJECTED: { cls: 'badge-debit', label: 'Rejected' },
    PENDING:  { cls: 'badge-pending', label: 'Pending' },
  };
  const m = map[decision];
  return <span className={`badge ${m.cls}`}>{m.label}</span>;
}

function Pagination({ page, total, pageSize, onChange }: {
  page: number; total: number; pageSize: number; onChange: (p: number) => void;
}) {
  const totalPages = Math.ceil(total / pageSize);
  if (totalPages <= 1) return null;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px', borderTop: '1px solid var(--outline-var)' }}>
      <span style={{ fontSize: '0.8rem', color: 'var(--outline)' }}>
        {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
      </span>
      <div style={{ display: 'flex', gap: 6 }}>
        <button className="btn-ghost" style={{ padding: '5px 12px' }} disabled={page === 1} onClick={() => onChange(page - 1)}>← Prev</button>
        <span style={{ padding: '5px 10px', fontSize: '0.85rem', color: 'var(--on-surface-var)' }}>{page}/{totalPages}</span>
        <button className="btn-ghost" style={{ padding: '5px 12px' }} disabled={page === totalPages} onClick={() => onChange(page + 1)}>Next →</button>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

type Tab = 'overview' | 'users' | 'accounts' | 'loans' | 'beneficiaries';

export default function AdminPage() {
  const navigate = useNavigate();
  const token = getAccessToken();
  const role = getUserRole(token);
  const isAdmin = isAtLeast(token, 'ADMIN');
  const isManager = isAtLeast(token, 'BRANCH_MANAGER');

  useEffect(() => {
    if (!isManager) navigate('/dashboard', { replace: true });
  }, [isManager, navigate]);

  const [tab, setTab] = useState<Tab>('overview');

  // Stats
  const [stats, setStats] = useState<Stats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  // Users
  const [users, setUsers] = useState<Paginated<AdminUser>>({ data: [], total: 0 });
  const [usersPage, setUsersPage] = useState(1);
  const [userSearch, setUserSearch] = useState('');
  const [usersLoading, setUsersLoading] = useState(false);
  const [lockingId, setLockingId] = useState<string | null>(null);

  // Accounts
  const [accounts, setAccounts] = useState<Paginated<AdminAccount>>({ data: [], total: 0 });
  const [accountsPage, setAccountsPage] = useState(1);
  const [accountsLoading, setAccountsLoading] = useState(false);

  // Loans
  const [loans, setLoans] = useState<Paginated<AdminLoan>>({ data: [], total: 0 });
  const [loansPage, setLoansPage] = useState(1);
  const [loanDecisionFilter, setLoanDecisionFilter] = useState('');
  const [loansLoading, setLoansLoading] = useState(false);

  // Beneficiaries
  const [benes, setBenes] = useState<Paginated<AdminBeneficiary>>({ data: [], total: 0 });
  const [benesPage, setBenesPage] = useState(1);
  const [benesLoading, setBenesLoading] = useState(false);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [beneMsg, setBeneMsg] = useState<string | null>(null);

  // Load stats once
  useEffect(() => {
    void (async () => {
      try {
        const res = await client.get<Stats>('/admin/stats');
        setStats(res.data);
      } catch { /* ignore */ }
      finally { setStatsLoading(false); }
    })();
  }, []);

  const fetchUsers = useCallback(async () => {
    if (!isAdmin) return;
    setUsersLoading(true);
    try {
      const params: Record<string, string> = { page: String(usersPage), page_size: '20' };
      if (userSearch) params['search'] = userSearch;
      const res = await client.get<Paginated<AdminUser>>('/admin/users', { params });
      setUsers(res.data);
    } catch { /* ignore */ }
    finally { setUsersLoading(false); }
  }, [usersPage, userSearch, isAdmin]);

  const fetchAccounts = useCallback(async () => {
    setAccountsLoading(true);
    try {
      const res = await client.get<Paginated<AdminAccount>>('/admin/accounts', { params: { page: String(accountsPage), page_size: '20' } });
      setAccounts(res.data);
    } catch { /* ignore */ }
    finally { setAccountsLoading(false); }
  }, [accountsPage]);

  const fetchLoans = useCallback(async () => {
    setLoansLoading(true);
    try {
      const params: Record<string, string> = { page: String(loansPage), page_size: '20' };
      if (loanDecisionFilter) params['decision'] = loanDecisionFilter;
      const res = await client.get<Paginated<AdminLoan>>('/admin/loans', { params });
      setLoans(res.data);
    } catch { /* ignore */ }
    finally { setLoansLoading(false); }
  }, [loansPage, loanDecisionFilter]);

  const fetchBenes = useCallback(async () => {
    setBenesLoading(true);
    try {
      const res = await client.get<Paginated<AdminBeneficiary>>('/admin/beneficiaries', { params: { page: String(benesPage), page_size: '20' } });
      setBenes(res.data);
    } catch { /* ignore */ }
    finally { setBenesLoading(false); }
  }, [benesPage]);

  useEffect(() => { if (tab === 'users') void fetchUsers(); }, [tab, fetchUsers]);
  useEffect(() => { if (tab === 'accounts') void fetchAccounts(); }, [tab, fetchAccounts]);
  useEffect(() => { if (tab === 'loans') void fetchLoans(); }, [tab, fetchLoans]);
  useEffect(() => { if (tab === 'beneficiaries') void fetchBenes(); }, [tab, fetchBenes]);

  async function handleLockToggle(userId: string, currentlyLocked: boolean) {
    setLockingId(userId);
    try {
      await client.patch(`/admin/users/${userId}/lock`, { lock: !currentlyLocked, reason: !currentlyLocked ? 'Locked by admin' : undefined });
      void fetchUsers();
    } catch { /* ignore */ }
    finally { setLockingId(null); }
  }

  async function handleVerifyBeneficiary(id: string) {
    setVerifyingId(id);
    try {
      await client.patch(`/beneficiaries/${id}/verify`, {});
      setBeneMsg('Beneficiary verified successfully.');
      setTimeout(() => setBeneMsg(null), 4000);
      void fetchBenes();
      // Refresh stats
      const res = await client.get<Stats>('/admin/stats');
      setStats(res.data);
    } catch {
      setBeneMsg('Failed to verify beneficiary.');
    } finally {
      setVerifyingId(null);
    }
  }

  if (!isManager) return null;

  const TABS: { id: Tab; label: string; icon: string; adminOnly?: boolean }[] = [
    { id: 'overview',      label: 'Overview',      icon: 'dashboard' },
    { id: 'users',         label: 'Users',         icon: 'group', adminOnly: true },
    { id: 'accounts',      label: 'Accounts',      icon: 'account_balance' },
    { id: 'loans',         label: 'Loans',         icon: 'account_balance_wallet' },
    { id: 'beneficiaries', label: 'Beneficiaries', icon: 'how_to_reg' },
  ].filter((t) => !t.adminOnly || isAdmin);

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Admin Panel</div>
          <div className="page-subtitle">
            Signed in as <strong>{role === 'ADMIN' ? 'Administrator' : 'Branch Manager'}</strong> — full read access · {role === 'ADMIN' ? 'user management enabled' : 'read-only users'}
          </div>
        </div>
      </div>

      <div className="page-body">

        {/* ── Stats grid ── */}
        {statsLoading ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 28 }}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="sand-card" style={{ padding: '20px 22px' }}>
                <div className="skeleton" style={{ height: 12, width: '60%', marginBottom: 14 }} />
                <div className="skeleton" style={{ height: 32, width: '40%' }} />
              </div>
            ))}
          </div>
        ) : stats && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 28 }}>
            <StatCard icon="group" label="Total Users" value={stats.total_users} />
            <StatCard icon="account_balance" label="Active Accounts" value={stats.active_accounts} />
            <StatCard icon="today" label="Transactions Today" value={stats.transactions_today} />
            <StatCard icon="pending_actions" label="Pending Loans" value={stats.pending_loans} accent={stats.pending_loans > 0 ? 'var(--color-warning)' : undefined} />
            <StatCard icon="how_to_reg" label="Pending Beneficiaries" value={stats.pending_beneficiaries} accent={stats.pending_beneficiaries > 0 ? 'var(--color-warning)' : undefined} />
            <StatCard icon="lock_person" label="Locked Users" value={stats.locked_users} accent={stats.locked_users > 0 ? 'var(--color-danger)' : undefined} />
          </div>
        )}

        {/* ── Tabs ── */}
        <div style={{ display: 'flex', gap: 2, marginBottom: 20, borderBottom: '1px solid var(--outline-var)', paddingBottom: 0 }}>
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 7,
                padding: '10px 18px', background: 'none', border: 'none',
                borderBottom: `2px solid ${tab === t.id ? 'var(--primary)' : 'transparent'}`,
                color: tab === t.id ? 'var(--primary)' : 'var(--on-surface-var)',
                fontWeight: tab === t.id ? 600 : 400, fontSize: '0.875rem',
                cursor: 'pointer', transition: 'all var(--transition)', marginBottom: -1,
              }}>
              <span className="ms" style={{ fontSize: 18 }}>{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Overview tab ── */}
        {tab === 'overview' && (
          <div className="sand-card" style={{ padding: '28px 28px' }}>
            <p style={{ fontSize: '0.95rem', color: 'var(--on-surface-var)', lineHeight: 1.7 }}>
              Welcome to the Admin Panel. Use the tabs above to manage users, accounts, loans, and beneficiary verifications.
            </p>
            <div style={{ marginTop: 20, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {[
                { tab: 'beneficiaries' as Tab, icon: 'how_to_reg', label: 'Verify pending beneficiaries', count: stats?.pending_beneficiaries, accent: 'var(--color-warning)' },
                { tab: 'loans' as Tab, icon: 'pending_actions', label: 'Review pending loans', count: stats?.pending_loans, accent: 'var(--color-warning)' },
                { tab: 'accounts' as Tab, icon: 'account_balance', label: 'Browse all accounts', count: stats?.active_accounts, accent: 'var(--primary)' },
                ...(isAdmin ? [{ tab: 'users' as Tab, icon: 'group', label: 'Manage users', count: stats?.total_users, accent: 'var(--primary)' }] : []),
              ].map((item) => (
                <button key={item.tab} onClick={() => setTab(item.tab)}
                  className="btn-ghost" style={{ justifyContent: 'flex-start', gap: 12, padding: '14px 16px', textAlign: 'left' }}>
                  <span className="ms filled" style={{ fontSize: 22, color: item.accent }}>{item.icon}</span>
                  <div>
                    <div style={{ fontWeight: 600, color: 'var(--on-surface)' }}>{item.label}</div>
                    {item.count !== undefined && (
                      <div style={{ fontSize: '0.8rem', color: 'var(--outline)', marginTop: 2 }}>{item.count.toLocaleString('en-IN')} record{item.count !== 1 ? 's' : ''}</div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Users tab ── */}
        {tab === 'users' && isAdmin && (
          <div>
            <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center' }}>
              <div style={{ flex: 1, position: 'relative' }}>
                <span className="ms" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 18, color: 'var(--outline)' }}>search</span>
                <input className="sb-input-filled" placeholder="Search username or email…"
                  style={{ paddingLeft: 38 }} value={userSearch}
                  onChange={(e) => { setUserSearch(e.target.value); setUsersPage(1); }} />
              </div>
            </div>
            <div className="sand-card" style={{ overflow: 'hidden' }}>
              <table className="sb-table">
                <thead>
                  <tr>
                    <th>User</th><th>Role</th><th>Status</th><th>Failed</th><th>Joined</th><th style={{ textAlign: 'right' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {usersLoading && Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i}><td colSpan={6} style={{ padding: '14px 16px' }}><div className="skeleton" style={{ height: 14, width: '80%' }} /></td></tr>
                  ))}
                  {!usersLoading && users.data.map((u) => (
                    <tr key={u.id}>
                      <td>
                        <div style={{ fontWeight: 600, color: 'var(--primary)' }}>{u.username}</div>
                        <div style={{ fontSize: '0.78rem', color: 'var(--outline)' }}>{u.email}</div>
                      </td>
                      <td>
                        <span className="badge" style={{ background: u.role === 'ADMIN' ? 'rgba(186,26,26,0.10)' : u.role === 'BRANCH_MANAGER' ? 'rgba(34,64,154,0.10)' : 'rgba(46,125,50,0.10)', color: u.role === 'ADMIN' ? 'var(--color-danger)' : u.role === 'BRANCH_MANAGER' ? 'var(--primary)' : 'var(--color-success)', border: '1px solid transparent' }}>
                          {u.role.replace('_', ' ')}
                        </span>
                      </td>
                      <td>
                        {u.is_locked
                          ? <span className="badge badge-debit" title={u.locked_reason ?? ''}>Locked</span>
                          : <span className="badge badge-verified">Active</span>
                        }
                      </td>
                      <td style={{ color: u.failed_attempts >= 3 ? 'var(--color-danger)' : 'var(--on-surface-var)' }}>{u.failed_attempts}</td>
                      <td style={{ color: 'var(--outline)', fontSize: '0.85rem' }}>
                        {new Date(u.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <button
                          className={u.is_locked ? 'btn-ghost' : 'btn-danger'}
                          style={{ padding: '5px 14px', fontSize: '0.78rem' }}
                          disabled={lockingId === u.id}
                          onClick={() => void handleLockToggle(u.id, u.is_locked)}
                        >
                          {lockingId === u.id
                            ? <div className="spinner" style={{ width: 14, height: 14, borderTopColor: 'var(--primary)', borderColor: 'var(--outline-var)' }} />
                            : <span className="ms" style={{ fontSize: 16 }}>{u.is_locked ? 'lock_open' : 'lock'}</span>
                          }
                          {u.is_locked ? 'Unlock' : 'Lock'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pagination page={usersPage} total={users.total} pageSize={20} onChange={setUsersPage} />
            </div>
          </div>
        )}

        {/* ── Accounts tab ── */}
        {tab === 'accounts' && (
          <div className="sand-card" style={{ overflow: 'hidden' }}>
            <table className="sb-table">
              <thead>
                <tr><th>Account</th><th>Owner</th><th>Type</th><th>Status</th><th style={{ textAlign: 'right' }}>Balance</th></tr>
              </thead>
              <tbody>
                {accountsLoading && Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}><td colSpan={5} style={{ padding: '14px 16px' }}><div className="skeleton" style={{ height: 14, width: '80%' }} /></td></tr>
                ))}
                {!accountsLoading && accounts.data.map((a) => (
                  <tr key={a.account_id}>
                    <td><span style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{a.account_number}</span></td>
                    <td>
                      <div style={{ fontWeight: 500 }}>{a.username}</div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--outline)' }}>{a.email}</div>
                    </td>
                    <td><span className="badge badge-pending" style={{ background: 'rgba(34,64,154,0.08)', color: 'var(--primary)', borderColor: 'rgba(34,64,154,0.2)' }}>{a.account_type}</span></td>
                    <td><span className={`badge ${a.is_active ? 'badge-verified' : 'badge-debit'}`}>{a.is_active ? 'Active' : 'Inactive'}</span></td>
                    <td style={{ textAlign: 'right', fontWeight: 600, color: 'var(--primary)' }}>
                      ₹{a.available_balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={accountsPage} total={accounts.total} pageSize={20} onChange={setAccountsPage} />
          </div>
        )}

        {/* ── Loans tab ── */}
        {tab === 'loans' && (
          <div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              {[['', 'All'], ['PENDING', 'Pending'], ['APPROVED', 'Approved'], ['REJECTED', 'Rejected']].map(([val, label]) => (
                <button key={val} onClick={() => { setLoanDecisionFilter(val); setLoansPage(1); }}
                  className="btn-ghost"
                  style={{ padding: '6px 16px', fontSize: '0.78rem', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase',
                    background: loanDecisionFilter === val ? 'rgba(34,64,154,0.10)' : 'transparent',
                    borderColor: loanDecisionFilter === val ? 'var(--primary-container)' : 'var(--outline-var)',
                    color: loanDecisionFilter === val ? 'var(--primary)' : 'var(--on-surface-var)' }}>
                  {label}
                </button>
              ))}
            </div>
            <div className="sand-card" style={{ overflow: 'hidden' }}>
              <table className="sb-table">
                <thead>
                  <tr><th>Customer</th><th>Amount</th><th>Tenure</th><th>EMI</th><th>Decision</th><th>Submitted</th></tr>
                </thead>
                <tbody>
                  {loansLoading && Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i}><td colSpan={6} style={{ padding: '14px 16px' }}><div className="skeleton" style={{ height: 14, width: '80%' }} /></td></tr>
                  ))}
                  {!loansLoading && loans.data.map((l) => (
                    <tr key={l.id}>
                      <td style={{ fontWeight: 500 }}>{l.username}</td>
                      <td style={{ fontWeight: 600, color: 'var(--primary)' }}>₹{l.loan_amount.toLocaleString('en-IN')}</td>
                      <td style={{ color: 'var(--on-surface-var)' }}>{l.tenure_months}m</td>
                      <td style={{ color: 'var(--on-surface-var)' }}>{l.calculated_emi ? `₹${l.calculated_emi.toLocaleString('en-IN', { minimumFractionDigits: 0 })}` : '—'}</td>
                      <td>
                        <DecisionBadge decision={l.decision} />
                        {l.rejection_reason && <div style={{ fontSize: '0.72rem', color: 'var(--outline)', marginTop: 3 }}>{l.rejection_reason}</div>}
                      </td>
                      <td style={{ color: 'var(--outline)', fontSize: '0.85rem' }}>
                        {new Date(l.submitted_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pagination page={loansPage} total={loans.total} pageSize={20} onChange={setLoansPage} />
            </div>
          </div>
        )}

        {/* ── Beneficiaries tab ── */}
        {tab === 'beneficiaries' && (
          <div>
            {beneMsg && (
              <div className="alert alert-success" style={{ marginBottom: 16 }}>
                <span className="ms" style={{ fontSize: 18, flexShrink: 0 }}>check_circle</span>
                {beneMsg}
              </div>
            )}
            {benes.data.length === 0 && !benesLoading && (
              <div className="sand-card" style={{ padding: '48px', textAlign: 'center' }}>
                <span className="ms" style={{ fontSize: 48, color: 'var(--color-success)', display: 'block', marginBottom: 12 }}>how_to_reg</span>
                <p style={{ fontFamily: 'Outfit', color: 'var(--primary)' }}>No pending beneficiaries</p>
                <p style={{ fontSize: '0.875rem', color: 'var(--outline)', marginTop: 4 }}>All beneficiaries have been reviewed.</p>
              </div>
            )}
            {(benes.data.length > 0 || benesLoading) && (
              <div className="sand-card" style={{ overflow: 'hidden' }}>
                <table className="sb-table">
                  <thead>
                    <tr><th>Beneficiary</th><th>Owner</th><th>Bank Details</th><th>Daily Limit</th><th>Added</th><th style={{ textAlign: 'right' }}>Action</th></tr>
                  </thead>
                  <tbody>
                    {benesLoading && Array.from({ length: 4 }).map((_, i) => (
                      <tr key={i}><td colSpan={6} style={{ padding: '14px 16px' }}><div className="skeleton" style={{ height: 14, width: '80%' }} /></td></tr>
                    ))}
                    {!benesLoading && benes.data.map((b) => (
                      <tr key={b.id}>
                        <td>
                          <div style={{ fontWeight: 600, color: 'var(--primary)' }}>{b.name}</div>
                          {b.bank_name && <div style={{ fontSize: '0.78rem', color: 'var(--outline)' }}>{b.bank_name}</div>}
                        </td>
                        <td style={{ fontWeight: 500 }}>{b.owner_username}</td>
                        <td>
                          <div style={{ fontFamily: 'monospace', fontSize: '0.82rem' }}>{b.account_number}</div>
                          <div style={{ fontSize: '0.78rem', color: 'var(--outline)' }}>{b.ifsc_code}</div>
                        </td>
                        <td style={{ color: 'var(--on-surface-var)' }}>₹{b.daily_limit.toLocaleString('en-IN')}</td>
                        <td style={{ color: 'var(--outline)', fontSize: '0.85rem' }}>
                          {new Date(b.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button className="btn-primary" style={{ width: 'auto', padding: '6px 16px', fontSize: '0.78rem' }}
                            disabled={verifyingId === b.id}
                            onClick={() => void handleVerifyBeneficiary(b.id)}>
                            {verifyingId === b.id
                              ? <div className="spinner" style={{ width: 14, height: 14 }} />
                              : <span className="ms" style={{ fontSize: 15 }}>verified</span>
                            }
                            Verify
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <Pagination page={benesPage} total={benes.total} pageSize={20} onChange={setBenesPage} />
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
