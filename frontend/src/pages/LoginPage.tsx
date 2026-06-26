import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import client from '../api/client';
import { setSession } from '../store/authStore';

type Step = 'password' | 'otp';
interface LoginResponse { mfa_challenge_id: string; otp_channel: 'EMAIL' | 'SMS'; }
interface TokenResponse { access_token: string; refresh_token: string; expires_in: number; }

export default function LoginPage() {
  const navigate = useNavigate();
  const [step, setStep]               = useState<Step>('password');
  const [username, setUsername]       = useState('');
  const [password, setPassword]       = useState('');
  const [showPass, setShowPass]       = useState(false);
  const [otp, setOtp]                 = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [otpChannel, setOtpChannel]   = useState<'EMAIL' | 'SMS'>('EMAIL');
  const [error, setError]             = useState<string | null>(null);
  const [loading, setLoading]         = useState(false);

  function mapLoginError(status: number): string {
    if (status === 423) return 'Your account has been locked. Please contact support.';
    if (status === 429) return 'Too many login attempts. Please try again later.';
    return 'Invalid credentials. Please try again.';
  }

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await client.post<LoginResponse>('/auth/login', { username, password });
      setChallengeId(res.data.mfa_challenge_id);
      setOtpChannel(res.data.otp_channel);
      setStep('otp');
    } catch (err: unknown) {
      const status = (err as { response?: { status: number } }).response?.status ?? 0;
      setError(mapLoginError(status));
    } finally {
      setLoading(false);
    }
  }

  async function handleOtpSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await client.post<TokenResponse>('/auth/mfa', {
        mfa_challenge_id: challengeId,
        otp,
      });
      setSession(res.data.access_token, res.data.refresh_token);
      navigate('/dashboard');
    } catch (err: unknown) {
      const status = (err as { response?: { status: number } }).response?.status ?? 0;
      if (status === 401) {
        setError('Invalid or expired OTP. Please start over.');
        setStep('password');
        setOtp('');
        setChallengeId('');
      } else {
        setError('An error occurred. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--sand-base)', padding: '16px',
    }}>
      {/* Outer card — split layout */}
      <div style={{
        width: '100%', maxWidth: 1100, minHeight: 620,
        display: 'flex', borderRadius: 20, overflow: 'hidden',
        background: 'var(--sand-card)', border: '1px solid var(--sand-border)',
        boxShadow: '0 8px 40px rgba(107,107,99,0.12)',
      }}>

        {/* ── Left panel: Branding & features ── */}
        <section style={{
          display: 'none',
          flex: 1,
          background: 'var(--surface-high)',
          borderRight: '1px solid var(--sand-border)',
          padding: '48px 40px',
          flexDirection: 'column',
          justifyContent: 'space-between',
        }}
          className="login-left-panel"
        >
          {/* Brand */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="ms filled" style={{ fontSize: 30, color: 'var(--primary)' }}>
              account_balance
            </span>
            <span style={{ fontFamily: 'Outfit', fontSize: '1.3rem', fontWeight: 600, color: 'var(--primary)' }}>
              SecureBank
            </span>
          </div>

          {/* Centre copy */}
          <div>
            <p style={{ fontFamily: 'Outfit', fontSize: '1.5rem', fontWeight: 600,
              color: 'var(--primary)', lineHeight: 1.3, maxWidth: 320, marginBottom: 12 }}>
              Curated wealth management for the modern portfolio.
            </p>
            <p style={{ fontSize: '0.875rem', color: 'var(--on-surface-var)', maxWidth: 300, lineHeight: 1.6 }}>
              Quietly confident. Remarkably precise.
            </p>
          </div>

          {/* Feature tiles */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[
              { icon: 'lock', label: 'Security', desc: '256-bit AES encryption & MFA' },
              { icon: 'trending_up', label: 'Analytics', desc: 'Real-time portfolio tracking' },
              { icon: 'language', label: 'Access', desc: 'Secure banking from anywhere' },
            ].map((f) => (
              <div key={f.icon} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '12px 16px',
                background: 'rgba(255,255,255,0.5)', borderRadius: 10,
                border: '1px solid var(--glass-border)',
              }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 8,
                  background: 'var(--surface-low)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <span className="ms filled" style={{ fontSize: 18, color: 'var(--primary)' }}>{f.icon}</span>
                </div>
                <div>
                  <div style={{ fontSize: '0.72rem', fontWeight: 600, letterSpacing: '0.06em',
                    textTransform: 'uppercase', color: 'var(--on-surface-var)', marginBottom: 1 }}>{f.label}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--outline)' }}>{f.desc}</div>
                </div>
              </div>
            ))}
          </div>

          <p style={{ fontSize: '0.72rem', color: 'var(--outline)' }}>
            © 2025 SecureBank. All rights reserved.
          </p>
        </section>

        {/* ── Right panel: Login form ── */}
        <section style={{
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '48px 40px', background: 'var(--surface)',
        }}>
          <div style={{ width: '100%', maxWidth: 380 }}>

            {/* Brand — only visible when left panel is hidden (mobile) */}
            <div className="login-brand-mobile"
              style={{ alignItems: 'center', gap: 8, marginBottom: 32 }}>
              <span className="ms filled" style={{ fontSize: 24, color: 'var(--primary)' }}>
                account_balance
              </span>
              <span style={{ fontFamily: 'Outfit', fontSize: '1.1rem', fontWeight: 600, color: 'var(--primary)' }}>
                SecureBank
              </span>
            </div>

            {step === 'password' && (
              <>
                <h1 style={{ marginBottom: 6, fontSize: '2rem' }}>Welcome back</h1>
                <p style={{ fontSize: '0.95rem', color: 'var(--on-surface-var)', marginBottom: 32, lineHeight: 1.5 }}>
                  Sign in to access your private banking portal.
                </p>

                {error && (
                  <div className="alert alert-error" style={{ marginBottom: 24 }} role="alert">
                    <span className="ms" style={{ fontSize: 18, flexShrink: 0 }}>error</span>
                    {error}
                  </div>
                )}

                <form onSubmit={handlePasswordSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                  <div className="form-field">
                    <label className="sb-label" htmlFor="username">Client ID or Username</label>
                    <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-end' }}>
                      <span className="ms" style={{ fontSize: 20, color: 'var(--outline)', marginRight: 8, marginBottom: 10 }}>
                        person
                      </span>
                      <input
                        id="username"
                        className="sb-input"
                        style={{ flex: 1 }}
                        type="text"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        placeholder="Enter your username"
                        required
                        autoComplete="username"
                        aria-required="true"
                      />
                    </div>
                  </div>

                  <div className="form-field">
                    <label className="sb-label" htmlFor="password">Password</label>
                    <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-end' }}>
                      <span className="ms" style={{ fontSize: 20, color: 'var(--outline)', marginRight: 8, marginBottom: 10 }}>
                        key
                      </span>
                      <input
                        id="password"
                        className="sb-input"
                        style={{ flex: 1 }}
                        type={showPass ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••"
                        required
                        autoComplete="current-password"
                        aria-required="true"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPass((v) => !v)}
                        style={{ position: 'absolute', right: 0, bottom: 8, background: 'none', border: 'none',
                          cursor: 'pointer', color: 'var(--outline)', padding: 0 }}
                        aria-label={showPass ? 'Hide password' : 'Show password'}
                      >
                        <span className="ms" style={{ fontSize: 20 }}>
                          {showPass ? 'visibility' : 'visibility_off'}
                        </span>
                      </button>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                    <button className="btn-primary" type="submit" disabled={loading} style={{ flex: 2 }}>
                      {loading
                        ? <><div className="spinner" />&nbsp;Signing in…</>
                        : <>Sign In <span className="ms" style={{ fontSize: 18 }}>arrow_forward</span></>
                      }
                    </button>
                  </div>

                  <div style={{ position: 'relative', textAlign: 'center', margin: '0' }}>
                    <div style={{ borderTop: '1px solid var(--outline-var)', position: 'absolute', left: 0, right: 0, top: '50%' }} />
                    <span style={{ position: 'relative', background: 'var(--surface)', padding: '0 12px',
                      fontSize: '0.7rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--outline)' }}>
                      or
                    </span>
                  </div>

                  <button className="btn-secondary" type="button" style={{ gap: 8 }}>
                    <span className="ms" style={{ fontSize: 18 }}>fingerprint</span>
                    Sign in with Biometrics
                  </button>
                </form>
              </>
            )}

            {step === 'otp' && (
              <>
                <div style={{ textAlign: 'center', marginBottom: 28 }}>
                  <div style={{ width: 64, height: 64, borderRadius: '50%',
                    background: 'var(--sand-card)', border: '1px solid var(--sand-border)',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                    <span className="ms filled" style={{ fontSize: 30, color: 'var(--primary)' }}>
                      shield_lock
                    </span>
                  </div>
                  <h1 style={{ fontSize: '1.75rem', marginBottom: 8 }}>Verify Identity</h1>
                  <p style={{ fontSize: '0.9rem', color: 'var(--on-surface-var)', lineHeight: 1.5 }}>
                    A 6-digit code was sent to your registered{' '}
                    <strong style={{ color: 'var(--primary)' }}>
                      {otpChannel === 'SMS' ? 'phone number' : 'email address'}
                    </strong>
                  </p>
                </div>

                {error && (
                  <div className="alert alert-error" style={{ marginBottom: 24 }} role="alert">
                    <span className="ms" style={{ fontSize: 18, flexShrink: 0 }}>error</span>
                    {error}
                  </div>
                )}

                <form onSubmit={handleOtpSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                  <div className="form-field">
                    <label className="sb-label" htmlFor="otp" style={{ textAlign: 'center' }}>
                      One-Time Password
                    </label>
                    <input
                      id="otp"
                      className="otp-input"
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      value={otp}
                      onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                      placeholder="· · · · · ·"
                      required
                      autoComplete="one-time-code"
                      aria-required="true"
                    />
                  </div>

                  <button className="btn-primary" type="submit" disabled={loading || otp.length < 6}>
                    {loading
                      ? <><div className="spinner" />&nbsp;Verifying…</>
                      : <>Verify & Continue <span className="ms" style={{ fontSize: 18 }}>arrow_forward</span></>
                    }
                  </button>

                  <button
                    type="button"
                    className="btn-ghost"
                    style={{ justifyContent: 'center', width: '100%' }}
                    onClick={() => { setStep('password'); setError(null); setOtp(''); }}
                  >
                    <span className="ms" style={{ fontSize: 16 }}>arrow_back</span>
                    Use a different account
                  </button>
                </form>
              </>
            )}

            <p style={{ textAlign: 'center', fontSize: '0.72rem', color: 'var(--outline)', marginTop: 28 }}>
              Protected by AES-256 encryption · MFA required
            </p>
          </div>
        </section>
      </div>

      {/* Show left panel on wider screens via inline media-safe approach */}
      <style>{`
        @media (min-width: 900px) {
          .login-left-panel { display: flex !important; }
        }
      `}</style>
    </div>
  );
}
