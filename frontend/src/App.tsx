import { useEffect, lazy, Suspense, Component } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import { useWorkspaceStore } from './store/workspaceStore';
import type { AppModule } from './types';
// Core shell loads eagerly; everything else is code-split so the initial bundle
// stays small and each page (esp. the large InstagramPage) downloads on demand.
import Layout from './components/layout/Layout';
import Login from './pages/Login';
import Home from './pages/Home';

const BoardPage = lazy(() => import('./pages/BoardPage'));
const SearchPage = lazy(() => import('./pages/SearchPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const NotificationsPanel = lazy(() => import('./components/notifications/NotificationsPanel'));
const AdminPage = lazy(() => import('./pages/AdminPage'));
const CalendarPage = lazy(() => import('./pages/CalendarPage'));
const BibixBotPage = lazy(() => import('./pages/BibixBotPage'));
const BookingPage = lazy(() => import('./pages/BookingPage'));
const SchedulingPage = lazy(() => import('./pages/SchedulingPage'));
const CRMPage = lazy(() => import('./pages/CRMPage'));
const InvoicePage = lazy(() => import('./pages/InvoicePage'));
const PublicFormPage = lazy(() => import('./pages/PublicFormPage'));
const InstagramPage = lazy(() => import('./pages/InstagramPage'));
const MarketingPage = lazy(() => import('./pages/MarketingPage'));
const LinkedInPage = lazy(() => import('./pages/LinkedInPage'));
const BackupsPage = lazy(() => import('./pages/BackupsPage'));
const ReportsPage = lazy(() => import('./pages/ReportsPage'));

function PageLoader() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="animate-spin w-8 h-8 border-4 border-monday-blue border-t-transparent rounded-full" />
    </div>
  );
}

// Each lazy route gets its OWN Suspense boundary. A single shared boundary near
// the root throws React error #426 ("suspended while responding to synchronous
// input") when an auth/navigation update reveals a lazy route, because the
// already-mounted boundary can't show its fallback. A fresh per-route boundary
// mounts clean on every navigation, so suspending always shows the loader.
const S = (el: React.ReactNode) => <Suspense fallback={<PageLoader />}>{el}</Suspense>;

// Catches render errors (incl. a failed lazy-chunk fetch after a redeploy) so the
// app shows a reload prompt instead of a blank white screen.
class ErrorBoundary extends Component<{ children: React.ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() { return { error: true }; }
  componentDidCatch(err: unknown) {
    const msg = String((err as { message?: string })?.message || err);
    if (/Loading chunk|dynamically imported module|Failed to fetch/i.test(msg)) {
      window.location.reload();
    }
  }
  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center gap-3 text-gray-600">
          <p>Something went wrong loading the app.</p>
          <button onClick={() => window.location.reload()}
            className="px-4 py-2 bg-monday-blue text-white rounded-lg">Reload</button>
        </div>
      );
    }
    return this.props.children;
  }
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuthStore();
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-spin w-10 h-10 border-4 border-monday-blue border-t-transparent rounded-full" />
    </div>
  );
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function ModuleRoute({ module, children }: { module: AppModule; children: React.ReactNode }) {
  const { hasPermission } = useAuthStore();
  if (!hasPermission(module)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  const { loadUser } = useAuthStore();
  const { loadWorkspaces } = useWorkspaceStore();
  const { user } = useAuthStore();

  useEffect(() => { loadUser(); }, []);
  useEffect(() => { if (user) loadWorkspaces(); }, [user?.id]);

  return (
    <ErrorBoundary>
    <Routes>
      <Route path="/schedule/:userId" element={S(<BookingPage />)} />
      <Route path="/form/:formId" element={S(<PublicFormPage />)} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Navigate to="/login" replace />} />
      <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route index element={<Home />} />
        <Route path="board/:boardId" element={S(<BoardPage />)} />
        <Route path="search" element={S(<SearchPage />)} />
        <Route path="notifications" element={S(<NotificationsPanel />)} />
        <Route path="calendar" element={<ModuleRoute module="calendar">{S(<CalendarPage />)}</ModuleRoute>} />
        <Route path="bibixbot" element={<ModuleRoute module="bibixbot">{S(<BibixBotPage />)}</ModuleRoute>} />
        <Route path="scheduling" element={<ModuleRoute module="scheduling">{S(<SchedulingPage />)}</ModuleRoute>} />
        <Route path="crm" element={<ModuleRoute module="crm">{S(<CRMPage />)}</ModuleRoute>} />
        <Route path="invoices" element={S(<InvoicePage />)} />
        <Route path="bi" element={<ModuleRoute module="reports">{S(<ReportsPage />)}</ModuleRoute>} />
        <Route path="instagram" element={<Navigate to="/marketing/instagram" replace />} />
        <Route path="marketing/integrations" element={<ModuleRoute module="marketing">{S(<MarketingPage />)}</ModuleRoute>} />
        <Route path="marketing/instagram" element={<ModuleRoute module="instagram">{S(<InstagramPage />)}</ModuleRoute>} />
        <Route path="marketing/linkedin"  element={<ModuleRoute module="linkedin">{S(<LinkedInPage />)}</ModuleRoute>} />
        <Route path="backups" element={S(<BackupsPage />)} />
        <Route path="settings" element={S(<SettingsPage />)} />
        <Route path="admin" element={S(<AdminPage />)} />
      </Route>
    </Routes>
    </ErrorBoundary>
  );
}
