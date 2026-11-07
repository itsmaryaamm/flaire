import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from './lib/auth'
import { Layout } from './components/Layout'
import { PageLoader } from './components/Spinner'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import DashboardPage from './pages/DashboardPage'
import AgentsPage from './pages/AgentsPage'
import AgentConsolePage from './pages/AgentConsolePage'
import BudgetsPage from './pages/BudgetsPage'
import ApprovalsPage from './pages/ApprovalsPage'
import TransactionsPage from './pages/TransactionsPage'
import CardsPage from './pages/CardsPage'
import SettingsPage from './pages/SettingsPage'
import MobileApp from './pages/MobileApp'
import { isNarrowViewport, prefersFullDashboard } from './lib/prefs'

/**
 * Landing on "/" from a phone-sized viewport goes to the phone view, unless the user asked for the
 * full dashboard (?full=1 once, or the remembered preference).
 */
function HomeGate() {
  const location = useLocation()
  const wantsFull = new URLSearchParams(location.search).get('full') === '1'
  if (!wantsFull && isNarrowViewport() && !prefersFullDashboard()) return <Navigate to="/m" replace />
  return <DashboardPage />
}

function RequireAuth() {
  const { isAuthenticated, loading } = useAuth()
  const location = useLocation()
  if (loading) return <PageLoader />
  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return <Outlet />
}

function PublicOnly() {
  const { isAuthenticated, loading } = useAuth()
  if (loading) return <PageLoader />
  if (isAuthenticated) return <Navigate to="/" replace />
  return <Outlet />
}

export default function App() {
  return (
    <Routes>
      <Route element={<PublicOnly />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
      </Route>
      <Route element={<RequireAuth />}>
        <Route path="/m" element={<MobileApp />} />
        <Route element={<Layout />}>
          <Route path="/" element={<HomeGate />} />
          <Route path="/agents" element={<AgentsPage />} />
          <Route path="/agents/:id" element={<AgentConsolePage />} />
          <Route path="/budgets" element={<BudgetsPage />} />
          <Route path="/approvals" element={<ApprovalsPage />} />
          <Route path="/transactions" element={<TransactionsPage />} />
          <Route path="/cards" element={<CardsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
