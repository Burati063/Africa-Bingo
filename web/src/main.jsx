import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { ToastProvider } from './components/Toast.jsx';
import { initTelegram } from './telegram.js';
import './styles.css';

initTelegram();

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <App />
      </ToastProvider>
    </BrowserRouter>
  </React.StrictMode>,
);

// The branded splash is plain HTML so end users see the name and logo on the
// very first paint, before the app bundle finishes loading.
document.getElementById('boot-splash')?.remove();
