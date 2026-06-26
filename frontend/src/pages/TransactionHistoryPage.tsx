import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import client from '../api/client';

interface Transaction {
  id: string | number;
  entry_type: 'DEBIT' | 'CREDIT';
  amount: number;
  running_balance: number;
  transfer_mode: string;
  narration: string | null;
  transaction_date: string;
}
interface PaginatedResult {
  data: Transaction[];
  total: number;
  page: number;
  page_size: number;
}

function SkeletonRow() {
  return (
    <tr>
      {[30, 45, 20, 18, 22, 22].map((w, i) => (
        <td key={i} style={{ padding: '14px 16px' }}>
          <div className="skeleton" style={{ height: 14, width: `${w}%` }} />
        </td>
      ))}
    </tr>
  );
}

export default function TransactionHistoryPage() {
  const { accountId } = useParams<{ accountId: string }>();
  const navigate = useNavigate();

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [total, setTotal]     = useState(0);
  const [page, setPage]       = useState(1);
  const [pageSize, setPageSize] = useState<10 | 25 | 50>(25);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate]     = useState('');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'DEBIT' | 'CREDIT'>('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const fetchTransactions = useCallback(async () => {
    if (!accountId) return;
    setLoading(true); setError(null);
    const params: Record<string, string> = { page: String(page), page_size: String(pageSize) };
    if (startDate) params['start_date'] = startDate;
    if (endDate)   params['end_date']   = endDate;
    if (minAmount) params['min_amount'] = minAmount;
    if (maxAmount) params['max_amount'] = maxAmount;
    if (typeFilter !== 'ALL') params['type'] = typeFilter;
    try {
      const res = await client.get<PaginatedResult>(`/accounts/${accountId}/transactions`, { params });
      setTransactions(res.data.data);
      setTotal(res.data.total);
    } catch (err: unknown) {
      const status = (err as { response?: { status: number } }).response?.status ?? 0;
      setError(status === 403 ? 'Access denied.' : 'Failed to load transactions. Please try again.');
    } finally { setLoading(false); }
  }, [accountId, page, pageSize, startDate, endDate, minAmount, maxAmount, typeFilter]);

  useEffect(() => { void fetchTransactions(); }, [fetchTransactions]);

  async function handleExport() {
    if (!accountId) return;
    setExporting(true);
    try {
      const params: Record<string, string> = {};
      if (startDate) params['start_date'] = startDate;
      if (endDate)   params['end_date']   = endDate;
      const res = await client.get<string>(`/accounts/${accountId}/transactions/export`, { params, responseType: 'blob' });
      const disposition = (res.headers as Record<string, string>)['content-disposition'] ?? '';
      const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'transactions.csv';
      const url = URL.createObjectURL(new Blob([res.data as unknown as BlobPart], { type: 'text/csv' }));
      const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    } catch { setError('Export failed. Please try again.'); }
    finally { setExporting(false); }
  }

  const totalPages = Math.ceil(total / pageSize);
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd   = Math.min(page * pageSize, total);
  const hasFilters = !!(startDate || endDate || minAmount || maxAmount || typeFilter !== 'ALL');

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Transaction History</div>
          <div className="page-subtitle">
            {!loading && total > 0 ? `${total} transaction${total !== 1 ? 's' : ''} found` : 'Filter and export your statement'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn-ghost" onClick={() => navigate('/dashboard')}>
            <span className="ms" style={{ fontSize: 18 }}>arrow_back</span>
            Dashboard
          </button>
          <button className="btn-primary" style={{ width: 'auto', padding: '10px 20px' }}
            onClick={() => void handleExport()} disabled={exporting || loading || total === 0}>
            {exporting
              ? <><div className="spinner" />&nbsp;Exporting…</>
              : <><span className="ms" style={{ fontSize: 18 }}>download</span>Export CSV</>}
          </button>
        </div>
      </div>

      <div className="page-body">
        {/* Filters */}
        <div className="sand-card" style={{ padding: '18px 22px', marginBottom: 20 }}>
          <div style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--outline)',
            letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 14 }}>
            Filters
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-end' }}>
            {[
              { id: 'sd', label: 'From', type: 'date', value: startDate, set: (v: string) => { setStartDate(v); setPage(1); } },
              { id: 'ed', label: 'To',   type: 'date', value: endDate,   set: (v: string) => { setEndDate(v);   setPage(1); } },
            ].map((f) => (
              <div key={f.id} className="form-field" style={{ minWidth: 140 }}>
                <label className="sb-label" htmlFor={f.id}>{f.label}</label>
                <input id={f.id} className="sb-input-filled" type={f.type}
                  value={f.value} onChange={(e) => f.set(e.target.value)} />
              </div>
            ))}
            {[
              { id: 'mn', label: 'Min ₹', val: minAmount, set: (v: string) => { setMinAmount(v); setPage(1); }, ph: '0' },
              { id: 'mx', label: 'Max ₹', val: maxAmount, set: (v: string) => { setMaxAmount(v); setPage(1); }, ph: 'Any' },
            ].map((f) => (
              <div key={f.id} className="form-field" style={{ minWidth: 100 }}>
                <label className="sb-label" htmlFor={f.id}>{f.label}</label>
                <input id={f.id} className="sb-input-filled" type="number" min={0}
                  placeholder={f.ph} value={f.val} onChange={(e) => f.set(e.target.value)} />
              </div>
            ))}
            <div className="form-field" style={{ minWidth: 120 }}>
              <label className="sb-label" htmlFor="tf">Type</label>
              <select id="tf" className="sb-select"
                value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value as 'ALL' | 'DEBIT' | 'CREDIT'); setPage(1); }}>
                <option value="ALL">All</option>
                <option value="DEBIT">Debit</option>
                <option value="CREDIT">Credit</option>
              </select>
            </div>
            <div className="form-field" style={{ minWidth: 110 }}>
              <label className="sb-label" htmlFor="ps">Per page</label>
              <select id="ps" className="sb-select"
                value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value) as 10 | 25 | 50); setPage(1); }}>
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
              </select>
            </div>
            {hasFilters && (
              <button className="btn-ghost" style={{ alignSelf: 'flex-end' }}
                onClick={() => { setStartDate(''); setEndDate(''); setMinAmount(''); setMaxAmount(''); setTypeFilter('ALL'); setPage(1); }}>
                <span className="ms" style={{ fontSize: 16 }}>close</span>
                Clear
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="alert alert-error" style={{ marginBottom: 16 }} role="alert">
            <span className="ms" style={{ fontSize: 18, flexShrink: 0 }}>error</span> {error}
          </div>
        )}

        {/* Table */}
        <div className="sand-card" style={{ overflow: 'hidden' }}>
          <table className="sb-table">
            <thead>
              <tr>
                <th>Date</th><th>Narration</th><th>Mode</th><th>Type</th>
                <th style={{ textAlign: 'right' }}>Amount (₹)</th>
                <th style={{ textAlign: 'right' }}>Balance (₹)</th>
              </tr>
            </thead>
            <tbody>
              {loading && Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)}
              {!loading && transactions.length === 0 && !error && (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '52px', color: 'var(--outline)' }}>
                    No transactions found for the selected filters.
                  </td>
                </tr>
              )}
              {!loading && transactions.map((tx) => (
                <tr key={tx.id}>
                  <td style={{ color: 'var(--on-surface-var)', whiteSpace: 'nowrap', fontSize: '0.85rem' }}>
                    {new Date(tx.transaction_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })}
                  </td>
                  <td style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {tx.narration ?? '—'}
                  </td>
                  <td>
                    <span style={{ fontSize: '0.68rem', padding: '2px 8px', borderRadius: 4,
                      background: 'var(--surface-highest)', color: 'var(--outline)', fontWeight: 600, letterSpacing: '0.04em' }}>
                      {tx.transfer_mode}
                    </span>
                  </td>
                  <td>
                    <span className={`badge ${tx.entry_type === 'CREDIT' ? 'badge-credit' : 'badge-debit'}`}>
                      {tx.entry_type}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 600,
                    color: tx.entry_type === 'CREDIT' ? 'var(--color-success)' : 'var(--color-danger)' }}>
                    {tx.entry_type === 'CREDIT' ? '+' : '−'}
                    {tx.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </td>
                  <td style={{ textAlign: 'right', color: 'var(--on-surface-var)', fontSize: '0.875rem' }}>
                    {tx.running_balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {!loading && totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--outline)' }}>
              Showing {rangeStart}–{rangeEnd} of {total}
            </span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button className="btn-ghost" style={{ padding: '6px 14px' }}
                onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
                ← Prev
              </button>
              <span style={{ fontSize: '0.875rem', color: 'var(--on-surface-var)', padding: '0 6px' }}>
                {page} / {totalPages}
              </span>
              <button className="btn-ghost" style={{ padding: '6px 14px' }}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
                Next →
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
