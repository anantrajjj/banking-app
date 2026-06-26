import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { clearAccessToken } from '../store/authStore';
import client from '../api/client';

const NAV = [
  { path: '/dashboard',    icon: 'dashboard',              label: 'Dashboard'        },
  { path: '/transfer',     icon: 'payments',               label: 'Fund Transfer'    },
  { path: '/loan',         icon: 'account_balance_wallet', label: 'Loan Eligibility' },
];

const PAGE_TITLES: Record<string, string> = {
  '/dashboard':    'Dashboard',
  '/transfer':     'Fund Transfer',
  '/loan':         'Loan Eligibility',
  '/transactions': 'Transaction History',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();

  const pageTitle = Object.entries(PAGE_TITLES).find(([k]) =>
    location.pathname === k || location.pathname.startsWith(k + '/')
  )?.[1] ?? 'SecureBank';

  async function handleLogout() {
    try { await client.post('/auth/logout'); } catch { /* ignore */ }
    clearAccessToken();
    navigate('/login');
  }

  return (
    /* Full-height flex row — sidebar + content side by side */
    <div style={{ display: 'flex', flex: 1, minHeight: '100vh' }}>

      {/* ── Sidebar ── */}
      <nav className="app-sidebar" style={{
        position: 'fixed', left: 0, top: 0, bottom: 0, width: 256,
        background: 'var(--surface-low)',
        borderRight: '1px solid var(--outline-var)',
        display: 'flex', flexDirection: 'column',
        padding: '28px 16px',
        zIndex: 100,
      }}>
        {/* Brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0 8px 24px' }}>
          <span className="ms filled" style={{ fontSize: 26, color: 'var(--primary)', flexShrink: 0 }}>
            account_balance
          </span>
          <div>
            <div style={{ fontFamily: 'Outfit', fontSize: '1rem', fontWeight: 600, color: 'var(--primary)', lineHeight: 1.2 }}>
              Aura Private
            </div>
            <div style={{ fontSize: '0.68rem', color: 'var(--outline)', letterSpacing: '0.04em', marginTop: 1 }}>
              Wealth Management
            </div>
          </div>
        </div>

        {/* Nav links */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {NAV.map((item) => {
            const active =
              location.pathname === item.path ||
              (item.path === '/dashboard' && location.pathname.startsWith('/transactions'));
            return (
              <button
                key={item.path}
                className={`nav-item${active ? ' active' : ''}`}
                onClick={() => navigate(item.path)}
              >
                <span className={`ms nav-icon${active ? ' filled' : ''}`}>{item.icon}</span>
                {item.label}
              </button>
            );
          })}
        </div>

        {/* Bottom actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <button
            className="btn-primary"
            style={{ marginBottom: 12, fontSize: '0.72rem', padding: '11px 16px' }}
          >
            <span className="ms" style={{ fontSize: 16 }}>add</span>
            Open New Account
          </button>
          <div className="divider" style={{ marginBottom: 8 }} />
          <button className="nav-item" aria-label="Support">
            <span className="ms nav-icon">help_outline</span>
            Support
          </button>
          <button className="nav-item" onClick={() => void handleLogout()}>
            <span className="ms nav-icon">logout</span>
            Sign Out
          </button>
        </div>
      </nav>

      {/* ── Main column (offset by sidebar width) ── */}
      <div className="app-main" style={{ marginLeft: 256, flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>

        {/* Sticky top bar */}
        <header style={{
          position: 'sticky', top: 0, zIndex: 30,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '0 48px',
          height: 60,
          background: 'rgba(246,244,234,0.88)',
          backdropFilter: 'blur(14px)',
          WebkitBackdropFilter: 'blur(14px)',
          borderBottom: '1px solid var(--outline-var)',
        }}>
          <span style={{ fontFamily: 'Outfit', fontSize: '1.05rem', fontWeight: 500, color: 'var(--primary)' }}>
            {pageTitle}
          </span>

          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {/* Icon buttons */}
            {(['search', 'notifications'] as const).map((icon) => (
              <button key={icon}
                aria-label={icon}
                style={{
                  width: 36, height: 36, borderRadius: '50%', border: 'none',
                  background: 'transparent', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'var(--on-surface-var)',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-high)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <span className="ms" style={{ fontSize: 20 }}>{icon}</span>
              </button>
            ))}

            {/* Avatar */}
            <div style={{
              width: 34, height: 34, borderRadius: '50%', marginLeft: 8,
              background: 'var(--primary-container)',
              border: '1.5px solid var(--outline-var)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span className="ms filled" style={{ fontSize: 17, color: 'var(--on-primary-container)' }}>
                person
              </span>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main style={{ flex: 1 }}>
          {children}
        </main>
      </div>
    </div>
  );
}
