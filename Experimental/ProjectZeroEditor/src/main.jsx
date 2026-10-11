import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('Project Zero Road Editor: #root container is missing');

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
