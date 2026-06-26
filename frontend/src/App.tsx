import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import TransactionHistoryPage from './pages/TransactionHistoryPage';
import FundTransferPage from './pages/FundTransferPage';
import LoanEligibilityPage from './pages/LoanEligibilityPage';
import Layout from './components/Layout';
import { getAccessToken, getRefreshToken, subscribeToToken, clearSession } from './store/authStore';
import { refreshAccessToken } from './api/client';

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(getAccessToken());

  useEffect(() => {
    const unsubscribe = subscribeToToken(() => setToken(getAccessToken()));
    return unsubscribe;
  }, []);

  if (!token) return <Navigate to="/login" replace />;
  return <Layout>{children}</Layout>;
}

export default function App() {
  // On startup, if we have a persisted refresh token but no in-memory access
  // token (e.g. after a page reload), silently restore the session before
  // rendering routes — otherwise PrivateRoute would bounce to /login.
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!getAccessToken() && getRefreshToken()) {
        try {
          await refreshAccessToken();
        } catch {
          clearSession();
        }
      }
      if (active) setBooting(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  if (booting) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--sand-base)',
      }}>
        <div className="spinner" aria-label="Loading" />
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/dashboard" element={<PrivateRoute><DashboardPage /></PrivateRoute>} />
        <Route path="/transactions/:accountId" element={<PrivateRoute><TransactionHistoryPage /></PrivateRoute>} />
        <Route path="/transfer" element={<PrivateRoute><FundTransferPage /></PrivateRoute>} />
        <Route path="/loan" element={<PrivateRoute><LoanEligibilityPage /></PrivateRoute>} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
