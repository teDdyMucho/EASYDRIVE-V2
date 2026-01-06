import { useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import HomePage from './components/HomePage';
import Dashboard from './components/Dashboard';
import AdminPanel from './components/AdminPanel';
import AdminLogin from './components/AdminLogin';

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(() => {
    try {
      return localStorage.getItem('ed_isLoggedIn') === 'true';
    } catch {
      return false;
    }
  });

  const handleLogin = () => {
    setIsLoggedIn(true);
    try {
      localStorage.setItem('ed_isLoggedIn', 'true');
    } catch {
      // ignore
    }
  };

  const handleLogout = () => {
    setIsLoggedIn(false);
    try {
      localStorage.setItem('ed_isLoggedIn', 'false');
    } catch {
      // ignore
    }
  };

  return (
    <Routes>
      {/* Admin routes */}
      <Route path="/admin/login" element={<AdminLogin />} />
      <Route path="/admin/dashboard" element={<AdminPanel />} />
      <Route path="/admin" element={<Navigate to="/admin/login" replace />} />
      
      {/* Main app routes */}
      <Route
        path="/*"
        element={
          !isLoggedIn ? (
            <HomePage onLogin={handleLogin} />
          ) : (
            <Dashboard onLogout={handleLogout} />
          )
        }
      />
    </Routes>
  );
}

export default App;
