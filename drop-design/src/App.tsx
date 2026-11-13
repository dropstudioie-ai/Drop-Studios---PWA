import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import { ConfirmProvider, Spinner, ToastProvider } from './components/ui';
import Login from './pages/Login';
import { Shell } from './components/Shell';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const EditorPage = lazy(() => import('./pages/EditorPage'));
const BrandPage = lazy(() => import('./pages/BrandPage'));
const DropEvents = lazy(() => import('./drop/DropEvents'));
const Invoices = lazy(() => import('./invoices/InvoicesPage'));
const InvoiceWizard = lazy(() => import('./invoices/InvoiceWizard'));
const InvoiceView = lazy(() => import('./invoices/InvoiceView'));
const InvoiceSettings = lazy(() => import('./invoices/InvoiceSettings'));

const Loading = () => <div className="flex h-full items-center justify-center text-muted"><Spinner className="h-7 w-7" /></div>;

function Gate({ children }: { children: ReactNode }) {
  const { loading, session, isStaff } = useAuth();
  if (loading) return <Loading />;
  if (!session || !isStaff) return <Login />;
  return <>{children}</>;
}

/** Invoices: full admins only (not managers or instructors). */
function FinanceOnly({ children }: { children: ReactNode }) {
  const { canInvoice } = useAuth();
  return canInvoice ? <>{children}</> : <Navigate to="/" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <ConfirmProvider>
            <Gate>
              <Suspense fallback={<Loading />}>
                <Routes>
                  <Route path="/design/:id" element={<EditorPage />} />
                  <Route element={<Shell />}>
                    <Route index element={<Dashboard />} />
                    <Route path="brand" element={<BrandPage />} />
                    <Route path="drop" element={<DropEvents />} />
                    <Route path="invoices" element={<FinanceOnly><Invoices /></FinanceOnly>} />
                    <Route path="invoices/new" element={<FinanceOnly><InvoiceWizard /></FinanceOnly>} />
                    <Route path="invoices/settings" element={<FinanceOnly><InvoiceSettings /></FinanceOnly>} />
                    <Route path="invoices/:id" element={<FinanceOnly><InvoiceView /></FinanceOnly>} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Route>
                </Routes>
              </Suspense>
            </Gate>
          </ConfirmProvider>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
