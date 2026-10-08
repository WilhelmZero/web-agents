import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { LanguageProvider } from './i18n';
import ServerGate from './ServerGate';
import { installAiTransport } from './aiTransport';
import './styles.css';

installAiTransport();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LanguageProvider>
      <ServerGate><App /></ServerGate>
    </LanguageProvider>
  </React.StrictMode>,
);
