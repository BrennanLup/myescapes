/** Tiny inline SVG icon set (no icon library). All icons are 24x24, stroke = currentColor. */
import type { ReactNode, SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function Svg({ size = 20, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  )
}

export const CloseIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
)
export const ChevronLeft = (p: IconProps) => (
  <Svg {...p}>
    <path d="M15 5l-7 7 7 7" />
  </Svg>
)
export const ChevronRight = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 5l7 7-7 7" />
  </Svg>
)
export const CheckIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Svg>
)
export const CrossIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 7l10 10M17 7L7 17" />
  </Svg>
)
export const StarIcon = ({ filled = true, ...p }: IconProps & { filled?: boolean }) => (
  <Svg {...p} fill={filled ? 'currentColor' : 'none'} strokeWidth={1.6}>
    <path d="M12 3.2l2.6 5.5 6 .7-4.5 4.1 1.2 5.9L12 16.4l-5.3 3 1.2-5.9-4.5-4.1 6-.7z" />
  </Svg>
)
/** Open door: escaped. */
export const DoorIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 21h16" />
    <path d="M6 21V4h9v17" />
    <path d="M15 4l4 2v13l-4 2" />
    <circle cx="12.5" cy="12.5" r=".6" fill="currentColor" />
  </Svg>
)
export const TimerIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="13.5" r="7.5" />
    <path d="M12 13.5V9.5M9.5 2.5h5M18.5 6.5l1.5-1.5" />
  </Svg>
)
export const RoomsIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M12 4v6M12 14v6M3 12h5M16 12h5" />
  </Svg>
)
export const FlashlightIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14 3l7 7-3 1.5-5.5-5.5z" />
    <path d="M12.5 6L4 14.5a2 2 0 000 2.8l2.7 2.7a2 2 0 002.8 0L18 11.5" />
    <path d="M10 14l-1.5 1.5" />
  </Svg>
)
export const MaskIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 5c5 1.8 11 1.8 16 0v6c0 5-3.6 9-8 9s-8-4-8-9z" />
    <path d="M8 10.5c.8-.6 1.8-.6 2.5 0M13.5 10.5c.7-.6 1.7-.6 2.5 0" />
    <path d="M9 15c1.8 1.4 4.2 1.4 6 0" />
  </Svg>
)
export const GlobeIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c2.8 3 2.8 15 0 18M12 3c-2.8 3-2.8 15 0 18" />
  </Svg>
)
export const PinIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0113 0c0 4.8-6.5 11-6.5 11z" />
    <circle cx="12" cy="10" r="2.3" />
  </Svg>
)
export const CalendarIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="5" width="17" height="15" rx="2" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </Svg>
)
export const WrenchIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14.5 6.5a4 4 0 005 5L13 18a2.1 2.1 0 01-3-3z" />
    <path d="M14.5 6.5L17 4l3 3-2.5 2.5" />
  </Svg>
)
export const MicIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5.5 11a6.5 6.5 0 0013 0M12 17.5V21M9 21h6" />
  </Svg>
)
export const PuzzleIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 4a2 2 0 014 0v2h4v4h-2a2 2 0 000 4h2v4h-4v-2a2 2 0 00-4 0v2H6v-4h2a2 2 0 000-4H6V6h4z" />
  </Svg>
)
export const CameraIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
    <circle cx="12" cy="13" r="3.5" />
  </Svg>
)

/** Big doodle used on the no-photo placeholder card, picked per genre. */
export function GenreGlyph({ genre, size = 96 }: { genre: string; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 64 64', fill: 'none', stroke: 'currentColor', strokeWidth: 3, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true }
  switch (genre) {
    case 'horror':
      // A friendly little ghost (playful, not scary).
      return (
        <svg {...common}>
          <path d="M16 52V28a16 16 0 0132 0v24l-5-4-5 4-6-4-6 4-5-4z" />
          <circle cx="26" cy="28" r="2.5" fill="currentColor" />
          <circle cx="38" cy="28" r="2.5" fill="currentColor" />
          <path d="M28 37c2.5 2 5.5 2 8 0" />
        </svg>
      )
    case 'mystery':
      return (
        <svg {...common}>
          <circle cx="27" cy="27" r="13" />
          <path d="M37 37l13 13" strokeWidth={5} />
          <path d="M23 24a4 4 0 117 3c-2 1-3 2-3 4M27 35v.5" />
        </svg>
      )
    case 'sci-fi':
      return (
        <svg {...common}>
          <path d="M32 8c8 6 10 18 6 30H26C22 26 24 14 32 8z" />
          <circle cx="32" cy="22" r="4" />
          <path d="M26 38l-6 8 8-2M38 38l6 8-8-2M29 46l3 8 3-8" />
        </svg>
      )
    case 'fantasy':
      return (
        <svg {...common}>
          <path d="M14 50L46 18" strokeWidth={4} />
          <path d="M46 8l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" fill="currentColor" />
          <path d="M20 16l1 3 3 1-3 1-1 3-1-3-3-1 3-1zM48 40l1 3 3 1-3 1-1 3-1-3-3-1 3-1z" />
        </svg>
      )
    case 'heist':
      return (
        <svg {...common}>
          <rect x="10" y="12" width="44" height="40" rx="4" />
          <circle cx="32" cy="32" r="10" />
          <path d="M32 22v4M32 38v4M22 32h4M38 32h4M14 52v4M50 52v4" />
        </svg>
      )
    case 'historical':
      return (
        <svg {...common}>
          <path d="M8 22L32 10l24 12z" />
          <path d="M14 26v20M24 26v20M40 26v20M50 26v20M8 52h48M10 46h44" />
        </svg>
      )
    case 'comedy':
      return (
        <svg {...common}>
          <circle cx="32" cy="32" r="20" />
          <path d="M22 36c4 8 16 8 20 0z" fill="currentColor" />
          <path d="M23 26c2-2 4-2 6 0M35 26c2-2 4-2 6 0" />
        </svg>
      )
    case 'thriller':
      return (
        <svg {...common}>
          <path d="M34 6L16 36h14l-4 22 22-32H34z" />
        </svg>
      )
    case 'adventure':
      return (
        <svg {...common}>
          <circle cx="32" cy="32" r="22" />
          <path d="M40 24l-5 11-11 5 5-11z" fill="currentColor" />
          <path d="M32 6v4M32 54v4M6 32h4M54 32h4" />
        </svg>
      )
    default:
      return (
        <svg {...common}>
          <rect x="12" y="18" width="40" height="30" rx="3" />
          <circle cx="32" cy="33" r="7" />
          <path d="M28 18l2-4h4l2 4M32 33v3" />
        </svg>
      )
  }
}
