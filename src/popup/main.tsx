import { StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import '../ui/styles.css';
import { Popup } from './Popup';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={null}>
      <Popup />
    </Suspense>
  </StrictMode>,
);
