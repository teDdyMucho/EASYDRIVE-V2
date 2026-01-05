import { useMemo, useState } from 'react';
import { User, LogOut, FileText } from 'lucide-react';
import FileUploadSection from './FileUploadSection';
import ReceiptHistory from './ReceiptHistory';

interface DashboardProps {
  onLogout: () => void;
}

export default function Dashboard({ onLogout }: DashboardProps) {
  const [isLogoutOpen, setIsLogoutOpen] = useState(false);
  const [showReceiptHistory, setShowReceiptHistory] = useState(false);
  const accountLabel = useMemo(() => {
    try {
      const token = localStorage.getItem('ed_googleCredential');
      if (!token) return 'Account';

      const parts = token.split('.');
      if (parts.length < 2) return 'Account';

      const base64Url = parts[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');

      const json = atob(padded);
      const payload = JSON.parse(json) as { name?: string; email?: string };
      return payload?.name || payload?.email || 'Account';
    } catch {
      return 'Account';
    }
  }, []);


  const handleLogout = () => {
    try {
      localStorage.removeItem('ed_googleCredential');
    } catch {
      // ignore
    }
    onLogout();
  };

  if (showReceiptHistory) {
    return <ReceiptHistory onBack={() => setShowReceiptHistory(false)} />;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {isLogoutOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setIsLogoutOpen(false);
          }}
        >
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm"></div>
          <div className="relative w-full max-w-sm sm:max-w-md rounded-xl sm:rounded-2xl bg-white shadow-2xl border border-gray-200 overflow-hidden">
            <div className="px-4 sm:px-6 py-4 sm:py-5 border-b border-gray-100">
              <div className="text-base sm:text-lg font-semibold text-gray-900">Confirm logout</div>
              <div className="mt-1 text-xs sm:text-sm text-gray-600">Are you sure you want to log out of {accountLabel}?</div>
            </div>
            <div className="px-4 sm:px-6 py-4 sm:py-5">
              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3">
                <button
                  type="button"
                  onClick={() => setIsLogoutOpen(false)}
                  className="inline-flex justify-center rounded-lg sm:rounded-xl border border-gray-300 bg-white px-4 py-2 sm:py-2.5 text-xs sm:text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsLogoutOpen(false);
                    handleLogout();
                  }}
                  className="inline-flex justify-center rounded-lg sm:rounded-xl bg-gray-900 px-4 py-2 sm:py-2.5 text-xs sm:text-sm font-semibold text-white hover:bg-gray-800 transition-colors"
                >
                  Logout
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      <nav className="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-2">
              <img
                src="/EDC.png"
                alt="EASYDRIVE"
                className="h-8 w-auto"
              />
            </div>
            <div className="flex items-center space-x-1 sm:space-x-2 md:space-x-4">
              <div className="hidden md:flex items-center space-x-2 text-gray-700">
                <User className="w-4 h-4 sm:w-5 sm:h-5" />
                <span className="font-medium text-sm">{accountLabel}</span>
              </div>
              <button
                onClick={() => setShowReceiptHistory(true)}
                className="flex items-center space-x-1 sm:space-x-2 px-2 sm:px-3 py-2 rounded-lg text-gray-600 hover:text-cyan-500 hover:bg-cyan-50 transition-all"
              >
                <FileText className="w-4 h-4 sm:w-5 sm:h-5" />
                <span className="hidden sm:inline text-sm">Receipts</span>
              </button>
              <button
                onClick={() => setIsLogoutOpen(true)}
                className="flex items-center space-x-1 sm:space-x-2 px-2 sm:px-3 py-2 rounded-lg text-gray-600 hover:text-cyan-500 hover:bg-cyan-50 transition-all"
              >
                <LogOut className="w-4 h-4 sm:w-5 sm:h-5" />
                <span className="hidden sm:inline text-sm">Logout</span>
              </button>
            </div>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-6 md:py-8">
        <div className="mb-4 sm:mb-6 md:mb-8">
          <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-800 mb-1 sm:mb-2">Welcome to Your Dashboard</h1>
          <p className="text-xs sm:text-sm md:text-base text-gray-600">Manage your transportation orders and documents</p>
        </div>

        <div className="bg-white rounded-lg sm:rounded-xl shadow-sm border border-gray-200">
          <div className="p-3 sm:p-4 md:p-6">
            <FileUploadSection />
          </div>
        </div>
      </div>
    </div>
  );
}
