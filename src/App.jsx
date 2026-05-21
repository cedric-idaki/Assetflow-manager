import React from 'react';
import Routes from './Routes';
import { AuthProvider } from './contexts/AuthContext';
import { ToastProvider } from './components/Toast';

function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <Routes />
      </AuthProvider>
    </ToastProvider>
  );
}

export default App;