import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './lib/auth'
import { ToastProvider } from './lib/toast'
import { I18nProvider } from './lib/i18n'
import { ViewProvider } from './lib/view'
import './index.css'

import { registerServiceWorker } from './lib/push'
void registerServiceWorker()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nProvider>
      <BrowserRouter>
        <ToastProvider>
          <AuthProvider>
            <ViewProvider>
              <App />
            </ViewProvider>
          </AuthProvider>
        </ToastProvider>
      </BrowserRouter>
    </I18nProvider>
  </React.StrictMode>,
)
