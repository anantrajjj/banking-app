import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import TransactionHistoryPage from './pages/TransactionHistoryPage';
import FundTransferPage from './pages/FundTransferPage';
import LoanEligibilityPage from './pages/LoanEligibilityPage';
import BeneficiaryPage from './pages/BeneficiaryPage';
import ProfilePage from './pages/ProfilePage';
import AdminPage from './pages/AdminPage';
import FixedDepositPage from './pages/FixedDepositPage';
import AccountManagementPage from './pages/AccountManagementPage';
import Layout from './components/Layout';
import { getAccessToken, getRefreshToken, subscribeToToken, clearSession } from './store/authStore';
import { isAtLeast } from './store/userStore';
import { refreshAccessToken } from './api/client';

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(getAccessToken());
  useEffect(() => subscribeToToken(() => setToken(getAccessToken())), []);
  if (!token) return <Navigate to="/login" replace />;
  return <Layout>{children}</Layout>;
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(getAccessToken());
  useEffect(() => subscribeToToken(() => setToken(getAccessToken())), []);
  if (!token) return <Navigate to="/login" replace />;
  if (!isAtLeast(token, 'BRANCH_MANAGER')) return <Navigate to="/dashboard" replace />;
  return <Layout>{children}</Layout>;
}

export default function App() {
  const [booting, setBooting] = useState(true);
  useEffect(() => {
    let active = true;
    (async () => {
      if (!getAccessToken() && getRefreshToken()) {
        try { await refreshAccessToken(); } catch { clearSession(); }
      }
      if (active) setBooting(false);
    })();
    return () => { active = false; };
  }, []);

  if (booting) {
    return (
      <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'var(--sand-base)' }}>
        <div className="spinner" style={{ borderTopColor:'var(--primary)', borderColor:'rgba(34,64,154,0.2)', width:28, height:28, borderWidth:3 }} />
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login"           element={<LoginPage />} />
        <Route path="/dashboard"       element={<PrivateRoute><DashboardPage /></PrivateRoute>} />
        <Route path="/accounts"        element={<PrivateRoute><AccountManagementPage /></PrivateRoute>} />
        <Route path="/transactions/:accountId" element={<PrivateRoute><TransactionHistoryPage /></PrivateRoute>} />
        <Route path="/transfer"        element={<PrivateRoute><FundTransferPage /></PrivateRoute>} />
        <Route path="/loan"            element={<PrivateRoute><LoanEligibilityPage /></PrivateRoute>} />
        <Route path="/beneficiaries"   element={<PrivateRoute><BeneficiaryPage /></PrivateRoute>} />
        <Route path="/profile"         element={<PrivateRoute><ProfilePage /></PrivateRoute>} />
        <Route path="/fd"              element={<PrivateRoute><FixedDepositPage /></PrivateRoute>} />
        <Route path="/admin"           element={<AdminRoute><AdminPage /></AdminRoute>} />
        <Route path="*"                element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
