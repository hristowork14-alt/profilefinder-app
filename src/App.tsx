import { BrowserRouter, HashRouter, Route, Routes } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AuthProvider } from './auth/AuthProvider';
import { AppLayout, PublicLayout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { DEMO_MODE, SUPABASE_CONFIGURED } from './lib/config';
import { AccountPage } from './pages/Account';
import { BulkPage } from './pages/Bulk';
import { HistoryPage } from './pages/History';
import { HistoryDetailPage } from './pages/HistoryDetail';
import { LandingPage } from './pages/Landing';
import { LoginPage } from './pages/Login';
import { NotConfiguredPage, NotFoundPage } from './pages/NotFound';
import { PrivacyPage } from './pages/Privacy';
import { ResetPasswordPage } from './pages/ResetPassword';
import { SearchPage } from './pages/Search';
import { SignupPage } from './pages/Signup';

// The static demo build uses hash URLs (/#/app) so it works from any folder or host.
const Router = DEMO_MODE ? HashRouter : BrowserRouter;

export default function App() {
  if (!DEMO_MODE && !SUPABASE_CONFIGURED) return <NotConfiguredPage />;

  return (
    <AuthProvider>
      <Router>
        <Routes>
          <Route element={<PublicLayout />}>
            <Route index element={<LandingPage />} />
            <Route path="login" element={<LoginPage />} />
            <Route path="signup" element={<SignupPage />} />
            <Route path="reset-password" element={<ResetPasswordPage />} />
            <Route path="privacy" element={<PrivacyPage />} />
          </Route>
          <Route element={<ProtectedRoute />}>
            <Route path="app" element={<AppLayout />}>
              <Route index element={<SearchPage />} />
              <Route path="history" element={<HistoryPage />} />
              <Route path="history/:searchId" element={<HistoryDetailPage />} />
              <Route path="bulk" element={<BulkPage />} />
              <Route path="account" element={<AccountPage />} />
            </Route>
          </Route>
          <Route element={<PublicLayout />}>
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </Router>
      <Toaster
        position="top-center"
        theme="system"
        toastOptions={{ classNames: { toast: 'font-sans !rounded-md !border-line !bg-surface !text-ink', description: '!text-muted' } }}
      />
    </AuthProvider>
  );
}
