import { StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import '../ui/styles.css';
import { Options } from './Options';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={null}>
      <Options />
    </Suspense>
  </StrictMode>,
);
