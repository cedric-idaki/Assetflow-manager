export const formatKEPhone = (value) => {
  if (!value) return '';
  let digits = value.replace(/[^\d]/g, '');
  if (digits.startsWith('254'))    { /* already correct */ }
  else if (digits.startsWith('0')) { digits = '254' + digits.slice(1); }
  else if (digits.startsWith('7') || digits.startsWith('1')) { digits = '254' + digits; }
  digits = digits.slice(0, 12);
  return digits ? '+' + digits : '';
};