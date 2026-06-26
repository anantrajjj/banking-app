import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import TransactionHistoryPage from './pages/TransactionHistoryPage';
import FundTransferPage from './pages/FundTransferPage';
import LoanEligibilityPage from './pages/LoanEligibilityPage';
import Layout from './components/Layout';
import { getAccessToken, subscribeToToken } from './store/authStore';

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
