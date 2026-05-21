import React from 'react';
import { formatKEPhone } from '../../utils/phoneUtils';

const Button = ({
  children,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  onClick,
  type = 'button',
  className = '',
  icon,
  iconPosition = 'left',
  fullWidth = false,
  ...props
}) => {
  const baseClasses = 'inline-flex items-center justify-center font-medium rounded-lg transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed select-none';

  const variants = {
    primary: 'bg-primary text-primary-foreground hover:opacity-90 focus:ring-primary shadow-sm shadow-primary/20',
    secondary: 'bg-secondary text-secondary-foreground hover:opacity-90 focus:ring-secondary',
    outline: 'border border-border bg-transparent text-foreground hover:bg-muted focus:ring-primary',
    ghost: 'bg-transparent text-foreground hover:bg-muted focus:ring-primary',
    destructive: 'bg-destructive text-destructive-foreground hover:opacity-90 focus:ring-destructive',
    success: 'bg-success text-success-foreground hover:opacity-90 focus:ring-success',
    warning: 'bg-warning text-warning-foreground hover:opacity-90 focus:ring-warning',
    link: 'bg-transparent text-primary hover:underline p-0 h-auto focus:ring-primary',
  };

  const sizes = {
    xs: 'h-7 px-2.5 text-xs gap-1.5',
    sm: 'h-8 px-3 text-sm gap-1.5',
    md: 'h-9 px-4 text-sm gap-2',
    lg: 'h-10 px-5 text-base gap-2',
    xl: 'h-12 px-6 text-base gap-2',
    icon: 'h-9 w-9 p-0',
  };

  const classes = [
    baseClasses,
    variants?.[variant] || variants?.primary,
    sizes?.[size] || sizes?.md,
    fullWidth ? 'w-full' : '',
    className,
  ]?.filter(Boolean)?.join(' ');

  return (
    <button
      type={type}
      disabled={disabled || loading}
      onClick={onClick}
      className={classes}
      {...props}
    >
      {loading ? (
        <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
      ) : (
        icon && iconPosition === 'left' && <span className="flex-shrink-0">{icon}</span>
      )}
      {size !== 'icon' && children}
      {!loading && icon && iconPosition === 'right' && <span className="flex-shrink-0">{icon}</span>}
    </button>
  );
};

export default Button;