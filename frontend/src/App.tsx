import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import { useWorkspaceStore } from './store/workspaceStore';
import type { AppModule } from './types';
import Layout from './components/layout/Layout';
import Login from './pages/Login';
import Home from './pages/Home';
import BoardPage from './pages/BoardPage';
import SearchPage from './pages/SearchPage';
import SettingsPage from './pages/SettingsPage';
import NotificationsPanel from './components/notifications/NotificationsPanel';
import AdminPage from './pages/AdminPage';
import CalendarPage from './pages/CalendarPage';
import BibixBotPage from './pages/BibixBotPage';
import BookingPage from './pages/BookingPage';
import SchedulingPage from './pages/SchedulingPage';
import CRMPage from './pages/CRMPage';
import InvoicePage from './pages/InvoicePage';
import PublicFormPage from './pages/PublicFormPage';
import InstagramPage from './pages/InstagramPage';
import LinkedInPage from './pages/LinkedInPage';
import MarketingPage from './pages/MarketingPage';
import BackupsPage from './pages/BackupsPage';

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
    <Routes>
      <Route path="/schedule/:userId" element={<BookingPage />} />
      <Route path="/form/:formId" element={<PublicFormPage />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Navigate to="/login" replace />} />
      <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route index element={<Home />} />
        <Route path="board/:boardId" element={<BoardPage />} />
        <Route path="search" element={<SearchPage />} />
        <Route path="notifications" element={<NotificationsPanel />} />
        <Route path="calendar" element={<ModuleRoute module="calendar"><CalendarPage /></ModuleRoute>} />
        <Route path="bibixbot" element={<ModuleRoute module="bibixbot"><BibixBotPage /></ModuleRoute>} />
        <Route path="scheduling" element={<ModuleRoute module="scheduling"><SchedulingPage /></ModuleRoute>} />
        <Route path="crm" element={<ModuleRoute module="crm"><CRMPage /></ModuleRoute>} />
        <Route path="invoices" element={<InvoicePage />} />
        <Route path="instagram" element={<Navigate to="/marketing/instagram" replace />} />
        <Route path="marketing/integrations" element={<ModuleRoute module="marketing"><MarketingPage /></ModuleRoute>} />
        <Route path="marketing/instagram" element={<ModuleRoute module="instagram"><InstagramPage /></ModuleRoute>} />
        <Route path="marketing/linkedin"  element={<ModuleRoute module="linkedin"><LinkedInPage /></ModuleRoute>} />
        <Route path="backups" element={<BackupsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="admin" element={<AdminPage />} />
      </Route>
    </Routes>
  );
}
