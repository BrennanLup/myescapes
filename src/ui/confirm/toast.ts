/**
 * A tiny DOM toast that outlives the overlay (the overlay unmounts as soon as the
 * entry is saved, so the toast cannot be part of its React tree).
 */
export function showToast(text: string, ms = 2200): void {
  if (typeof document === 'undefined') return
  const el = document.createElement('div')
  el.setAttribute('role', 'status')
  el.dataset.testid = 'confirm-toast'
  el.textContent = text
  Object.assign(el.style, {
    position: 'fixed',
    left: '50%',
    bottom: '32px',
    transform: 'translate(-50%, 16px)',
    opacity: '0',
    zIndex: '80',
    padding: '12px 22px',
    borderRadius: '999px',
    background: '#fff7ec',
    color: '#3b2a26',
    border: '2px solid #e07b39',
    boxShadow: '0 18px 50px rgba(60, 30, 20, 0.35)',
    font: "600 17px 'Fredoka', 'Nunito', system-ui, sans-serif",
    transition: 'opacity 220ms ease, transform 220ms ease',
    pointerEvents: 'none',
  } satisfies Partial<CSSStyleDeclaration>)
  document.body.appendChild(el)
  requestAnimationFrame(() => {
    el.style.opacity = '1'
    el.style.transform = 'translate(-50%, 0)'
  })
  setTimeout(() => {
    el.style.opacity = '0'
    el.style.transform = 'translate(-50%, 16px)'
    setTimeout(() => el.remove(), 300)
  }, ms)
}
