import React, { useState, useEffect, useCallback, createContext, useContext } from 'react';
import Icon from './AppIcon';


var ToastContext = createContext(null);

var TOAST_ICONS = {
  success: { name: 'CheckCircle', color: '#ffffff' },
  error:   { name: 'AlertCircle', color: '#ffffff' },
  warning: { name: 'AlertTriangle', color: '#ffffff' },
  info:    { name: 'Info', color: '#ffffff' },
};

var TOAST_STYLES = {
  success: { background: '#059669', border: '1px solid #047857' },
  error:   { background: '#dc2626', border: '1px solid #b91c1c' },
  warning: { background: '#d97706', border: '1px solid #b45309' },
  info:    { background: '#002147', border: '1px solid #003366' },
};

var ToastItem = function(props) {
  var toast = props.toast;
  var onRemove = props.onRemove;
  var visibleState = useState(false);
  var visible = visibleState[0];
  var setVisible = visibleState[1];

  useEffect(function() {
    var showTimer = setTimeout(function() { setVisible(true); }, 10);
    var hideTimer = setTimeout(function() {
      setVisible(false);
      setTimeout(function() { onRemove(toast.id); }, 300);
    }, toast.duration || 4000);

    return function() {
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
    };
  }, [toast.id, toast.duration, onRemove]);

  var iconConfig = TOAST_ICONS[toast.type] || TOAST_ICONS.info;
  var styleConfig = TOAST_STYLES[toast.type] || TOAST_STYLES.info;

  return (
    <div
      style={Object.assign({}, styleConfig, {
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
        padding: '0.875rem 1rem',
        borderRadius: 12,
        boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
        maxWidth: '22rem',
        width: '100%',
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateX(0)' : 'translateX(100%)',
        transition: 'all 0.3s ease',
        marginBottom: '0.5rem',
      })}
    >
      <div style={{ flexShrink: 0 }}>
        <Icon name={iconConfig.name} size={18} color={iconConfig.color} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {toast.title && (
          <p style={{ color: '#ffffff', fontSize: '0.8125rem', fontWeight: 700, margin: '0 0 0.125rem' }}>
            {toast.title}
          </p>
        )}
        <p style={{ color: 'rgba(255,255,255,0.9)', fontSize: '0.8125rem', margin: 0, lineHeight: 1.4 }}>
          {toast.message}
        </p>
      </div>
      <button
        onClick={function() { onRemove(toast.id); }}
        style={{ flexShrink: 0, background: 'transparent', border: 'none', cursor: 'pointer', padding: '0.125rem', opacity: 0.7 }}
      >
        <Icon name="X" size={14} color="#ffffff" />
      </button>
    </div>
  );
};

export var ToastProvider = function(props) {
  var toastsState = useState([]);
  var toasts = toastsState[0];
  var setToasts = toastsState[1];

  var addToast = useCallback(function(message, type, title, duration) {
    var id = Date.now().toString() + Math.random().toString(36).slice(2);
    var newToast = {
      id: id,
      message: message,
      type: type || 'info',
      title: title || null,
      duration: duration || 4000,
    };
    setToasts(function(prev) {
      // Max 5 toasts at once
      var updated = prev.length >= 5 ? prev.slice(1) : prev;
      return updated.concat([newToast]);
    });
    return id;
  }, []);

  var removeToast = useCallback(function(id) {
    setToasts(function(prev) {
      return prev.filter(function(t) { return t.id !== id; });
    });
  }, []);

  var toast = {
    success: function(message, title) { return addToast(message, 'success', title); },
    error: function(message, title) { return addToast(message, 'error', title, 6000); },
    warning: function(message, title) { return addToast(message, 'warning', title, 5000); },
    info: function(message, title) { return addToast(message, 'info', title); },
  };

  return (
    <ToastContext.Provider value={toast}>
      {props.children}
      <div
        style={{
          position: 'fixed',
          bottom: '1.5rem',
          right: '1.5rem',
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
        }}
      >
        {toasts.map(function(t) {
          return (
            <ToastItem key={t.id} toast={t} onRemove={removeToast} />
          );
        })}
      </div>
    </ToastContext.Provider>
  );
};

export var useToast = function() {
  var context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};

export default ToastProvider;
