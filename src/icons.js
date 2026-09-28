// Inline SVG icons. All use currentColor so CSS controls their colour.

const svg = (body, vb = '0 0 24 24') => `<svg viewBox="${vb}" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`

const ICONS = {
  crown: svg('<path d="M3 18h18l-1.5-10-4.5 4-3-6-3 6-4.5-4z" fill="currentColor"/><path d="M4 21h16"/>'),
  sword: svg('<path d="M14.5 3.5 20.5 3.5 20.5 9.5 9 21 3 15z" fill="currentColor" stroke="none" opacity=".25"/><path d="M20.5 3.5 9.5 14.5M20.5 3.5v6M20.5 3.5h-6M6 13l5 5M7.5 16.5 4 20"/>'),
  dagger: svg('<path d="M4 20 14 10M14 10l6-6-1 5zM11 7l6 6M6 18l-2 2"/>'),
  check: svg('<path d="M5 12.5 10 17.5 19 7"/>'),
  x: svg('<path d="M6 6 18 18M18 6 6 18"/>'),
  chalice: svg('<path d="M6 3h12c0 5-2.5 8-6 8s-6-3-6-8z" fill="currentColor"/><path d="M12 11v6M8 21h8M9 17h6"/>'),
  skull: svg('<path d="M12 3c-4.4 0-8 3.1-8 7.3 0 2.5 1.3 4.2 3 5.3V19h10v-3.4c1.7-1.1 3-2.8 3-5.3C20 6.1 16.4 3 12 3z" fill="currentColor" stroke="none"/><circle cx="9" cy="11" r="1.8" fill="#0b0f1c" stroke="none"/><circle cx="15" cy="11" r="1.8" fill="#0b0f1c" stroke="none"/><path d="M10 19v2M14 19v2"/>'),
  lady: svg('<path d="M12 2.5c3 4 6 7.2 6 11a6 6 0 0 1-12 0c0-3.8 3-7 6-11z" fill="currentColor" opacity=".3"/><path d="M12 2.5c3 4 6 7.2 6 11a6 6 0 0 1-12 0c0-3.8 3-7 6-11z"/><path d="M9 14a3 3 0 0 0 3 3"/>'),
  hourglass: svg('<path d="M6 3h12M6 21h12M7 3c0 5 5 6 5 9s-5 4-5 9M17 3c0 5-5 6-5 9s5 4 5 9"/>'),
  door: svg('<path d="M14 3H6v18h8M10 12h11M17 8l4 4-4 4"/>'),
  seal: svg('<circle cx="12" cy="12" r="9" fill="currentColor" stroke="none"/><path d="M12 6.5 13.6 10l3.9.3-3 2.5.9 3.8L12 14.6l-3.4 2 .9-3.8-3-2.5 3.9-.3z" fill="#5a0f17" stroke="none"/>'),
}

export const icon = name => `<span class="i i-${name}">${ICONS[name] ?? ''}</span>`

// Heraldic shields
export function crest(kind = 'big') {
  if (kind === 'evil') {
    return `<span class="crest evil">${svg(`
      <path d="M32 4 58 12v20c0 16-11 25-26 30C17 57 6 48 6 32V12z" fill="#3a0b12" stroke="#c9a449" stroke-width="2.5"/>
      <path d="M22 22c6-6 16-6 20 2-6-3-12-1-14 4 6-2 11 1 12 6-5-2-9-1-11 3 3 0 6 2 7 5-9 1-17-6-18-13 0-3 1-5 4-7z" fill="#b3263a" stroke="none"/>
      <circle cx="40" cy="22" r="1.8" fill="#f1d27a" stroke="none"/>`, '0 0 64 64')}</span>`
  }
  const cls = kind === 'good' ? 'good' : kind
  return `<span class="crest ${cls}">${svg(`
    <path d="M32 4 58 12v20c0 16-11 25-26 30C17 57 6 48 6 32V12z" fill="#13254a" stroke="#c9a449" stroke-width="2.5"/>
    <path d="M32 50V20" stroke="#f1d27a" stroke-width="4"/>
    <path d="M32 50l-3-5h6z" fill="#f1d27a" stroke="none"/>
    <path d="M23 20h18" stroke="#c9a449" stroke-width="3.5"/>
    <path d="M32 20v-6" stroke="#8a6a22" stroke-width="3.5"/>
    <circle cx="32" cy="12" r="2.6" fill="#c9a449" stroke="none"/>
    <path d="M17 34l2 2M47 34l-2 2M19 26l1.5 1M45 26l-1.5 1" stroke="#c9a449" stroke-width="1.5" opacity=".8"/>`, '0 0 64 64')}</span>`
}
