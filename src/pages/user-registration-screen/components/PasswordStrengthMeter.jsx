import React from 'react';

const PasswordStrengthMeter = ({ password }) => {
  const checks = [
    { label: 'At least 8 characters', test: (p) => p?.length >= 8 },
    { label: 'Uppercase letter', test: (p) => /[A-Z]/?.test(p) },
    { label: 'Lowercase letter', test: (p) => /[a-z]/?.test(p) },
    { label: 'Number', test: (p) => /[0-9]/?.test(p) },
    { label: 'Special character', test: (p) => /[^A-Za-z0-9]/?.test(p) },
  ];

  const passed = checks?.filter((c) => c?.test(password))?.length;

  const getStrength = () => {
    if (passed === 0) return { label: '', color: '', bars: 0 };
    if (passed <= 2) return { label: 'Weak', color: 'bg-red-500', bars: 1 };
    if (passed === 3) return { label: 'Fair', color: 'bg-yellow-500', bars: 2 };
    if (passed === 4) return { label: 'Good', color: 'bg-blue-500', bars: 3 };
    return { label: 'Strong', color: 'bg-emerald-500', bars: 4 };
  };

  const strength = getStrength();

  if (!password) return null;

  return (
    <div className="mt-2 space-y-2">
      {/* Strength bars */}
      <div className="flex items-center gap-2">
        <div className="flex gap-1 flex-1">
          {[1, 2, 3, 4]?.map((bar) => (
            <div
              key={bar}
              className={`h-1.5 flex-1 rounded-full transition-all duration-300 ${
                bar <= strength?.bars ? strength?.color : 'bg-slate-600'
              }`}
            />
          ))}
        </div>
        {strength?.label && (
          <span className={`text-xs font-medium ${
            strength?.bars === 1 ? 'text-red-400' :
            strength?.bars === 2 ? 'text-yellow-400' :
            strength?.bars === 3 ? 'text-blue-400' : 'text-emerald-400'
          }`}>{strength?.label}</span>
        )}
      </div>
      {/* Requirements checklist */}
      <div className="grid grid-cols-1 gap-1">
        {checks?.map((check, i) => {
          const ok = check?.test(password);
          return (
            <div key={i} className="flex items-center gap-1.5">
              <div className={`w-3.5 h-3.5 rounded-full flex items-center justify-center flex-shrink-0 transition-colors ${
                ok ? 'bg-emerald-500' : 'bg-slate-600'
              }`}>
                {ok && (
                  <svg className="w-2 h-2 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>
              <span className={`text-xs transition-colors ${ok ? 'text-emerald-400' : 'text-slate-500'}`}>
                {check?.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default PasswordStrengthMeter;
