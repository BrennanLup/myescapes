/** Wardrobe and camera icons (24x24, stroke = currentColor), in the style of src/ui/shell/icons. */
import type { SVGProps } from 'react'

type P = SVGProps<SVGSVGElement>

function Svg(props: P) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={22}
      height={22}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    />
  )
}

export const IconHanger = (p: P) => (
  <Svg {...p}>
    <path d="M12 7.5a2 2 0 1 1 2-2" />
    <path d="M12 7.5v1.2L3.6 15a1.6 1.6 0 0 0 1 2.9h14.8a1.6 1.6 0 0 0 1-2.9L12 8.7" />
  </Svg>
)

export const IconKey = (p: P) => (
  <Svg {...p}>
    <circle cx="8" cy="12" r="4" />
    <path d="M12 12h9M18 12v3M21 12v2" />
  </Svg>
)

/** First person: an eye. */
export const IconEye = (p: P) => (
  <Svg {...p}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="3" />
  </Svg>
)

/** Third person: a figure seen from behind with a camera frame. */
export const IconPerson = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="7" r="3" />
    <path d="M6.5 20v-2.5a5.5 5.5 0 0 1 11 0V20" />
    <path d="M3 4V2.5h2.5M21 4V2.5h-2.5M3 18.5V20h1.5M21 18.5V20h-1.5" />
  </Svg>
)

export const IconLockSmall = (p: P) => (
  <Svg {...p}>
    <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
    <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
  </Svg>
)

export const IconShuffle = (p: P) => (
  <Svg {...p}>
    <path d="M3 7h3.5c4 0 5 10 9 10H21M18 14l3 3-3 3" />
    <path d="M3 17h3.5c1.4 0 2.4-1.2 3.2-2.8M13.4 9.6C14.2 8.1 15 7 16.5 7H21M18 4l3 3-3 3" />
  </Svg>
)

export const IconUndo = (p: P) => (
  <Svg {...p}>
    <path d="M9 14L4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </Svg>
)

export const IconCheck = (p: P) => (
  <Svg {...p}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Svg>
)

export const IconClose = (p: P) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
)
