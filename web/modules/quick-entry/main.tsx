import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QuickEntryApp } from './ui/QuickEntryApp.js';
import './ui/quick-entry.css';

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <QuickEntryApp />
    </StrictMode>,
  );
}
