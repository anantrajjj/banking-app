import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import client from '../api/client';

interface EligibilityResult {
  application_id: string;
  decision: 'APPROVED' | 'REJECTED' | 'PENDING';
  calculated_emi: number;
  total_emi_burden?: number;
  gross_monthly_income?: number;
  existing_emi?: number;
  loan_amount?: number;
  tenure_months?: number;
  annual_interest_rate?: number;
  total_payable: number;
  effective_rate?: number;
  rejection_reason: string | null;
}
interface ValidationDetail { field: string; message: string; }
interface ErrorResponse {
  code: string;
  detail?: { invalid_fields?: string[] } | ValidationDetail[];
  details?: ValidationDetail[];
}

function Field({
  id, label, value, onChange, min, step, error, placeholder,
}: {
  id: string; label: string; value: string; onChange: (v: string) => void;
  min?: string; step?: string; error?: boolean; placeholder?: string;
}) {
  return (
    <div className="form-field">
      <label className="sb-label" htmlFor={id}>{label}</label>
      <input id={id} className="sb-input" type="number"
        min={min} step={step ?? '0.01'} placeholder={placeholder ?? '0'}
        value={value} onChange={(e) => onChange(e.target.value)}
        required aria-required="true"
        style={error ? { borderBottomColor: 'var(--color-danger)' } : undefined}
      />
      {error && (
        <span style={{ fontSize: '0.72rem', color: 'var(--color-danger)', marginTop: 2 }}>
          Required · must be valid
        </span>
      )}
    </div>
  );
}

function BreakdownRow({ label, value, large }: { label: string; value: string; large?: boolean }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '12px 0', borderBottom: '1px solid var(--outline-var)',
    }}>
      <span style={{ fontSize: '0.9rem', color: 'var(--on-surface-var)' }}>{label}</span>
      <span style={{
        fontSize: large ? '1.2rem' : '0.9rem',
        fontWeight: large ? 600 : 500,
        fontFamily: large ? 'Outfit' : 'Inter',
        color: 'var(--primary)',
      }}>
        {value}
      </span>
    </div>
  );
}

export default function LoanEligibilityPage() {
  const navigate = useNavigate();
  const [grossIncome, setGrossIncome] = useState('');
  const [existingEmi, setExistingEmi]   = useState('');
  const [loanAmount, setLoanAmount]     = useState('');
  const [tenureMonths, setTenureMonths] = useState('');
  const [annualRate, setAnnualRate]     = useState('');
  const [result, setResult]             = useState<EligibilityResult | null>(null);
  const [error, setError]               = useState<string | null>(null);
  const [fieldErrors, setFieldErrors]   = useState<Set<string>>(new Set());
  const [loading, setLoading]           = useState(false);
  const [panelVisible, setPanelVisible] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setFieldErrors(new Set()); setLoading(true);
    setPanelVisible(false);
    try {
      const res = await client.post<EligibilityResult>('/loans/eligibility', {
        gross_monthly_income:  parseFloat(grossIncome),
        existing_emi:          parseFloat(existingEmi),
        loan_amount:           parseFloat(loanAmount),
        tenure_months:         parseInt(tenureMonths, 10),
        annual_interest_rate:  parseFloat(annualRate),
      });
      setResult(res.data);
      // Small delay to trigger fade-in
      setTimeout(() => setPanelVisible(true), 50);
    } catch (err: unknown) {
      const status = (err as { response?: { status: number; data?: ErrorResponse } }).response?.status ?? 0;
      const data   = (err as { response?: { data?: ErrorResponse } }).response?.data;
      if (status === 400) {
        const fields = new Set<string>();
        if (data?.detail && typeof data.detail === 'object' && 'invalid_fields' in data.detail)
          ((data.detail as { invalid_fields: string[] }).invalid_fields).forEach((f) => fields.add(f));
        else if (Array.isArray(data?.details))
          (data.details as ValidationDetail[]).forEach((d) => fields.add(d.field));
        else if (Array.isArray(data?.detail))
          (data.detail as ValidationDetail[]).forEach((d) => fields.add(d.field));
        fields.size ? setFieldErrors(fields) : setError('Invalid input. Please check all fields.');
      } else if (status === 500) {
        setError('Server error — application saved as Pending. Please try again.');
      } else {
        setError('An error occurred. Please try again.');
      }
    } finally { setLoading(false); }
  }

  const fe = (k: string) => fieldErrors.has(k);
  const displayIncome  = result?.gross_monthly_income  ?? parseFloat(grossIncome  || '0');
  const displayBurden  = result?.total_emi_burden       ?? ((result?.calculated_emi ?? 0) + parseFloat(existingEmi || '0'));
  const burdenPct      = displayIncome > 0 ? ((displayBurden / displayIncome) * 100).toFixed(1) : '—';

  const approved = result?.decision === 'APPROVED';
  const rejected = result?.decision === 'REJECTED';

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Loan Eligibility</div>
          <div className="page-subtitle">
            Discover your borrowing potential with our tailored eligibility calculator
          </div>
        </div>
      </div>

      <div className="page-body">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 24, alignItems: 'start' }}>

          {/* ── Calculator form — col 7 ── */}
          <div className="sand-card" style={{ gridColumn: 'span 7', padding: '40px' }}>
            <form onSubmit={handleSubmit}>
              {/* Section: Financial Profile */}
              <div style={{ marginBottom: 32 }}>
                <h2 style={{ marginBottom: 24 }}>Financial Profile</h2>
                {error && (
                  <div className="alert alert-error" style={{ marginBottom: 24 }} role="alert">
                    <span className="ms" style={{ fontSize: 18, flexShrink: 0 }}>error</span>
                    {error}
                  </div>
                )}
                <div className="grid-2">
                  <Field id="gross-income" label="Gross Monthly Income (₹)"
                    value={grossIncome} onChange={setGrossIncome}
                    min="1" placeholder="e.g. 150000"
                    error={fe('grossMonthlyIncome') || fe('gross_monthly_income')} />
                  <Field id="existing-emi" label="Existing Monthly EMIs (₹)"
                    value={existingEmi} onChange={setExistingEmi}
                    min="0" placeholder="0 if none"
                    error={fe('existingEmi') || fe('existing_emi')} />
                </div>
              </div>

              <div style={{ borderTop: '1px solid var(--outline-var)', marginBottom: 32 }} />

              {/* Section: Loan Requirements */}
              <div style={{ marginBottom: 32 }}>
                <h2 style={{ marginBottom: 24 }}>Loan Requirements</h2>
                <div className="grid-2" style={{ marginBottom: 20 }}>
                  <Field id="loan-amount" label="Desired Loan Amount (₹)"
                    value={loanAmount} onChange={setLoanAmount}
                    min="1" placeholder="e.g. 500000"
                    error={fe('loanAmount') || fe('loan_amount')} />
                  <Field id="tenure" label="Tenure (months)"
                    value={tenureMonths} onChange={setTenureMonths}
                    min="1" step="1" placeholder="e.g. 60"
                    error={fe('tenureMonths') || fe('tenure_months')} />
                </div>
                <Field id="rate" label="Annual Interest Rate (%)"
                  value={annualRate} onChange={setAnnualRate}
                  min="0.01" step="0.01" placeholder="e.g. 10.5"
                  error={fe('annualInterestRate') || fe('annual_interest_rate')} />
              </div>

              <button className="btn-primary" type="submit" disabled={loading}>
                {loading
                  ? <><div className="spinner" /> Assessing eligibility…</>
                  : <>Assess Eligibility <span className="ms" style={{ fontSize: 18 }}>arrow_forward</span></>}
              </button>
            </form>
          </div>

          {/* ── Results panel — col 5 ── */}
          <div style={{ gridColumn: 'span 5' }}>
            {!result ? (
              /* Awaiting state */
              <div className="glass" style={{
                padding: '48px 32px', textAlign: 'center', minHeight: 400,
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              }}>
                <div style={{
                  width: 80, height: 80, borderRadius: '50%',
                  background: 'var(--surface-high)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20,
                }}>
                  <span className="ms" style={{ fontSize: 40, color: 'var(--outline)' }}>analytics</span>
                </div>
                <h3 style={{ marginBottom: 10, color: 'var(--primary)' }}>Awaiting Details</h3>
                <p style={{ fontSize: '0.9rem', color: 'var(--on-surface-var)', lineHeight: 1.6, maxWidth: 260 }}>
                  Complete the form to view your personalised loan eligibility assessment.
                </p>
                <p style={{ fontSize: '0.75rem', color: 'var(--outline)', marginTop: 16, fontFamily: 'monospace' }}>
                  EMI = P × r × (1+r)^n / ((1+r)^n − 1)
                </p>
              </div>
            ) : (
              /* Result state */
              <div style={{ opacity: panelVisible ? 1 : 0, transition: 'opacity 0.4s ease' }}>
                {/* Decision banner */}
                <div style={{
                  background: approved ? 'rgba(46,125,50,0.08)' : rejected ? 'rgba(186,26,26,0.08)' : 'rgba(122,89,0,0.08)',
                  border: `1px solid ${approved ? 'rgba(46,125,50,0.25)' : rejected ? 'rgba(186,26,26,0.25)' : 'rgba(122,89,0,0.25)'}`,
                  borderRadius: 'var(--radius-lg)', padding: '20px 24px', marginBottom: 16,
                  display: 'flex', alignItems: 'center', gap: 16,
                }}>
                  <div style={{
                    width: 56, height: 56, borderRadius: '50%', flexShrink: 0,
                    background: approved ? 'rgba(254,212,136,0.25)' : rejected ? 'rgba(186,26,26,0.12)' : 'rgba(122,89,0,0.1)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <span className="ms filled" style={{
                      fontSize: 28,
                      color: approved ? 'var(--secondary)' : rejected ? 'var(--color-danger)' : 'var(--color-warning)',
                    }}>
                      {approved ? 'check_circle' : rejected ? 'cancel' : 'pending'}
                    </span>
                  </div>
                  <div>
                    <div style={{
                      fontFamily: 'Outfit', fontSize: '1.4rem', fontWeight: 600,
                      color: approved ? 'var(--primary)' : rejected ? 'var(--color-danger)' : 'var(--color-warning)',
                      marginBottom: 4,
                    }}>
                      {approved ? 'High Probability' : rejected ? 'Not Eligible' : 'Pending Review'}
                    </div>
                    <p style={{ fontSize: '0.85rem', color: 'var(--on-surface-var)', lineHeight: 1.5 }}>
                      {approved
                        ? 'Based on your profile, you are well-positioned for this facility.'
                        : rejected && result.rejection_reason
                        ? result.rejection_reason
                        : 'Your application is under review.'}
                    </p>
                  </div>
                </div>

                {/* Breakdown card */}
                <div className="sand-card" style={{ padding: '24px' }}>
                  <p className="sb-label" style={{ marginBottom: 4 }}>EMI Breakdown</p>
                  <BreakdownRow label="Estimated Monthly EMI"
                    value={`₹${result.calculated_emi.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`}
                    large />
                  <BreakdownRow label="Total EMI Burden"
                    value={`₹${displayBurden.toLocaleString('en-IN', { minimumFractionDigits: 2 })} (${burdenPct}% of income)`} />
                  <BreakdownRow label="Total Payable"
                    value={`₹${result.total_payable.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`} />
                  <BreakdownRow label="Annual Interest Rate"
                    value={`${result.annual_interest_rate ?? annualRate}%`} />
                  <BreakdownRow label="Tenure"
                    value={`${result.tenure_months ?? tenureMonths} months`} />

                  {approved && (
                    <button className="btn-secondary" style={{ marginTop: 20 }}
                      onClick={() => navigate('/dashboard')}>
                      <span className="ms" style={{ fontSize: 18 }}>calendar_today</span>
                      Schedule Consultation
                    </button>
                  )}

                  <p style={{ marginTop: 16, fontSize: '0.68rem', color: 'var(--outline)',
                    fontFamily: 'monospace', textAlign: 'right' }}>
                    App ID: {result.application_id}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
