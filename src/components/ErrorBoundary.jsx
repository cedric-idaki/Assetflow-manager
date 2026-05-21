import React from 'react';
import Icon from './AppIcon';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      retryCount: 0,
    };
    this.handleRetry = this.handleRetry.bind(this);
    this.handleGoHome = this.handleGoHome.bind(this);
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error: error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo: errorInfo });

    // Log error details
    console.error('[ErrorBoundary] Component error caught:', {
      message: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
      timestamp: new Date().toISOString(),
    });

    // Mark error for any global handlers
    error.__ErrorBoundary = true;
    if (window.__COMPONENT_ERROR__) {
      window.__COMPONENT_ERROR__(error, errorInfo);
    }
  }

  handleRetry() {
    this.setState(function(prev) {
      return {
        hasError: false,
        error: null,
        errorInfo: null,
        retryCount: prev.retryCount + 1,
      };
    });
  }

  handleGoHome() {
    window.location.href = '/';
  }

  render() {
    if (this.state.hasError) {
      var error = this.state.error;
      var retryCount = this.state.retryCount;

      // Determine error type for better messaging
      var isNetworkError = error && (
        error.message.includes('fetch') ||
        error.message.includes('network') ||
        error.message.includes('Network') ||
        error.message.includes('Failed to fetch')
      );

      var isAuthError = error && (
        error.message.includes('auth') ||
        error.message.includes('Auth') ||
        error.message.includes('unauthorized') ||
        error.message.includes('JWT')
      );

      var title = 'Something went wrong';
      var description = 'We encountered an unexpected error. Please try again.';
      var iconName = 'AlertTriangle';
      var iconColor = '#ef4444';

      if (isNetworkError) {
        title = 'Connection Problem';
        description = 'Unable to connect to the server. Please check your internet connection and try again.';
        iconName = 'WifiOff';
        iconColor = '#f59e0b';
      } else if (isAuthError) {
        title = 'Session Expired';
        description = 'Your session has expired. Please sign in again to continue.';
        iconName = 'Lock';
        iconColor = '#f59e0b';
      }

      return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8f9fa', padding: '1.5rem' }}>
          <div style={{ textAlign: 'center', maxWidth: '28rem', width: '100%', background: '#ffffff', borderRadius: 16, padding: '2.5rem', boxShadow: '0 4px 24px rgba(0,0,0,0.08)', border: '1px solid #e5e7eb' }}>

            <div style={{ width: 64, height: 64, borderRadius: '50%', background: isNetworkError ? '#fef3c7' : '#fee2e2', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem' }}>
              <Icon name={iconName} size={28} color={iconColor} />
            </div>

            <h1 style={{ fontSize: '1.375rem', fontWeight: 700, color: '#111827', marginBottom: '0.5rem' }}>
              {title}
            </h1>

            <p style={{ color: '#6b7280', fontSize: '0.9rem', lineHeight: 1.6, marginBottom: '1.5rem' }}>
              {description}
            </p>

            {error && process.env.NODE_ENV === 'development' && (
              <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: '0.75rem', marginBottom: '1.5rem', textAlign: 'left' }}>
                <p style={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151', marginBottom: '0.25rem' }}>
                  Error Details (development only):
                </p>
                <p style={{ fontSize: '0.7rem', color: '#ef4444', fontFamily: 'monospace', wordBreak: 'break-word', margin: 0 }}>
                  {error.message}
                </p>
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
              {retryCount < 3 && (
                <button
                  onClick={this.handleRetry}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.625rem 1.25rem', borderRadius: 8, background: '#002147', color: '#ffffff', fontSize: '0.875rem', fontWeight: 600, border: 'none', cursor: 'pointer' }}
                >
                  <Icon name="RefreshCw" size={15} color="#ffffff" />
                  Try Again
                </button>
              )}
              <button
                onClick={this.handleGoHome}
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.625rem 1.25rem', borderRadius: 8, background: 'transparent', color: '#374151', fontSize: '0.875rem', fontWeight: 600, border: '1px solid #d1d5db', cursor: 'pointer' }}
              >
                <Icon name="Home" size={15} color="currentColor" />
                Go Home
              </button>
              {isAuthError && (
                <button
                  onClick={function() { window.location.href = '/login'; }}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.625rem 1.25rem', borderRadius: 8, background: '#28a745', color: '#ffffff', fontSize: '0.875rem', fontWeight: 600, border: 'none', cursor: 'pointer' }}
                >
                  <Icon name="LogIn" size={15} color="#ffffff" />
                  Sign In
                </button>
              )}
            </div>

            {retryCount >= 3 && (
              <p style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: '1rem' }}>
                Still having issues? Try refreshing the page or contact support.
              </p>
            )}

            <p style={{ fontSize: '0.7rem', color: '#d1d5db', marginTop: '1.5rem' }}>
              Error ID: {Date.now().toString(36).toUpperCase()}
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
