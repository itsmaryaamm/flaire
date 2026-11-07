import { Navigate, Outlet, Route, Routes, useLocation, useParams } from 'react-router-dom'
import { useAuth } from './lib/auth'
import { Layout } from './components/Layout'
import { PageLoader } from './components/Spinner'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import ForgotPage from './pages/ForgotPage'
import ResetPage from './pages/ResetPage'
import HomePage from './pages/HomePage'
import EmployeesPage from './pages/EmployeesPage'
import EmployeeDetailPage from './pages/EmployeeDetailPage'
import ActivityPage from './pages/ActivityPage'
import SettingsPage from './pages/SettingsPage'
import WelcomePage from './pages/WelcomePage'

/** Needs a session. Users without a company are sent to the walkthrough; /welcome itself never needs a company. */
function RequireAuth() {
  const { isAuthenticated, needsOnboarding, loading } = useAuth()
  const location = useLocation()
  if (loading) return <PageLoader />
  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (needsOnboarding && location.pathname !== '/welcome') return <Navigate to="/welcome" replace />
  return <Outlet />
}

function PublicOnly() {
  const { isAuthenticated, needsOnboarding, loading } = useAuth()
  if (loading) return <PageLoader />
  if (isAuthenticated) return <Navigate to={needsOnboarding ? '/welcome' : '/'} replace />
  return <Outlet />
}

/** Old /agents/:id links keep working. */
function AgentRedirect() {
  const { id } = useParams()
  return <Navigate to={`/employees/${id}`} replace />
}

export default function App() {
  return (
    <Routes>
      <Route element={<PublicOnly />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/forgot" element={<ForgotPage />} />
      </Route>
      {/* Not PublicOnly: in Supabase mode the recovery link signs the user in before they choose a password. */}
      <Route path="/reset" element={<ResetPage />} />
      <Route element={<RequireAuth />}>
        <Route path="/welcome" element={<WelcomePage />} />
        <Route element={<Layout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/employees" element={<EmployeesPage />} />
          <Route path="/employees/:id" element={<EmployeeDetailPage />} />
          <Route path="/activity" element={<ActivityPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          {/* Old routes */}
          <Route path="/m" element={<Navigate to="/" replace />} />
          <Route path="/approvals" element={<Navigate to="/" replace />} />
          <Route path="/transactions" element={<Navigate to="/activity" replace />} />
          <Route path="/agents" element={<Navigate to="/employees" replace />} />
          <Route path="/agents/:id" element={<AgentRedirect />} />
          <Route path="/budgets" element={<Navigate to="/settings" replace />} />
          <Route path="/cards" element={<Navigate to="/settings" replace />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
