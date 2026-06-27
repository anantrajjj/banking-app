import { useState, useEffect } from 'react';
import client from '../api/client';
import { roleLabel } from '../store/userStore';

interface UserProfile {
  id: string;
  username: string;
  email: string;
  phone: string;
  role: 'CUSTOMER' | 'BRANCH_MANAGER' | 'ADMIN';
  otp_channel: 'EMAIL' | 'SMS';
  created_at: string;
}

function RoleBadge({ role }: { role: UserProfile['role'] }) {
  const map: Record<UserProfile['role'], { bg: string; color: string }> = {
    ADMIN:          { bg: 'rgba(186,26,26,0.10)',  color: 'var(--color-danger)' },
    BRANCH_MANAGER: { bg: 'rgba(34,64,154,0.10)',  color: 'var(--primary)' },
    CUSTOMER:       { bg: 'rgba(46,125,50,0.10)',  color: 'var(--color-success)' },
  };
  const s = map[role];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '4px 12px', borderRadius: 100,
      background: s.bg, color: s.color,
      fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase',
    }}>
      <span className="ms" style={{ fontSize: 14 }}>
        {role === 'ADMIN' ? 'shield' : role === 'BRANCH_MANAGER' ? 'badge' : 'person'}
      </span>
      {roleLabel(role)}
    </span>
  );
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);

  // Change password
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [pwLoading, setPwLoading] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSuccess, setPwSuccess] = useState(false);

  // OTP channel
  const [otpChannel, setOtpChannel] = useState<'EMAIL' | 'SMS'>('EMAIL');
  const [otpLoading, setOtpLoading] = useState(false);
  const [otpSuccess, setOtpSuccess] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await client.get<UserProfile>('/profile');
        setProfile(res.data);
        setOtpChannel(res.data.otp_channel);
      } catch {
        setProfileError('Failed to load profile.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault();
    setPwError(null); setPwSuccess(false);
    if (newPw !== confirmPw) { setPwError('New passwords do not match.'); return; }
    if (newPw.length < 8) { setPwError('New password must be at least 8 characters.'); return; }
    setPwLoading(true);
    try {
      await client.put('/profile/password', { current_password: currentPw, new_password: newPw });
      setPwSuccess(true);
      setCurrentPw(''); setNewPw(''); setConfirmPw('');
    } catch (err: unknown) {
      const code = (err as { response?: { data?: { code?: string } } }).response?.data?.code;
      if (code === 'INVALID_CREDENTIALS') setPwError('Current password is incorrect.');
      else setPwError('Failed to update password. Please try again.');
    } finally {
      setPwLoading(false);
    }
  }

  async function handleOtpChannelChange(channel: 'EMAIL' | 'SMS') {
    setOtpChannel(channel);
    setOtpLoading(true); setOtpSuccess(false);
    try {
      await client.put('/profile/otp-channel', { channel });
      setOtpSuccess(true);
      setTimeout(() => setOtpSuccess(false), 3000);
    } catch {
      // revert
      setOtpChannel(channel === 'EMAIL' ? 'SMS' : 'EMAIL');
    } finally {
      setOtpLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="page-body" style={{ paddingTop: 40 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 24 }}>
          {[1, 2].map((i) => (
            <div key={i} className="sand-card" style={{ padding: 28 }}>
              {Array.from({ length: 4 }).map((_, j) => (
                <div key={j} className="skeleton" style={{ height: 14, width: `${60 + j * 10}%`, marginBottom: 14 }} />
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (profileError || !profile) {
    return (
      <div className="page-body" style={{ paddingTop: 40 }}>
        <div className="alert alert-error">
          <span className="ms" style={{ fontSize: 18 }}>error</span>
          {profileError ?? 'Profile not available.'}
        </div>
      </div>
    );
  }

  const memberSince = new Date(profile.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">My Profile</div>
          <div className="page-subtitle">Manage your account details and security settings.</div>
        </div>
      </div>

      <div className="page-body">
        <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 24, alignItems: 'start' }}>

          {/* ── Left: Identity card ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Avatar + basic info */}
            <div className="sand-card" style={{ padding: '32px 24px', textAlign: 'center' }}>
              <div style={{
                width: 72, height: 72, borderRadius: '50%',
                background: 'var(--surface-highest)',
                border: '2px solid var(--sand-border)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                margin: '0 auto 16px',
              }}>
                <span className="ms filled" style={{ fontSize: 36, color: 'var(--primary)' }}>person</span>
              </div>
              <div style={{ fontFamily: 'Outfit', fontSize: '1.2rem', fontWeight: 600, color: 'var(--primary)', marginBottom: 6 }}>
                {profile.username}
              </div>
              <RoleBadge role={profile.role} />
              <div style={{ marginTop: 16, fontSize: '0.8rem', color: 'var(--outline)' }}>
                Member since {memberSince}
              </div>
            </div>

            {/* Contact details */}
            <div className="sand-card" style={{ padding: '20px 22px' }}>
              <div style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--outline)', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 14 }}>Contact</div>
              {[
                { icon: 'mail', label: 'Email', value: profile.email },
                { icon: 'phone', label: 'Phone', value: profile.phone },
              ].map((item) => (
                <div key={item.label} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 14, paddingBottom: 14, borderBottom: '1px solid var(--outline-var)' }}>
                  <span className="ms" style={{ fontSize: 18, color: 'var(--outline)', marginTop: 1 }}>{item.icon}</span>
                  <div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--outline)', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 2 }}>{item.label}</div>
                    <div style={{ fontSize: '0.875rem', color: 'var(--on-surface)', wordBreak: 'break-all' }}>{item.value}</div>
                  </div>
                </div>
              ))}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <span className="ms" style={{ fontSize: 18, color: 'var(--outline)', marginTop: 1 }}>fingerprint</span>
                <div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--outline)', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 2 }}>User ID</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--on-surface-var)', fontFamily: 'monospace', wordBreak: 'break-all' }}>{profile.id}</div>
                </div>
              </div>
            </div>
          </div>

          {/* ── Right: Security + Preferences ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* Change password */}
            <div className="sand-card" style={{ padding: '24px 28px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 22 }}>
                <span className="ms filled" style={{ fontSize: 22, color: 'var(--primary)' }}>lock</span>
                <h2 style={{ fontSize: '1.05rem' }}>Change Password</h2>
              </div>

              {pwSuccess && (
                <div className="alert alert-success" style={{ marginBottom: 20 }}>
                  <span className="ms" style={{ fontSize: 18, flexShrink: 0 }}>check_circle</span>
                  Password updated successfully.
                </div>
              )}
              {pwError && (
                <div className="alert alert-error" style={{ marginBottom: 20 }}>
                  <span className="ms" style={{ fontSize: 18, flexShrink: 0 }}>error</span>
                  {pwError}
                </div>
              )}

              <form onSubmit={(e) => void handlePasswordChange(e)}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                  {/* Current password */}
                  <div className="form-field">
                    <label className="sb-label" htmlFor="cur-pw">Current Password</label>
                    <div style={{ position: 'relative' }}>
                      <input id="cur-pw" className="sb-input-filled" style={{ paddingRight: 40 }}
                        type={showCurrentPw ? 'text' : 'password'} value={currentPw}
                        onChange={(e) => setCurrentPw(e.target.value)} required />
                      <button type="button" onClick={() => setShowCurrentPw((v) => !v)}
                        style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--outline)', padding: 0 }}>
                        <span className="ms" style={{ fontSize: 20 }}>{showCurrentPw ? 'visibility' : 'visibility_off'}</span>
                      </button>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                    {/* New password */}
                    <div className="form-field">
                      <label className="sb-label" htmlFor="new-pw">New Password</label>
                      <div style={{ position: 'relative' }}>
                        <input id="new-pw" className="sb-input-filled" style={{ paddingRight: 40 }}
                          type={showNewPw ? 'text' : 'password'} value={newPw} minLength={8}
                          onChange={(e) => setNewPw(e.target.value)} required />
                        <button type="button" onClick={() => setShowNewPw((v) => !v)}
                          style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--outline)', padding: 0 }}>
                          <span className="ms" style={{ fontSize: 20 }}>{showNewPw ? 'visibility' : 'visibility_off'}</span>
                        </button>
                      </div>
                    </div>
                    {/* Confirm */}
                    <div className="form-field">
                      <label className="sb-label" htmlFor="conf-pw">Confirm New Password</label>
                      <input id="conf-pw" className="sb-input-filled"
                        type="password" value={confirmPw} minLength={8}
                        onChange={(e) => setConfirmPw(e.target.value)} required />
                    </div>
                  </div>

                  {/* Strength hint */}
                  {newPw.length > 0 && (
                    <div style={{ fontSize: '0.78rem', color: newPw.length >= 12 ? 'var(--color-success)' : newPw.length >= 8 ? 'var(--color-warning)' : 'var(--color-danger)', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span className="ms" style={{ fontSize: 15 }}>
                        {newPw.length >= 12 ? 'check_circle' : newPw.length >= 8 ? 'warning' : 'error'}
                      </span>
                      {newPw.length >= 12 ? 'Strong password' : newPw.length >= 8 ? 'Acceptable — try adding numbers and symbols' : 'Too short (8+ characters required)'}
                    </div>
                  )}
                </div>

                <button type="submit" className="btn-primary" disabled={pwLoading}
                  style={{ width: 'auto', padding: '11px 28px', marginTop: 22 }}>
                  {pwLoading ? <><div className="spinner" />&nbsp;Updating…</> : <>
                    <span className="ms" style={{ fontSize: 18 }}>lock_reset</span>
                    Update Password
                  </>}
                </button>
              </form>
            </div>

            {/* OTP channel preference */}
            <div className="sand-card" style={{ padding: '24px 28px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <span className="ms filled" style={{ fontSize: 22, color: 'var(--primary)' }}>shield_lock</span>
                <h2 style={{ fontSize: '1.05rem' }}>MFA Delivery Channel</h2>
                {otpLoading && <div className="spinner" style={{ borderTopColor: 'var(--primary)', borderColor: 'var(--outline-var)', marginLeft: 6 }} />}
                {otpSuccess && <span className="ms" style={{ fontSize: 18, color: 'var(--color-success)', marginLeft: 6 }}>check_circle</span>}
              </div>
              <p style={{ fontSize: '0.875rem', color: 'var(--on-surface-var)', marginBottom: 20, lineHeight: 1.6 }}>
                Choose how you receive one-time passwords during login.
              </p>
              <div style={{ display: 'flex', gap: 12 }}>
                {(['EMAIL', 'SMS'] as const).map((ch) => {
                  const active = otpChannel === ch;
                  return (
                    <button key={ch} disabled={otpLoading}
                      onClick={() => { if (!active) void handleOtpChannelChange(ch); }}
                      style={{
                        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                        padding: '14px 20px', borderRadius: 10, cursor: 'pointer',
                        border: `1.5px solid ${active ? 'var(--primary-container)' : 'var(--sand-border)'}`,
                        background: active ? 'rgba(34,64,154,0.08)' : 'var(--surface)',
                        color: active ? 'var(--primary)' : 'var(--on-surface-var)',
                        fontWeight: active ? 600 : 400, fontSize: '0.9rem',
                        transition: 'all var(--transition)',
                      }}>
                      <span className="ms filled" style={{ fontSize: 22, color: active ? 'var(--primary)' : 'var(--outline)' }}>
                        {ch === 'EMAIL' ? 'mail' : 'sms'}
                      </span>
                      <div style={{ textAlign: 'left' }}>
                        <div style={{ fontWeight: 600 }}>{ch === 'EMAIL' ? 'Email' : 'SMS'}</div>
                        <div style={{ fontSize: '0.75rem', color: active ? 'var(--on-primary-container)' : 'var(--outline)', marginTop: 1 }}>
                          {ch === 'EMAIL' ? 'Sent to registered email' : 'Sent to registered phone'}
                        </div>
                      </div>
                      {active && <span className="ms filled" style={{ fontSize: 18, marginLeft: 'auto', color: 'var(--primary)' }}>radio_button_checked</span>}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Security info */}
            <div className="sand-card" style={{ padding: '20px 24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                <span className="ms filled" style={{ fontSize: 20, color: 'var(--outline)' }}>security</span>
                <h2 style={{ fontSize: '0.95rem', color: 'var(--on-surface-var)' }}>Security Info</h2>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[
                  { icon: 'encrypted', label: 'Encryption', value: 'AES-256 at rest · TLS 1.3 in transit' },
                  { icon: 'verified_user', label: 'Authentication', value: 'JWT + bcrypt (cost 12) + MFA' },
                  { icon: 'policy', label: 'Session', value: '15-minute access tokens · 7-day refresh tokens' },
                ].map((item) => (
                  <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className="ms" style={{ fontSize: 16, color: 'var(--outline)', flexShrink: 0 }}>{item.icon}</span>
                    <span style={{ fontSize: '0.78rem', color: 'var(--on-surface-var)' }}>
                      <strong style={{ color: 'var(--outline)', fontWeight: 600, marginRight: 6 }}>{item.label}:</strong>
                      {item.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>

          </div>
        </div>
      </div>
    </>
  );
}
