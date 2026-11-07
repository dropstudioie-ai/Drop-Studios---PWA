import { lazy, Suspense } from 'react';
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthProvider';
import { RequireAdmin, RequireAuth, RequireStaff } from './auth/guards';
import { Layout } from './components/Layout';
import { PageSpinner, ToastProvider } from './components/ui';
import { isSupabaseConfigured } from './lib/supabase';
import Home from './pages/Home';
import Timetable from './pages/Timetable';
import Memberships from './pages/Memberships';
import { ForgotPassword, Login, Register, ResetPassword } from './pages/Auth';
import { Privacy, Terms } from './pages/Legal';

const Checkout = lazy(() => import('./pages/Checkout'));
const CheckoutSuccess = lazy(() => import('./pages/CheckoutResult').then((m) => ({ default: m.CheckoutSuccess })));
const CheckoutCancelled = lazy(() => import('./pages/CheckoutResult').then((m) => ({ default: m.CheckoutCancelled })));
const Account = lazy(() => import('./pages/Account'));
const Teach = lazy(() => import('./pages/Teach'));
const AdminLayout = lazy(() => import('./pages/admin/AdminLayout'));
const AdminOverview = lazy(() => import('./pages/admin/Overview'));
const AdminTimetable = lazy(() => import('./pages/admin/Timetable'));
const AdminPlans = lazy(() => import('./pages/admin/Plans'));
const AdminCustomers = lazy(() => import('./pages/admin/Customers'));
const AdminStyles = lazy(() => import('./pages/admin/Catalogue').then((m) => ({ default: m.AdminStyles })));
const AdminInstructors = lazy(() => import('./pages/admin/Catalogue').then((m) => ({ default: m.AdminInstructors })));
const AdminBookings = lazy(() => import('./pages/admin/Misc').then((m) => ({ default: m.AdminBookings })));
const AdminAudit = lazy(() => import('./pages/admin/Misc').then((m) => ({ default: m.AdminAudit })));
const AdminSettings = lazy(() => import('./pages/admin/Misc').then((m) => ({ default: m.AdminSettings })));

function NotFound() {
  return (
    <div className="container-page py-16 text-center">
      <h1 className="text-3xl font-black">Page not found</h1>
      <Link to="/" className="btn-primary mt-6">Go home</Link>
    </div>
  );
}

function ConfigMissing() {
  return (
    <div className="container-page max-w-lg py-16">
      <h1 className="text-2xl font-black">Configuration needed</h1>
      <p className="mt-2 text-ink-soft">Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> (see <code>.env.example</code>) and rebuild.</p>
    </div>
  );
}

export default function App() {
  if (!isSupabaseConfigured) return <ConfigMissing />;
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <Suspense fallback={<PageSpinner />}>
            <Routes>
              <Route element={<Layout />}>
                <Route index element={<Home />} />
                <Route path="timetable" element={<Timetable />} />
                <Route path="memberships" element={<Memberships />} />
                <Route path="login" element={<Login />} />
                <Route path="register" element={<Register />} />
                <Route path="forgot-password" element={<ForgotPassword />} />
                <Route path="reset-password" element={<ResetPassword />} />
                <Route path="terms" element={<Terms />} />
                <Route path="privacy" element={<Privacy />} />
                <Route path="checkout/success" element={<RequireAuth><CheckoutSuccess /></RequireAuth>} />
                <Route path="checkout/cancelled" element={<CheckoutCancelled />} />
                <Route path="checkout/:code" element={<RequireAuth><Checkout /></RequireAuth>} />
                <Route path="account" element={<RequireAuth><Account /></RequireAuth>} />
                <Route path="teach" element={<RequireStaff><Teach /></RequireStaff>} />
                <Route path="admin" element={<RequireAdmin><AdminLayout /></RequireAdmin>}>
                  <Route index element={<AdminOverview />} />
                  <Route path="timetable" element={<AdminTimetable />} />
                  <Route path="bookings" element={<AdminBookings />} />
                  <Route path="customers" element={<AdminCustomers />} />
                  <Route path="plans" element={<AdminPlans />} />
                  <Route path="styles" element={<AdminStyles />} />
                  <Route path="instructors" element={<AdminInstructors />} />
                  <Route path="audit" element={<AdminAudit />} />
                  <Route path="settings" element={<AdminSettings />} />
                </Route>
                <Route path="*" element={<NotFound />} />
              </Route>
            </Routes>
          </Suspense>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
