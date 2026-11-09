import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { ConfirmProvider } from './components/ConfirmProvider'
import { SiteLanguageProvider } from './lib/siteLanguage'
import './styles.css'

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch((error: unknown) => {
      console.error('PWA service worker ro‘yxatdan o‘tmadi:', error)
    })
  })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <SiteLanguageProvider>
        <ConfirmProvider>
          <App />
        </ConfirmProvider>
      </SiteLanguageProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
