/** Small SVG drawings used by the gate puzzles (no emoji fonts needed). */
import type { IconName, SearchSymbol, ShapeName } from './generators'

export function ClueIcon({ name, size = 22 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      {name === 'candle' && (
        <g>
          <path d="M12 2c2 3 2 5 0 6-2-1-2-3 0-6z" fill="#ffb36b" />
          <rect x="8.5" y="9" width="7" height="12" rx="1.5" fill="#fbf5ea" stroke="#c98f6b" />
          <rect x="6" y="20" width="12" height="2.5" rx="1" fill="#d4a24c" />
        </g>
      )}
      {name === 'mug' && (
        <g>
          <path d="M5 8h11v9a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4z" fill="#2f8f8a" />
          <path d="M16 10h2a3 3 0 0 1 0 6h-2" fill="none" stroke="#2f8f8a" strokeWidth="2" />
          <path d="M8 3c1 1.5-1 2 0 3.5M12 3c1 1.5-1 2 0 3.5" stroke="#c9a88a" fill="none" strokeLinecap="round" />
        </g>
      )}
      {name === 'book' && (
        <g>
          <rect x="4" y="4" width="14" height="17" rx="1.5" fill="#6d3b5c" />
          <rect x="6" y="4" width="2" height="17" fill="#4f2a43" />
          <rect x="10" y="8" width="6" height="2" rx="1" fill="#efe0c8" />
        </g>
      )}
      {name === 'leaf' && <path d="M4 20C4 9 11 4 20 4c0 9-5 16-16 16zM4 20l9-9" fill="#5a9a4b" stroke="#3f7a3a" strokeWidth="1.5" />}
      {name === 'star' && <path d="M12 2l3 6.5 7 .8-5.2 4.8 1.4 7L12 17.6 5.8 21l1.4-7L2 9.3l7-.8z" fill="#e8b93a" stroke="#b9863a" />}
    </svg>
  )
}

export function ClockFace({ hour, minute, size = 64 }: { hour: number; minute: number; size?: number }) {
  const ha = ((hour % 12) + minute / 60) * 30 * (Math.PI / 180)
  const ma = minute * 6 * (Math.PI / 180)
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-label={`clock`}>
      <circle cx="32" cy="32" r="29" fill="#fbf5ea" stroke="#7a4a2b" strokeWidth="4" />
      {Array.from({ length: 12 }, (_, i) => {
        const a = (i * 30 * Math.PI) / 180
        return <circle key={i} cx={32 + Math.sin(a) * 23} cy={32 - Math.cos(a) * 23} r={i % 3 === 0 ? 2.2 : 1.2} fill="#7a6258" />
      })}
      <line x1="32" y1="32" x2={32 + Math.sin(ha) * 13} y2={32 - Math.cos(ha) * 13} stroke="#3b2a26" strokeWidth="3.5" strokeLinecap="round" />
      <line x1="32" y1="32" x2={32 + Math.sin(ma) * 20} y2={32 - Math.cos(ma) * 20} stroke="#e07b39" strokeWidth="2" strokeLinecap="round" />
      <circle cx="32" cy="32" r="2.5" fill="#d4a24c" />
    </svg>
  )
}

export function ShapeIcon({ shape, color, size = 36 }: { shape: ShapeName; color: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden>
      {shape === 'circle' && <circle cx="20" cy="20" r="14" fill={color} />}
      {shape === 'square' && <rect x="7" y="7" width="26" height="26" rx="4" fill={color} />}
      {shape === 'triangle' && <path d="M20 5l16 29H4z" fill={color} strokeLinejoin="round" />}
      {shape === 'diamond' && <path d="M20 3l15 17-15 17L5 20z" fill={color} />}
      {shape === 'star' && <path d="M20 3l5 10.5 11.5 1.3-8.6 7.9 2.4 11.4L20 28.4 9.7 34.1l2.4-11.4L3.5 14.8 15 13.5z" fill={color} />}
    </svg>
  )
}

/** The hidden target symbol, drawn around (0,0) at roughly 14 px. */
export function TargetSymbol({ symbol }: { symbol: SearchSymbol }) {
  const fill = '#c9a05a'
  const stroke = '#9a7440'
  if (symbol === 'key')
    return (
      <g>
        <circle cx="-4" cy="0" r="3.6" fill="none" stroke={fill} strokeWidth="2.4" />
        <path d="M-0.5 0h8M5 0v3M7.5 0v2.2" stroke={fill} strokeWidth="2.2" strokeLinecap="round" />
        <circle cx="-4" cy="0" r="5" fill="none" stroke={stroke} strokeWidth="0.5" opacity="0.5" />
      </g>
    )
  if (symbol === 'star')
    return <path d="M0-7l2 4.4 4.8.6-3.6 3.3 1 4.8L0 3.7-4.2 6l1-4.8-3.6-3.3 4.8-.6z" fill={fill} stroke={stroke} strokeWidth="0.6" />
  return <path d="M0 6C-7 1-7-5-3.5-5.5-1.5-5.8 0-4 0-3c0-1 1.5-2.8 3.5-2.5C7-5 7 1 0 6z" fill={fill} stroke={stroke} strokeWidth="0.6" />
}

export function Padlock({ open, size = 96 }: { open: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 96 96" aria-hidden>
      <g className={open ? 'gate-shackle-open' : undefined} style={{ transformOrigin: '66px 44px', transformBox: 'view-box' }}>
        <path d="M30 46V32a18 18 0 0 1 36 0v14" fill="none" stroke="#9aa3a8" strokeWidth="9" strokeLinecap="round" />
        <path d="M30 46V32a18 18 0 0 1 36 0v14" fill="none" stroke="#c9d0d4" strokeWidth="3" strokeLinecap="round" />
      </g>
      <rect x="18" y="42" width="60" height="46" rx="10" fill="#d4a24c" stroke="#8a5a1e" strokeWidth="3" />
      <rect x="24" y="47" width="48" height="6" rx="3" fill="#f0c977" opacity="0.7" />
      <circle cx="48" cy="63" r="6" fill="#5b3b1a" />
      <rect x="45.5" y="65" width="5" height="12" rx="2" fill="#5b3b1a" />
    </svg>
  )
}

export function SafeDial({ size = 44, spinning = false }: { size?: number; spinning?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden className={spinning ? 'gate-dial-spin' : undefined}>
      <circle cx="24" cy="24" r="22" fill="#3d4248" stroke="#d4a24c" strokeWidth="3" />
      {Array.from({ length: 16 }, (_, i) => {
        const a = (i * 22.5 * Math.PI) / 180
        return (
          <line key={i} x1={24 + Math.sin(a) * 15} y1={24 - Math.cos(a) * 15} x2={24 + Math.sin(a) * (i % 4 ? 18 : 20)} y2={24 - Math.cos(a) * (i % 4 ? 18 : 20)} stroke="#f0c977" strokeWidth="1.5" />
        )
      })}
      <circle cx="24" cy="24" r="10" fill="#d4a24c" stroke="#8a5a1e" strokeWidth="1.5" />
      <rect x="22.5" y="13" width="3" height="8" rx="1.5" fill="#8a5a1e" />
    </svg>
  )
}
