import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { Truck, Package, MapPin, Clock, CheckCircle, ArrowRight, X, Menu } from 'lucide-react';
import FileUploadSection from './FileUploadSection';

interface HomePageProps {
  onLogin: () => void;
}

export default function HomePage({ onLogin }: HomePageProps) {
  const [isSignInOpen, setIsSignInOpen] = useState(false);
  const googleButtonRef = useRef<HTMLDivElement | null>(null);
  const [gisReady, setGisReady] = useState(false);
  const [gisError, setGisError] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const supabase = useMemo(() => {
    const url = import.meta.env.VITE_SUPABASE_URL;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
    if (!url || !anonKey) return null;
    return createClient(url, anonKey);
  }, []);

  const claimPendingDocumentsToUser = useCallback(async (credential: string) => {
    if (!supabase) return;
    try {
      const parts = credential.split('.');
      if (parts.length < 2) return;

      const base64Url = parts[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
      const json = atob(padded);
      const payload = JSON.parse(json) as { name?: string; email?: string };
      const email = String(payload?.email ?? '').trim();
      const name = String(payload?.name ?? '').trim();
      if (!email) return;

      const raw = localStorage.getItem('ed_documents_pending_claim');
      if (!raw) return;

      const pending = JSON.parse(raw) as Array<{ submittedAt: string; receipt: string }>;
      if (!Array.isArray(pending) || pending.length === 0) return;

      for (const item of pending) {
        const receipt = String(item?.receipt ?? '').replace(/\r\n/g, '\n').trim();
        if (!receipt) continue;

        const { data, error } = await supabase
          .from('Document')
          .select('id')
          .eq('receipt', receipt)
          .or('email.is.null,email.eq.')
          .order('created_at', { ascending: false })
          .limit(5);

        if (error) continue;
        const ids = (Array.isArray(data) ? data : []).map((d: { id?: string }) => d?.id).filter(Boolean);
        if (ids.length === 0) continue;

        for (const docId of ids) {
          await supabase.from('Document').update({ email, name }).eq('id', docId);
        }
      }

      localStorage.removeItem('ed_documents_pending_claim');
    } catch {
      // ignore
    }
  }, [supabase]);
  const migratePendingReceiptsToUser = useCallback((credential: string) => {
    try {
      const parts = credential.split('.');
      if (parts.length < 2) return;

      const base64Url = parts[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
      const json = atob(padded);
      const payload = JSON.parse(json) as { sub?: string; email?: string };
      const userKey = payload?.sub || payload?.email;
      if (!userKey) return;

      const pendingRaw = localStorage.getItem('ed_receipts_pending');
      if (!pendingRaw) return;

      const pending = JSON.parse(pendingRaw) as Array<{ id: string; createdAt: string; text: string }>;
      if (!Array.isArray(pending) || pending.length === 0) return;

      const userStorageKey = `ed_receipts_by_user_${userKey}`;
      const existingRaw = localStorage.getItem(userStorageKey);
      const existing = existingRaw ? (JSON.parse(existingRaw) as Array<{ id: string; createdAt: string; text: string }>) : [];

      localStorage.setItem(userStorageKey, JSON.stringify([...pending, ...existing]));
      localStorage.removeItem('ed_receipts_pending');
    } catch {
      // ignore
    }
  }, []);
  const partnershipSlides = [
    'EasyDrive Transportation (EDT) is proudly partnered with North Line Auto Transport, one of the region’s most trusted and professional licensed vehicle carriers, servicing Ontario and Quebec.',
    'EDT delivers the advanced user interface, instant pricing engine, order intake workflow, and automation capabilities that make vehicle transportation fast, transparent, and effortless for our customers.',
    'All transportation services booked through EDT are fulfilled by North Line Auto Transport’s experienced logistics and carrier team, backed by full commercial insurance coverage up to $2,000,000.',
    'This partnership combines EDT’s technology-driven customer experience with North Line’s proven delivery excellence — ensuring reliable, efficient, and professional transportation from end to end.',
  ];
  const [partnershipSlideIndex, setPartnershipSlideIndex] = useState(0);
  const [partnershipSlideFading, setPartnershipSlideFading] = useState(false);

  const openSignIn = useCallback(() => setIsSignInOpen(true), []);
  const closeSignIn = useCallback(() => setIsSignInOpen(false), []);
  const openUpload = useCallback(() => {
    // Clear any persisted upload state to ensure we start fresh
    try {
      localStorage.removeItem('ed_extractedFormData');
      localStorage.removeItem('ed_submitMessage');
      localStorage.removeItem('ed_submitError');
    } catch {
      // ignore
    }
    setShowUpload(true);
  }, []);
  const closeUpload = useCallback(() => setShowUpload(false), []);

  useEffect(() => {
    if (!isSignInOpen) return;

    setGisError(null);
    setGisReady(false);

    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (!clientId) {
      setGisError('Missing Google Client ID. Set VITE_GOOGLE_CLIENT_ID in .env and restart the dev server.');
      return;
    }

    if ((window as unknown as { google?: { accounts?: { id?: unknown } } })?.google?.accounts?.id) {
      setGisReady(true);
      return;
    }

    const existing = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
    if (existing) {
      const timer = window.setInterval(() => {
        if ((window as unknown as { google?: { accounts?: { id?: unknown } } })?.google?.accounts?.id) {
          window.clearInterval(timer);
          setGisReady(true);
        }
      }, 50);
      window.setTimeout(() => window.clearInterval(timer), 5000);
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => setGisReady(true);
    script.onerror = () => setGisError('Failed to load Google Sign-In. Please try again.');
    document.head.appendChild(script);
  }, [isSignInOpen]);

  useEffect(() => {
    const intervalMs = 4000;
    const fadeMs = 160;

    const intervalId = window.setInterval(() => {
      setPartnershipSlideFading(true);

      window.setTimeout(() => {
        setPartnershipSlideIndex((prev) => (prev + 1) % partnershipSlides.length);
        setPartnershipSlideFading(false);
      }, fadeMs);
    }, intervalMs);

    return () => window.clearInterval(intervalId);
  }, [partnershipSlides.length]);

  useEffect(() => {
    if (!isSignInOpen) return;
    if (!gisReady) return;
    if (!googleButtonRef.current) return;

    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (!clientId) return;

    interface GoogleAccounts {
      id: {
        initialize: (config: { client_id: string; callback: (response: { credential?: string }) => void }) => void;
        renderButton: (element: HTMLElement, config: { theme: string; size: string; shape: string; text: string; width?: string }) => void;
      };
    }
    const google = (window as unknown as { google?: { accounts?: GoogleAccounts } })?.google;
    if (!google?.accounts?.id) {
      setGisError('Google Sign-In is not available. Please refresh and try again.');
      return;
    }

    googleButtonRef.current.innerHTML = '';

    google.accounts.id.initialize({
      client_id: clientId,
      callback: async (response: { credential?: string }) => {
        const credential = response?.credential;
        if (!credential) {
          setGisError('Sign-in failed. Please try again.');
          return;
        }

        try {
          localStorage.setItem('ed_googleCredential', credential);
          migratePendingReceiptsToUser(credential);
          await claimPendingDocumentsToUser(credential);
        } catch {
          // ignore
        }

        closeSignIn();
        onLogin();
      },
    });

    google.accounts.id.renderButton(googleButtonRef.current, {
      theme: 'outline',
      size: 'large',
      shape: 'pill',
      text: 'continue_with',
      width: googleButtonRef.current.clientWidth ? String(googleButtonRef.current.clientWidth) : undefined,
    });
  }, [gisReady, isSignInOpen, claimPendingDocumentsToUser, migratePendingReceiptsToUser, closeSignIn, onLogin]);

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="absolute top-0 inset-x-0 z-40 bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Left side - Both Logos */}
            <div className="flex items-center space-x-4">
              <a href="#home" aria-label="Go to HOME">
                <img
                  src="/EDC.png"
                  alt="EASYDRIVE"
                  className="h-8 w-auto hover:opacity-90 transition-opacity"
                />
              </a>
              <a
                href="https://www.northlineautotransport.com/"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Visit North Line Auto Transport"
              >
                <img
                  src="/logoclick.png"
                  alt="North Line Auto Transport"
                  className="h-8 w-auto hover:opacity-90 transition-opacity"
                />
              </a>
            </div>
            
            {/* Center - Navigation Links (Desktop) */}
            <div className="hidden md:flex items-center space-x-8">
              <a href="#home" className="text-gray-600 hover:text-gray-900 transition-colors text-sm font-medium">Home</a>
              <a href="#about" className="text-gray-600 hover:text-gray-900 transition-colors text-sm font-medium">About Us</a>
              <a href="#contact" className="text-gray-600 hover:text-gray-900 transition-colors text-sm font-medium">Contact</a>
            </div>
            
            {/* Right side - Buttons (Desktop) */}
            <div className="hidden md:flex items-center space-x-3">
              <button
                onClick={openSignIn}
                className="text-gray-600 hover:text-gray-900 transition-colors text-sm font-medium px-3 py-2"
              >
                Log In
              </button>
              <button 
                onClick={openUpload}
                className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-blue-700 transition-colors"
              >
                Get Quote Now
              </button>
            </div>

            {/* Mobile menu button */}
            <div className="md:hidden">
              <button
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                className="text-gray-600 hover:text-gray-900 p-2"
              >
                <Menu className="h-6 w-6" />
              </button>
            </div>
          </div>

          {/* Mobile menu */}
          {isMobileMenuOpen && (
            <div className="md:hidden bg-white border-t border-gray-200">
              <div className="px-2 pt-2 pb-3 space-y-1">
                <a href="#home" className="block px-3 py-2 text-gray-600 hover:text-gray-900 transition-colors text-sm font-medium">Home</a>
                <a href="#about" className="block px-3 py-2 text-gray-600 hover:text-gray-900 transition-colors text-sm font-medium">About Us</a>
                <a href="#contact" className="block px-3 py-2 text-gray-600 hover:text-gray-900 transition-colors text-sm font-medium">Contact</a>
                <div className="border-t border-gray-200 pt-2 mt-2">
                  <button
                    onClick={openSignIn}
                    className="block w-full text-left px-3 py-2 text-gray-600 hover:text-gray-900 transition-colors text-sm font-medium"
                  >
                    Log In
                  </button>
                  <button 
                    onClick={openUpload}
                    className="block w-full text-left px-3 py-2 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 transition-colors mt-2"
                  >
                    Get Quote Now
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </nav>

      <div className="relative bg-gradient-to-br from-gray-800 via-gray-700 to-gray-900 text-white py-8 sm:py-16 md:py-20 pb-20 sm:pb-32 overflow-visible min-h-[60vh] sm:min-h-[80vh] md:min-h-[85vh] flex items-center">
        <div className="absolute inset-0 bg-black opacity-40"></div>
        <div className="absolute inset-0" style={{
          backgroundImage: 'url(/homebroad.png)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          opacity: 0.25
        }}></div>

        <div className="relative w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold mb-3 sm:mb-4 leading-tight">
            Vehicle Transportation
            <span className="block text-cyan-400 mt-1 sm:mt-2">Made Simple</span>
          </h1>
          <p className="text-base sm:text-lg md:text-xl lg:text-2xl text-gray-200 mb-6 sm:mb-8 max-w-3xl mx-auto px-2">
            Get instant one-way transportation pricing, place orders, upload documents, and track your vehicle deliveries in real-time
          </p>
          <button
            onClick={openUpload}
            className="inline-flex items-center bg-cyan-500 text-white px-6 sm:px-8 py-3 sm:py-4 rounded-lg hover:bg-cyan-600 transition-all transform hover:scale-105 font-semibold text-base sm:text-lg shadow-lg"
          >
            Get a quote now<ArrowRight className="ml-2 w-4 h-4 sm:w-5 sm:h-5" />
          </button>

          <a
            href="https://www.northlineautotransport.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-8 sm:hidden inline-flex items-center justify-center transition-opacity hover:opacity-90 bg-white/30 backdrop-blur-sm rounded-lg px-4 py-3 border border-white/20"
            aria-label="Visit North Line Auto Transport"
          >
            <img
              src="/logoclick.png"
              alt="North Line Auto Transport"
              className="h-14 w-auto drop-shadow-[0_10px_20px_rgba(0,0,0,0.4)]"
            />
          </a>
        </div>

        <a
          href="https://www.northlineautotransport.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="hidden sm:inline-flex absolute bottom-14 md:bottom-24 left-1/2 -translate-x-1/2 z-20 items-center justify-center transition-opacity hover:opacity-90 bg-white/30 backdrop-blur-sm rounded-lg px-4 py-3 border border-white/20"
          aria-label="Visit North Line Auto Transport"
        >
          <img
            src="/logoclick.png"
            alt="North Line Auto Transport"
            className="h-16 md:h-20 w-auto drop-shadow-[0_10px_20px_rgba(0,0,0,0.4)]"
          />
        </a>
      </div>

      <div className="relative -mt-12 sm:-mt-16 mb-8 sm:mb-12 z-10">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
            <div className="floating bg-white/25 backdrop-blur-xl rounded-lg p-6 sm:p-8 border border-white/80 hover:border-cyan-300 hover:bg-white/65 transition-all duration-300 shadow-xl min-h-[100px] sm:min-h-[140px] md:min-h-[180px] flex flex-col justify-center">
              <div className="text-3xl sm:text-4xl font-bold text-gray-900">1000+</div>
              <div className="text-gray-900 mt-2 sm:mt-3 font-medium text-sm sm:text-base">Vehicles Transported</div>
            </div>
            <div className="floating bg-white/25 backdrop-blur-xl rounded-lg p-6 sm:p-8 border border-white/80 hover:border-cyan-300 hover:bg-white/65 transition-all duration-300 shadow-xl min-h-[100px] sm:min-h-[140px] md:min-h-[180px] flex flex-col justify-center" style={{ animationDelay: '0.2s' }}>
              <div className="text-3xl sm:text-4xl font-bold text-gray-900">24/7</div>
              <div className="text-gray-900 mt-2 sm:mt-3 font-medium text-sm sm:text-base">Support Available</div>
            </div>
            <div className="floating bg-white/25 backdrop-blur-xl rounded-lg p-6 sm:p-8 border border-white/80 hover:border-cyan-300 hover:bg-white/65 transition-all duration-300 shadow-xl min-h-[100px] sm:min-h-[140px] md:min-h-[180px] flex flex-col justify-center" style={{ animationDelay: '0.4s' }}>
              <div className="text-3xl sm:text-4xl font-bold text-gray-900">98%</div>
              <div className="text-gray-900 mt-2 sm:mt-3 font-medium text-sm sm:text-base">On-Time Delivery</div>
            </div>
          </div>
        </div>
      </div>

      {isSignInOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeSignIn();
          }}
        >
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm"></div>
          <div className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl border border-gray-200">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div>
                <div className="text-lg font-semibold text-gray-900">Sign in</div>
                <div className="text-sm text-gray-500">Continue to EASYDRIVE</div>
              </div>
              <button
                type="button"
                onClick={closeSignIn}
                className="p-2 rounded-lg text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 py-5">
              {gisError && <div className="mb-3 text-sm font-medium text-red-600">{gisError}</div>}

              <div className="w-full">
                {!gisReady && !gisError && (
                  <div className="w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600 text-center">
                    Loading Google Sign-In...
                  </div>
                )}
                <div ref={googleButtonRef} className="w-full flex justify-center"></div>
              </div>

              <div className="mt-4 text-xs text-gray-500 text-center">
                By continuing, you agree to our terms and privacy policy.
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="relative overflow-hidden bg-gradient-to-b from-gray-50 via-gray-50 to-white py-12 sm:py-16 md:py-20" style={{
        background: 'linear-gradient(to bottom, rgba(249,250,251,0.5) 0%, rgba(249,250,251,0.8) 30%, rgb(255,255,255) 100%)',
        backdropFilter: 'blur(1px)'
      }}>
        <div className="pointer-events-none absolute inset-x-0 top-0 h-14 bg-gradient-to-b from-white/60 via-white/30 to-transparent backdrop-blur-xl"></div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-10 sm:mb-12 md:mb-16">
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-gray-800 mb-3 sm:mb-4 px-2">Why Choose EASYDRIVE?</h2>
          <p className="text-base sm:text-lg md:text-xl text-gray-600 max-w-2xl mx-auto px-4">
            A complete transportation solution designed for car dealerships and retail customers
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 sm:gap-8">
          <div className="text-center group px-4">
            <div className="bg-cyan-50 w-14 h-14 sm:w-16 sm:h-16 rounded-full flex items-center justify-center mx-auto mb-3 sm:mb-4 group-hover:bg-cyan-500 transition-colors">
              <MapPin className="w-7 h-7 sm:w-8 sm:h-8 text-cyan-500 group-hover:text-white transition-colors" />
            </div>
            <h3 className="text-lg sm:text-xl font-semibold text-gray-800 mb-2">Instant Pricing</h3>
            <p className="text-sm sm:text-base text-gray-600">
              Get real-time quotes for pickup or delivery services instantly
            </p>
          </div>

          <div className="text-center group px-4">
            <div className="bg-cyan-50 w-14 h-14 sm:w-16 sm:h-16 rounded-full flex items-center justify-center mx-auto mb-3 sm:mb-4 group-hover:bg-cyan-500 transition-colors">
              <Package className="w-7 h-7 sm:w-8 sm:h-8 text-cyan-500 group-hover:text-white transition-colors" />
            </div>
            <h3 className="text-lg sm:text-xl font-semibold text-gray-800 mb-2">Easy Ordering</h3>
            <p className="text-sm sm:text-base text-gray-600">
              Place orders quickly with our streamlined booking process
            </p>
          </div>

          <div className="text-center group px-4">
            <div className="bg-cyan-50 w-14 h-14 sm:w-16 sm:h-16 rounded-full flex items-center justify-center mx-auto mb-3 sm:mb-4 group-hover:bg-cyan-500 transition-colors">
              <Clock className="w-7 h-7 sm:w-8 sm:h-8 text-cyan-500 group-hover:text-white transition-colors" />
            </div>
            <h3 className="text-lg sm:text-xl font-semibold text-gray-800 mb-2">Real-Time Tracking</h3>
            <p className="text-sm sm:text-base text-gray-600">
              Monitor your vehicle's journey from pickup to delivery
            </p>
          </div>

          <div className="text-center group px-4">
            <div className="bg-cyan-50 w-14 h-14 sm:w-16 sm:h-16 rounded-full flex items-center justify-center mx-auto mb-3 sm:mb-4 group-hover:bg-cyan-500 transition-colors">
              <CheckCircle className="w-7 h-7 sm:w-8 sm:h-8 text-cyan-500 group-hover:text-white transition-colors" />
            </div>
            <h3 className="text-lg sm:text-xl font-semibold text-gray-800 mb-2">Document Upload</h3>
            <p className="text-sm sm:text-base text-gray-600">
              Securely upload vehicle release forms and work orders
            </p>
          </div>
        </div>
        </div>
      </div>

      <section className="relative overflow-hidden bg-gradient-to-b from-gray-50 via-white to-gray-50 py-12 sm:py-16 md:py-20 lg:py-24">
        <div className="pointer-events-none absolute inset-0">
          <div className="ed-blob-a absolute -top-20 -left-24 h-72 w-72 rounded-full bg-cyan-200/35 blur-3xl"></div>
          <div className="ed-blob-b absolute -bottom-28 -right-24 h-80 w-80 rounded-full bg-sky-200/30 blur-3xl"></div>
          <div className="ed-blob-c absolute top-32 right-10 h-56 w-56 rounded-full bg-gray-200/40 blur-3xl"></div>
          <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-white/80 via-white/40 to-transparent"></div>
          <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-white/80 via-white/40 to-transparent"></div>
        </div>

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <div className="inline-flex items-center rounded-full bg-cyan-50 px-3 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-semibold text-cyan-700 ring-1 ring-cyan-100">
              Trusted Carrier Partnership
            </div>
            <h2 className="mt-3 sm:mt-4 text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold text-gray-900 px-2">EASYDRIVE + North Line Auto Transport</h2>
            <p className="mt-3 sm:mt-4 max-w-3xl mx-auto text-sm sm:text-base md:text-lg text-gray-600 px-4">
              Technology-driven booking by EDT, fulfilled end-to-end by North Line Auto Transport — licensed, professional service across Ontario and Quebec.
            </p>
          </div>

          <div className="mt-8 sm:mt-10 md:mt-12 space-y-6">
            {/* Top large section - Partnership Overview */}
            <div className="rounded-2xl sm:rounded-3xl bg-gradient-to-b from-white/85 to-white/65 backdrop-blur-md p-6 sm:p-8 md:p-10 ring-1 ring-black/5 shadow-xl shadow-gray-900/5">
              <div className="text-center">
                <div className="text-sm sm:text-base font-semibold tracking-wide text-gray-500">Partnership Overview</div>
                <div className="mt-2 text-xl sm:text-2xl md:text-3xl font-bold text-gray-900">Built for speed. Backed by experience.</div>
              </div>

              <div className="mt-6 sm:mt-8">
                <p
                  key={partnershipSlideIndex}
                  className={`text-center text-sm sm:text-base md:text-lg text-gray-700 leading-relaxed transition-opacity duration-200 max-w-4xl mx-auto ${
                    partnershipSlideFading ? 'opacity-0' : 'opacity-100'
                  }`}
                >
                  {partnershipSlides[partnershipSlideIndex]}
                </p>

                <div className="mt-4 sm:mt-6 flex items-center justify-center gap-2">
                  {partnershipSlides.map((_, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setPartnershipSlideIndex(idx)}
                      className={`h-2 rounded-full transition-all ${
                        idx === partnershipSlideIndex ? 'w-8 bg-cyan-500' : 'w-3 bg-gray-300 hover:bg-gray-400'
                      }`}
                      aria-label={`Go to slide ${idx + 1}`}
                    />
                  ))}
                </div>
              </div>

              <div className="mt-6 sm:mt-8 h-px w-full bg-gradient-to-r from-transparent via-gray-200 to-transparent" />

              <div className="mt-6 sm:mt-8 flex justify-center">
                <div className="flex items-start gap-3 sm:gap-4 rounded-xl sm:rounded-2xl bg-white/60 p-4 sm:p-6 ring-1 ring-black/5 max-w-3xl">
                  <CheckCircle className="mt-0.5 h-5 w-5 sm:h-6 sm:w-6 text-cyan-600 flex-shrink-0" />
                  <div className="text-sm sm:text-base text-gray-700 leading-relaxed">
                    This partnership combines EDT's technology-driven customer experience with North Line's proven delivery excellence — ensuring reliable, efficient, and professional transportation from end to end.
                  </div>
                </div>
              </div>
            </div>

            {/* Two medium sections side by side */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="rounded-xl sm:rounded-2xl bg-white/70 backdrop-blur-md p-6 sm:p-8 ring-1 ring-black/5 shadow-xl shadow-gray-900/5 transition-transform duration-300 hover:-translate-y-1">
                <div className="flex items-center gap-3 sm:gap-4 mb-4">
                  <div className="flex h-12 w-12 sm:h-14 sm:w-14 items-center justify-center rounded-lg sm:rounded-xl bg-cyan-50 ring-1 ring-cyan-100">
                    <Truck className="h-6 w-6 sm:h-7 sm:w-7 text-cyan-600" />
                  </div>
                  <div>
                    <div className="text-sm sm:text-base font-semibold text-gray-900">Carrier Partner</div>
                    <div className="text-sm sm:text-base text-gray-600">North Line Auto Transport</div>
                  </div>
                </div>
                <div className="text-sm sm:text-base text-gray-600 leading-relaxed">
                  Licensed, professional vehicle carrier serving Ontario and Quebec.
                </div>
              </div>

              <div className="rounded-xl sm:rounded-2xl bg-white/70 backdrop-blur-md p-6 sm:p-8 ring-1 ring-black/5 shadow-xl shadow-gray-900/5 transition-transform duration-300 hover:-translate-y-1">
                <div className="flex items-center gap-3 sm:gap-4 mb-4">
                  <div className="flex h-12 w-12 sm:h-14 sm:w-14 items-center justify-center rounded-lg sm:rounded-xl bg-cyan-50 ring-1 ring-cyan-100">
                    <CheckCircle className="h-6 w-6 sm:h-7 sm:w-7 text-cyan-600" />
                  </div>
                  <div>
                    <div className="text-sm sm:text-base font-semibold text-gray-900">Fully Insured</div>
                    <div className="text-sm sm:text-base text-gray-600">Up to $2,000,000 coverage</div>
                  </div>
                </div>
                <div className="text-sm sm:text-base text-gray-600 leading-relaxed">
                  Commercial insurance coverage for peace of mind from pickup to delivery.
                </div>
              </div>
            </div>

            {/* Full-width bottom section */}
            <div className="rounded-2xl sm:rounded-3xl bg-gray-900/95 p-6 sm:p-8 md:p-10 ring-1 ring-white/10 shadow-2xl shadow-black/30">
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6 lg:gap-8">
                <div className="flex-1">
                  <div className="text-sm sm:text-base font-semibold text-cyan-300">Technology + Delivery Excellence</div>
                  <div className="mt-2 text-2xl sm:text-3xl md:text-4xl font-bold text-white">Fast, transparent, effortless</div>
                  <div className="mt-3 sm:mt-4 text-sm sm:text-base md:text-lg text-gray-300 leading-relaxed max-w-3xl">
                    EDT provides the instant pricing engine, order intake workflow, and automation — while North Line's experienced logistics and carrier team fulfills your transportation professionally end-to-end.
                  </div>
                </div>
                <div className="flex-shrink-0">
                  <button
                    onClick={openUpload}
                    className="inline-flex items-center gap-2 bg-cyan-500 text-white px-6 sm:px-8 py-3 sm:py-4 rounded-lg sm:rounded-xl hover:bg-cyan-400 transition-all transform hover:scale-105 font-semibold text-sm sm:text-base shadow-lg shadow-cyan-500/30 whitespace-nowrap"
                  >
                    Get Started Now
                    <ArrowRight className="w-4 h-4 sm:w-5 sm:h-5" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-12 sm:mt-16 md:mt-20">
            <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4 sm:gap-6">
              <div>
                <div className="inline-flex items-center rounded-full bg-gray-900 px-3 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-semibold text-white">How It Works</div>
                <h3 className="mt-3 sm:mt-4 text-xl sm:text-2xl md:text-3xl font-bold text-gray-900">Technology from EDT. Delivery by North Line.</h3>
                <p className="mt-2 sm:mt-3 text-xs sm:text-sm md:text-base text-gray-600 max-w-2xl">
                  From quote to dispatch to final delivery, the experience stays simple while the transport is handled professionally.
                </p>
              </div>
            </div>

            <div className="mt-6 sm:mt-8 grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
              <div className="rounded-xl sm:rounded-2xl bg-white/70 backdrop-blur-md p-4 sm:p-5 md:p-6 ring-1 ring-black/5 shadow-xl shadow-gray-900/5 transition-transform duration-300 hover:-translate-y-1">
                <div className="flex items-center gap-2 sm:gap-3">
                  <div className="flex h-10 w-10 sm:h-11 sm:w-11 items-center justify-center rounded-lg sm:rounded-xl bg-cyan-50 ring-1 ring-cyan-100">
                    <Package className="h-5 w-5 sm:h-6 sm:w-6 text-cyan-600" />
                  </div>
                  <div>
                    <div className="text-xs sm:text-sm font-semibold text-gray-900">1) Get instant pricing</div>
                    <div className="text-xs sm:text-sm text-gray-600">Book in minutes</div>
                  </div>
                </div>
                <p className="mt-3 sm:mt-4 text-xs sm:text-sm text-gray-600 leading-relaxed">
                  EDT provides the modern interface and instant pricing engine so you can request transport quickly and transparently.
                </p>
              </div>

              <div className="rounded-xl sm:rounded-2xl bg-white/70 backdrop-blur-md p-4 sm:p-5 md:p-6 ring-1 ring-black/5 shadow-xl shadow-gray-900/5 transition-transform duration-300 hover:-translate-y-1">
                <div className="flex items-center gap-2 sm:gap-3">
                  <div className="flex h-10 w-10 sm:h-11 sm:w-11 items-center justify-center rounded-lg sm:rounded-xl bg-cyan-50 ring-1 ring-cyan-100">
                    <CheckCircle className="h-5 w-5 sm:h-6 sm:w-6 text-cyan-600" />
                  </div>
                  <div>
                    <div className="text-xs sm:text-sm font-semibold text-gray-900">2) We confirm & dispatch</div>
                    <div className="text-xs sm:text-sm text-gray-600">Professional logistics</div>
                  </div>
                </div>
                <p className="mt-3 sm:mt-4 text-xs sm:text-sm text-gray-600 leading-relaxed">
                  North Line’s experienced logistics team coordinates pickup and delivery with a licensed, professional carrier operation.
                </p>
              </div>

              <div className="rounded-xl sm:rounded-2xl bg-white/70 backdrop-blur-md p-4 sm:p-5 md:p-6 ring-1 ring-black/5 shadow-xl shadow-gray-900/5 transition-transform duration-300 hover:-translate-y-1">
                <div className="flex items-center gap-2 sm:gap-3">
                  <div className="flex h-10 w-10 sm:h-11 sm:w-11 items-center justify-center rounded-lg sm:rounded-xl bg-cyan-50 ring-1 ring-cyan-100">
                    <Clock className="h-5 w-5 sm:h-6 sm:w-6 text-cyan-600" />
                  </div>
                  <div>
                    <div className="text-xs sm:text-sm font-semibold text-gray-900">3) Delivered end-to-end</div>
                    <div className="text-xs sm:text-sm text-gray-600">Reliable execution</div>
                  </div>
                </div>
                <p className="mt-3 sm:mt-4 text-xs sm:text-sm text-gray-600 leading-relaxed">
                  Your transport is completed by North Line’s carrier team with clear communication and a professional handoff.
                </p>
              </div>
            </div>

            <div className="mt-6 sm:mt-8 grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
              <div className="lg:col-span-2 rounded-xl sm:rounded-2xl bg-white/70 backdrop-blur-md p-5 sm:p-6 md:p-7 ring-1 ring-black/5 shadow-xl shadow-gray-900/5">
                <div className="text-xs sm:text-sm font-semibold text-gray-900">Service Area</div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center rounded-full bg-cyan-50 px-2.5 sm:px-3 py-1 text-xs font-semibold text-cyan-700 ring-1 ring-cyan-100">
                    <MapPin className="mr-1 h-3 w-3 sm:h-4 sm:w-4" /> Ontario
                  </span>
                  <span className="inline-flex items-center rounded-full bg-cyan-50 px-2.5 sm:px-3 py-1 text-xs font-semibold text-cyan-700 ring-1 ring-cyan-100">
                    <MapPin className="mr-1 h-3 w-3 sm:h-4 sm:w-4" /> Quebec
                  </span>
                </div>
                <p className="mt-2 sm:mt-3 text-xs sm:text-sm text-gray-600 leading-relaxed">
                  Transportation services booked through EDT are fulfilled by North Line Auto Transport within Ontario and Quebec.
                </p>
              </div>

              <div className="rounded-xl sm:rounded-2xl bg-gray-900/95 p-5 sm:p-6 md:p-7 ring-1 ring-white/10 shadow-2xl shadow-black/30">
                <div className="text-xs sm:text-sm font-semibold text-cyan-300">Commercial Insurance</div>
                <div className="mt-1.5 sm:mt-2 text-xl sm:text-2xl font-bold text-white">Up to $2,000,000</div>
                <p className="mt-2 sm:mt-3 text-xs sm:text-sm text-gray-300 leading-relaxed">
                  Every fulfilled transport is backed by full commercial insurance coverage for added confidence.
                </p>
              </div>
            </div>
          </div>
        </div>

        <style>{`
          @keyframes edFloatA {
            0% { transform: translate3d(0, 0, 0) scale(1); }
            50% { transform: translate3d(40px, 18px, 0) scale(1.08); }
            100% { transform: translate3d(0, 0, 0) scale(1); }
          }
          @keyframes edFloatB {
            0% { transform: translate3d(0, 0, 0) scale(1); }
            50% { transform: translate3d(-34px, -22px, 0) scale(1.1); }
            100% { transform: translate3d(0, 0, 0) scale(1); }
          }
          @keyframes edFloatC {
            0% { transform: translate3d(0, 0, 0) scale(1); }
            50% { transform: translate3d(10px, -28px, 0) scale(1.06); }
            100% { transform: translate3d(0, 0, 0) scale(1); }
          }
          .ed-blob-a { animation: edFloatA 14s ease-in-out infinite; }
          .ed-blob-b { animation: edFloatB 16s ease-in-out infinite; }
          .ed-blob-c { animation: edFloatC 18s ease-in-out infinite; }

          @media (prefers-reduced-motion: reduce) {
            .ed-blob-a, .ed-blob-b, .ed-blob-c { animation: none; }
          }
        `}</style>
      </section>

      <div className="bg-gray-800 text-white py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-3xl font-bold mb-6">Perfect for Dealers & Retail Customers</h2>
              <div className="space-y-4">
                <div className="flex items-start">
                  <CheckCircle className="w-6 h-6 text-cyan-400 mr-3 flex-shrink-0 mt-1" />
                  <div>
                    <h4 className="font-semibold mb-1">One-Way Transportation</h4>
                    <p className="text-gray-300">Flexible pickup or delivery options to meet your needs</p>
                  </div>
                </div>
                <div className="flex items-start">
                  <CheckCircle className="w-6 h-6 text-cyan-400 mr-3 flex-shrink-0 mt-1" />
                  <div>
                    <h4 className="font-semibold mb-1">Transparent Pricing</h4>
                    <p className="text-gray-300">No hidden fees, get accurate quotes instantly</p>
                  </div>
                </div>
                <div className="flex items-start">
                  <CheckCircle className="w-6 h-6 text-cyan-400 mr-3 flex-shrink-0 mt-1" />
                  <div>
                    <h4 className="font-semibold mb-1">Secure Documentation</h4>
                    <p className="text-gray-300">Upload and manage all necessary paperwork digitally</p>
                  </div>
                </div>
                <div className="flex items-start">
                  <CheckCircle className="w-6 h-6 text-cyan-400 mr-3 flex-shrink-0 mt-1" />
                  <div>
                    <h4 className="font-semibold mb-1">Order Management</h4>
                    <p className="text-gray-300">Track all your transportation orders in one place</p>
                  </div>
                </div>
              </div>
            </div>
            <div className="bg-gray-700 p-8 rounded-lg">
              <h3 className="text-2xl font-bold mb-6">Ready to Get Started?</h3>
              <p className="text-gray-300 mb-6">
                Join hundreds of dealers and customers who trust EASYDRIVE for their vehicle transportation needs.
              </p>
              <button
                onClick={openSignIn}
                className="w-full bg-cyan-500 text-white px-6 py-3 rounded-lg hover:bg-cyan-600 transition-colors font-semibold flex items-center justify-center"
              >
                Sign In with Google <ArrowRight className="ml-2 w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {showUpload && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeUpload();
          }}
        >
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm"></div>
          <div className="relative w-full max-w-5xl max-h-[90vh] rounded-2xl bg-white shadow-2xl border border-gray-200 flex flex-col z-[10000] overflow-hidden">
            <div className="flex-shrink-0 bg-white flex items-center justify-between px-6 py-4 border-b border-gray-100 rounded-t-2xl">
              <div>
                <div className="text-lg font-semibold text-gray-900">Upload Documents</div>
                <div className="text-sm text-gray-500">Upload your files to continue</div>
              </div>
              <button
                type="button"
                onClick={closeUpload}
                className="p-2 rounded-lg text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 py-6 overflow-y-auto flex-1 min-h-0">
              <FileUploadSection
                hideHeader
                onContinueToSignIn={() => {
                  closeUpload();
                  openSignIn();
                }}
              />
            </div>
          </div>
        </div>
      )}

      <footer className="bg-gray-900 text-gray-400 py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="flex items-center justify-center space-x-2 mb-4">
            <img src="/EDC.png" alt="EASYDRIVE" className="h-6 w-auto sm:h-7" />
            <span className="text-lg font-bold text-white">EASYDRIVE TRANSPORTATION PORTAL</span>
          </div>
          <p>&copy; 2024 EasyDrive Transportation. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
