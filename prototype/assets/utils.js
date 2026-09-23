/**
 * Shared HTML escaping helper for dashboard prototypes.
 * Neutralizes XSS when interpolating arbitrary text, model IDs,
 * errors, or run IDs into HTML templates.
 */
function escapeHtml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

if (typeof window !== 'undefined') {
  window.escapeHtml = escapeHtml;
}
if (typeof globalThis !== 'undefined') {
  globalThis.escapeHtml = escapeHtml;
}
