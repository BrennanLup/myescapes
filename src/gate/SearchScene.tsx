/** Generated cozy-room clutter scene for the search-the-image puzzle. */
import type { ClutterItem, SearchChallenge } from './generators'
import { TargetSymbol } from './icons'

function Clutter({ item }: { item: ClutterItem }) {
  const { x, y, scale: s, color, v } = item
  switch (item.kind) {
    case 'book': {
      const h = 26 + v * 16
      const w = 9 + v * 4
      return (
        <g transform={`translate(${x} ${y}) scale(${s})`}>
          <rect x={0} y={-h} width={w} height={h} rx={1.2} fill={color} stroke="#3b2a26" strokeOpacity={0.25} />
          <rect x={1.5} y={-h + 5} width={w - 3} height={2} fill="#fbf5ea" opacity={0.6} />
          <rect x={1.5} y={-8} width={w - 3} height={1.5} fill="#fbf5ea" opacity={0.4} />
        </g>
      )
    }
    case 'mug':
      return (
        <g transform={`translate(${x} ${y}) scale(${s})`}>
          <path d="M0 -16h13v11a5 5 0 0 1-5 5H5a5 5 0 0 1-5-5z" fill={color} />
          <path d="M13 -13h2.5a3.5 3.5 0 0 1 0 7H13" fill="none" stroke={color} strokeWidth={2.2} />
          <ellipse cx={6.5} cy={-16} rx={6.5} ry={1.6} fill="#5b3b1a" opacity={0.5} />
        </g>
      )
    case 'plant':
      return (
        <g transform={`translate(${x} ${y}) scale(${s})`}>
          <path d="M-7 -12h14l-2 12h-10z" fill="#c0603f" />
          {[-30, -10, 10, 30, 0].map((a, i) => (
            <ellipse key={i} cx={0} cy={-22 - (i === 4 ? 6 : 0)} rx={4} ry={11} fill={i % 2 ? '#3f7a3a' : '#5a9a4b'} transform={`rotate(${a + v * 20} 0 -12)`} />
          ))}
        </g>
      )
    case 'candle':
      return (
        <g transform={`translate(${x} ${y}) scale(${s})`}>
          <rect x={-4} y={-18 - v * 6} width={8} height={18 + v * 6} rx={1.5} fill="#fbf5ea" stroke="#c98f6b" strokeWidth={0.8} />
          <path d={`M0 ${-26 - v * 6}c2.5 3 2.5 5 0 6.5-2.5-1.5-2.5-3.5 0-6.5z`} fill="#ffb36b" />
        </g>
      )
    case 'frame': {
      const w = 46 * s
      const h = 34 * s
      return (
        <g transform={`translate(${x} ${y})`}>
          <rect x={-w / 2} y={0} width={w} height={h} fill="#7a4a2b" rx={2} />
          <rect x={-w / 2 + 4} y={4} width={w - 8} height={h - 8} fill="#f7d9b8" />
          {v < 0.5 ? (
            <path d={`M${-w / 2 + 4} ${h - 4}l${w * 0.3} ${-h * 0.45}l${w * 0.2} ${h * 0.25}l${w * 0.15} ${-h * 0.15}L${w / 2 - 4} ${h - 4}z`} fill={color} opacity={0.8} />
          ) : (
            <circle cx={0} cy={h / 2} r={h * 0.25} fill={color} opacity={0.8} />
          )}
        </g>
      )
    }
    case 'yarn':
      return (
        <g transform={`translate(${x} ${y}) scale(${s})`}>
          <circle cx={0} cy={-8} r={8} fill={color} />
          <path d="M-6 -12c4 2 8 2 12 0M-7 -7c5 2 9 2 14 0M-5 -3c3 1 7 1 10 0" stroke="#fbf5ea" strokeOpacity={0.45} fill="none" />
          <path d="M8 -6c6 2 8 5 14 5" stroke={color} fill="none" />
        </g>
      )
  }
}

export function SearchScene({
  challenge,
  found,
  onFind,
  onMiss,
  disabled,
}: {
  challenge: SearchChallenge
  found: string[]
  onFind(id: string): void
  onMiss(): void
  disabled?: boolean
}) {
  const { width, height, clutter, targets, symbol, shelves } = challenge.data
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="block h-auto w-full touch-manipulation rounded-xl"
      style={{ cursor: 'crosshair' }}
      role="img"
      aria-label="A cluttered cozy room. Find the hidden symbols."
      onClick={() => !disabled && onMiss()}
    >
      <defs>
        <linearGradient id="gate-wall" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f1e4d1" />
          <stop offset="1" stopColor="#e9d7c0" />
        </linearGradient>
        <radialGradient id="gate-glow" cx="0.8" cy="0.1" r="0.7">
          <stop offset="0" stopColor="#ffb36b" stopOpacity="0.35" />
          <stop offset="1" stopColor="#ffb36b" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width={width} height={height} fill="url(#gate-wall)" />
      <rect y={height - 50} width={width} height={50} fill="#a96a3f" />
      {Array.from({ length: 8 }, (_, i) => (
        <line key={i} x1={i * 55 + 10} y1={height - 50} x2={i * 55 - 20} y2={height} stroke="#7a4a2b" strokeOpacity={0.3} />
      ))}
      <rect y={height - 54} width={width} height={5} fill="#f3e7d6" />
      {shelves.map((sy, i) => (
        <g key={i}>
          <rect x={4} y={sy} width={width - 8} height={7} rx={2} fill="#c88a52" />
          <rect x={4} y={sy + 7} width={width - 8} height={3} fill="#7a4a2b" opacity={0.45} />
        </g>
      ))}
      {clutter.map((c, i) => (
        <Clutter key={i} item={c} />
      ))}
      <rect width={width} height={height} fill="url(#gate-glow)" pointerEvents="none" />
      {targets.map((t, i) => {
        const isFound = found.includes(t.id)
        return (
          <g
            key={t.id}
            data-testid={`gate-target-${i}`}
            data-found={isFound ? 'true' : 'false'}
            transform={`translate(${t.x} ${t.y})`}
            style={{ cursor: 'pointer' }}
            onClick={(e) => {
              e.stopPropagation()
              if (!disabled && !isFound) onFind(t.id)
            }}
          >
            <g transform={`rotate(${t.rotation}) scale(${t.scale})`}>
              <TargetSymbol symbol={symbol} />
            </g>
            {/* Generous invisible hit area for fingers. */}
            <circle r={16} fill="transparent" />
            {isFound && (
              <g pointerEvents="none">
                <circle r={13} fill="none" stroke="#4f9d5a" strokeWidth={3} />
                <path d="M-5 0l3.5 3.5L6 -5" stroke="#4f9d5a" strokeWidth={3} fill="none" strokeLinecap="round" transform="translate(9 -9) scale(0.7)" />
              </g>
            )}
          </g>
        )
      })}
    </svg>
  )
}
