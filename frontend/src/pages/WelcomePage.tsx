import { Navigate } from 'react-router-dom'

/** The old walkthrough lives at /setup now; old links and bookmarks keep working. */
export default function WelcomePage() {
  return <Navigate to="/setup" replace />
}
