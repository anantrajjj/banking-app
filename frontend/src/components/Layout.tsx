import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { clearAccessToken, getRefreshToken, getAccessToken, subscribeToToken } from '../store/authStore';
import { getUserRole, isAtLeast } from '../store/userStore';
import client from '../api/client';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Notification {
  id: string;
  type: 'LARGE_DEBIT' | 'LOAN_APPROVED' | 'LOAN_REJECTED' | 'BENEFICIARY_VERIFIED' | 'LOW_BALANCE';
  title: string;
  message: string;
  created_at: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const NOTIF_SEEN_KEY = 'sb_notif_last_seen';
const POLL_INTERVAL = 60_000;

function notifIcon(type: Notification['type']): string {
  switch (type) {
    case 'LARGE_DEBIT':         return 'trending_down';
    case 'LOAN_APPROVED':       return 'check_circle';
    case 'LOAN_REJECTED':       return 'cancel';
    case 'BENEFICIARY_VERIFIED': return 'how_to_reg';
    case 'LOW_BALANCE':         return 'account_balance_wallet';
    default:                    return 'notifications';
  }
}

function notifColor(type: Notification['type']): string {
  switch (type) {
    case 'LARGE_DEBIT':   return 'var(--color-danger)';
    case 'LOAN_APPROVED': return 'var(--color-success)';
    case 'LOAN_REJECTED': return 'var(--color-danger)';
    case 'BENEFICIARY_VERIFIED': return 'var(--color-success)';
    case 'LOW_BALANCE':   return 'var(--color-warning)';
    default:              return 'var(--outline)';
  }
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ─── Nav items ────────────────────────────────────────────────────────────────

const BASE_NAV = [
  { path: '/dashboard',    icon: 'dashboard',              label: 'Dashboard'        },
  { path: '/beneficiaries', icon: 'people',                label: 'Beneficiaries'    },
  { path: '/transfer',     icon: 'payments',               label: 'Fund Transfer'    },
  { path: '/loan',         icon: 'account_balance_wallet', label: 'Loan Eligibility' },
];

const PAGE_TITLES: Record<string, string> = {
  '/dashboard':     'Dashboard',
  '/transfer':      'Fund Transfer',
  '/loan':          'Loan Eligibility',
  '/transactions':  'Transaction History',
  '/beneficiaries': 'Beneficiaries',
  '/profile':       'My Profile',
  '/admin':         'Admin Panel',
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function Layout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();

  // Track token for role-based nav
  const [token, setToken] = useState<string | null>(getAccessToken());
  useEffect(() => subscribeToToken(() => setToken(getAccessToken())), []);

  const role = getUserRole(token);
  const showAdmin = isAtLeast(token, 'BRANCH_MANAGER');

  // Mobile sidebar
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Notifications
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const [lastSeen, setLastSeen] = useState<number>(() => {
    try { return parseInt(localStorage.getItem(NOTIF_SEEN_KEY) ?? '0', 10); } catch { return 0; }
  });
  const notifRef = useRef<HTMLDivElement>(null);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await client.get<{ data: Notification[] }>('/notifications');
      setNotifications(res.data.data ?? []);
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    void fetchNotifications();
    const interval = setInterval(() => void fetchNotifications(), POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  // Close notification dropdown on outside click
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  // Close sidebar on route change
  useEffect(() => { setSidebarOpen(false); }, [location.pathname]);

  const unreadCount = notifications.filter(
    (n) => new Date(n.created_at).getTime() > lastSeen,
  ).length;

  function markAllRead() {
    const now = Date.now();
    setLastSeen(now);
    try { localStorage.setItem(NOTIF_SEEN_KEY, String(now)); } catch { /* ignore */ }
  }

  function openNotifs() {
    setNotifOpen((v) => !v);
    if (!notifOpen) markAllRead();
  }

  async function handleLogout() {
    try { await client.post('/auth/logout', { refresh_token: getRefreshToken() }); } catch { /* ignore */ }
    clearAccessToken();
    navigate('/login');
  }

  const pageTitle = Object.entries(PAGE_TITLES).find(
    ([k]) => location.pathname === k || location.pathname.startsWith(k + '/'),
  )?.[1] ?? 'SecureBank';

  const navItems = [
    ...BASE_NAV,
    ...(showAdmin ? [{ path: '/admin', icon: 'admin_panel_settings', label: 'Admin' }] : []),
  ];

  // ── Sidebar content (shared between desktop + mobile) ──
  const SidebarContent = () => (
    <>
      {/* Brand */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0 8px 24px' }}>
        <span className="ms filled" style={{ fontSize: 26, color: 'var(--primary)', flexShrink: 0 }}>account_balance</span>
        <div>
          <div style={{ fontFamily: 'Outfit', fontSize: '1rem', fontWeight: 600, color: 'var(--primary)', lineHeight: 1.2 }}>Aura Private</div>
          <div style={{ fontSize: '0.68rem', color: 'var(--outline)', letterSpacing: '0.04em', marginTop: 1 }}>Wealth Management</div>
        </div>
      </div>

      {/* Nav links */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {navItems.map((item) => {
          const active =
            location.pathname === item.path ||
            (item.path === '/dashboard' && location.pathname.startsWith('/transactions'));
          return (
            <button key={item.path} className={`nav-item${active ? ' active' : ''}`}
              onClick={() => navigate(item.path)}>
              <span className={`ms nav-icon${active ? ' filled' : ''}`}>{item.icon}</span>
              {item.label}
            </button>
          );
        })}
      </div>

      {/* Bottom */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div className="divider" style={{ marginBottom: 8 }} />
        <button className="nav-item" onClick={() => navigate('/profile')}>
          <span className="ms nav-icon">manage_accounts</span>
          Profile & Security
        </button>
        <button className="nav-item" aria-label="Support">
          <span className="ms nav-icon">help_outline</span>
          Support
        </button>
        <button className="nav-item" onClick={() => void handleLogout()}>
          <span className="ms nav-icon">logout</span>
          Sign Out
        </button>

        {/* Role chip */}
        <div style={{
          marginTop: 8, padding: '8px 12px', borderRadius: 8,
          background: 'rgba(34,64,154,0.06)', display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span className="ms filled" style={{ fontSize: 16, color: 'var(--primary)' }}>
            {role === 'ADMIN' ? 'shield' : role === 'BRANCH_MANAGER' ? 'badge' : 'person'}
          </span>
          <div>
            <div style={{ fontSize: '0.68rem', color: 'var(--outline)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Signed in as</div>
            <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--primary)' }}>
              {role === 'ADMIN' ? 'Administrator' : role === 'BRANCH_MANAGER' ? 'Branch Manager' : 'Customer'}
            </div>
          </div>
        </div>
      </div>
    </>
  );

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: '100vh' }}>

      {/* ── Desktop sidebar ── */}
      <nav className="app-sidebar" style={{
        position: 'fixed', left: 0, top: 0, bottom: 0, width: 256,
        background: 'var(--surface-low)',
        borderRight: '1px solid var(--outline-var)',
        display: 'flex', flexDirection: 'column',
        padding: '28px 16px', zIndex: 100,
      }}>
        <SidebarContent />
      </nav>

      {/* ── Mobile sidebar overlay ── */}
      {sidebarOpen && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 200,
            background: 'rgba(22,29,46,0.45)', backdropFilter: 'blur(2px)',
          }}
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <nav style={{
        position: 'fixed', left: 0, top: 0, bottom: 0, width: 256,
        background: 'var(--surface-low)',
        borderRight: '1px solid var(--outline-var)',
        display: 'flex', flexDirection: 'column',
        padding: '28px 16px', zIndex: 210,
        transform: sidebarOpen ? 'translateX(0)' : 'translateX(-100%)',
        transition: 'transform 0.24s cubic-bezier(0.4,0,0.2,1)',
        visibility: sidebarOpen ? 'visible' : 'hidden',
      }}
        className="mobile-sidebar"
      >
        <button
          onClick={() => setSidebarOpen(false)}
          style={{ position: 'absolute', top: 14, right: 14, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--outline)', padding: 4 }}
          aria-label="Close menu"
        >
          <span className="ms" style={{ fontSize: 22 }}>close</span>
        </button>
        <SidebarContent />
      </nav>

      {/* ── Main column ── */}
      <div className="app-main" style={{ marginLeft: 256, flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>

        {/* Sticky top bar */}
        <header style={{
          position: 'sticky', top: 0, zIndex: 30,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '0 48px', height: 60,
          background: 'rgba(238,242,249,0.90)',
          backdropFilter: 'blur(14px)',
          WebkitBackdropFilter: 'blur(14px)',
          borderBottom: '1px solid var(--outline-var)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {/* Hamburger (mobile only) */}
            <button
              className="hamburger-btn"
              aria-label="Open menu"
              onClick={() => setSidebarOpen(true)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--on-surface-var)', padding: 4, display: 'none',
              }}
            >
              <span className="ms" style={{ fontSize: 24 }}>menu</span>
            </button>
            <span style={{ fontFamily: 'Outfit', fontSize: '1.05rem', fontWeight: 500, color: 'var(--primary)' }}>
              {pageTitle}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>

            {/* Notification bell */}
            <div ref={notifRef} style={{ position: 'relative' }}>
              <button
                aria-label="Notifications"
                onClick={openNotifs}
                style={{
                  width: 36, height: 36, borderRadius: '50%', border: 'none',
                  background: notifOpen ? 'var(--surface-high)' : 'transparent',
                  cursor: 'pointer', position: 'relative',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'var(--on-surface-var)', transition: 'background var(--transition)',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-high)')}
                onMouseLeave={(e) => { if (!notifOpen) e.currentTarget.style.background = 'transparent'; }}
              >
                <span className="ms" style={{ fontSize: 20 }}>notifications</span>
                {unreadCount > 0 && (
                  <span style={{
                    position: 'absolute', top: 4, right: 4,
                    width: 16, height: 16, borderRadius: '50%',
                    background: 'var(--color-danger)', color: '#fff',
                    fontSize: '0.6rem', fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    border: '1.5px solid var(--sand-base)',
                  }}>
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>

              {/* Dropdown */}
              {notifOpen && (
                <div style={{
                  position: 'absolute', right: 0, top: 44,
                  width: 360, maxHeight: 480,
                  background: 'var(--surface)',
                  border: '1px solid var(--sand-border)',
                  borderRadius: 12,
                  boxShadow: '0 8px 40px rgba(34,64,154,0.15)',
                  overflow: 'hidden', display: 'flex', flexDirection: 'column',
                  zIndex: 200,
                }}>
                  <div style={{ padding: '14px 18px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--outline-var)' }}>
                    <span style={{ fontFamily: 'Outfit', fontWeight: 600, color: 'var(--primary)', fontSize: '0.95rem' }}>Notifications</span>
                    <button onClick={markAllRead} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.75rem', color: 'var(--primary)', fontWeight: 600 }}>
                      Mark all read
                    </button>
                  </div>
                  <div style={{ overflowY: 'auto', flex: 1 }}>
                    {notifications.length === 0 ? (
                      <div style={{ padding: '32px 18px', textAlign: 'center', color: 'var(--outline)', fontSize: '0.875rem' }}>
                        <span className="ms" style={{ fontSize: 36, display: 'block', marginBottom: 8 }}>notifications_none</span>
                        No recent notifications
                      </div>
                    ) : notifications.map((n) => (
                      <div key={n.id} style={{
                        display: 'flex', gap: 12, padding: '12px 18px',
                        borderBottom: '1px solid var(--outline-var)',
                        transition: 'background var(--transition)',
                      }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-low)')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                      >
                        <div style={{
                          width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                          background: `${notifColor(n.type)}18`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          <span className="ms filled" style={{ fontSize: 18, color: notifColor(n.type) }}>{notifIcon(n.type)}</span>
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: '0.82rem', color: 'var(--on-surface)', marginBottom: 2 }}>{n.title}</div>
                          <div style={{ fontSize: '0.78rem', color: 'var(--on-surface-var)', lineHeight: 1.4 }}>{n.message}</div>
                          <div style={{ fontSize: '0.7rem', color: 'var(--outline)', marginTop: 4 }}>{timeAgo(n.created_at)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Avatar → profile */}
            <button
              aria-label="Profile"
              onClick={() => navigate('/profile')}
              style={{
                width: 34, height: 34, borderRadius: '50%', marginLeft: 8,
                background: 'var(--primary-container)',
                border: '1.5px solid var(--outline-var)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', transition: 'transform var(--transition)',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.08)')}
              onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
            >
              <span className="ms filled" style={{ fontSize: 17, color: 'var(--on-primary-container)' }}>person</span>
            </button>
          </div>
        </header>

        <main style={{ flex: 1 }}>{children}</main>
      </div>
    </div>
  );
}
