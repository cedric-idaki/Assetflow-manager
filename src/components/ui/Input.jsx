import React, { forwardRef, useId } from 'react';
import { formatKEPhone } from '../../utils/phoneUtils';

const Input = forwardRef((
  {
    label,
    error,
    hint,
    prefix,
    suffix,
    className = '',
    containerClassName = '',
    type = 'text',
    disabled = false,
    required = false,
    ...props
  },
  ref
) => {
  // Without this the <label> is only NEAR the input, not attached to it: a
  // screen reader announces an unlabelled box, and clicking the text does
  // nothing. A caller-supplied id still wins, since props spread last.
  const generatedId = useId();
  const inputId = props.id || generatedId;

  const inputClasses = [
    'w-full px-3 py-2 text-sm bg-background border rounded-lg text-foreground placeholder-muted-foreground',
    'focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary',
    'transition-all duration-200',
    'disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-muted',
    error ? 'border-error focus:ring-error/30 focus:border-error' : 'border-border',
    prefix ? 'pl-9' : '',
    suffix ? 'pr-9' : '',
    className,
  ]?.filter(Boolean)?.join(' ');

  return (
    <div className={`space-y-1 ${containerClassName}`}>
      {label && (
        <label htmlFor={inputId} className="block text-sm font-medium text-foreground">
          {label}
          {required && <span className="text-error ml-1">*</span>}
        </label>
      )}
      <div className="relative">
        {prefix && (
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-muted-foreground">
            {prefix}
          </div>
        )}
        <input
          ref={ref}
          id={inputId}
          type={type}
          disabled={disabled}
          required={required}
          className={inputClasses}
          {...props}
        />
        {suffix && (
          <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-muted-foreground">
            {suffix}
          </div>
        )}
      </div>
      {error && <p className="text-xs text-error">{error}</p>}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
});

Input.displayName = 'Input';
export default Input;