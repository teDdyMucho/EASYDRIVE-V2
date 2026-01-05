import { useState } from 'react';
import HomePage from './components/HomePage';
import Dashboard from './components/Dashboard';

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
    <>
      {!isLoggedIn ? (
        <HomePage onLogin={handleLogin} />
      ) : (
        <Dashboard onLogout={handleLogout} />
      )}
    </>
  );
}

export default App;
