/** Line icons for the people UI (24 x 24, stroke = currentColor). */
import type { SVGProps } from 'react'

type P = SVGProps<SVGSVGElement>

function Svg({ children, ...rest }: P) {
  return (
    <svg viewBox="0 0 24 24" width={22} height={22} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...rest}>
      {children}
    </svg>
  )
}

export const IconPeople = (p: P) => (
  <Svg {...p}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3 19.5c.6-3.3 3-5.2 6-5.2s5.4 1.9 6 5.2" />
    <circle cx="17" cy="9" r="2.5" />
    <path d="M16.2 14.2c2.5.1 4.3 1.8 4.8 4.6" />
  </Svg>
)

export const IconChat = (p: P) => (
  <Svg {...p}>
    <path d="M4 5.5h16a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5h-9l-4.5 3.5v-3.5H4A1.5 1.5 0 0 1 2.5 16V7A1.5 1.5 0 0 1 4 5.5Z" />
    <path d="M7 10h10M7 13.5h6" />
  </Svg>
)

export const IconWave = (p: P) => (
  <Svg {...p}>
    <path d="M8.5 12.5V6.8a1.4 1.4 0 0 1 2.8 0v4.7" />
    <path d="M11.3 11V5.4a1.4 1.4 0 0 1 2.8 0V11" />
    <path d="M14.1 11V6.6a1.4 1.4 0 0 1 2.8 0v6.9c0 4-2.5 6.9-6.2 6.9-2.4 0-3.9-1.1-5.1-3.1l-2.1-3.6a1.4 1.4 0 0 1 2.3-1.6l2 2.4" />
    <path d="M19.5 3.5c.9.7 1.5 1.8 1.6 3M2.8 6.5c.2-1.2.9-2.2 1.8-2.8" />
  </Svg>
)

export const IconCheer = (p: P) => (
  <Svg {...p}>
    <path d="m12 3 2.3 4.9 5.2.6-3.9 3.6 1.1 5.2L12 14.7l-4.7 2.6 1.1-5.2-3.9-3.6 5.2-.6Z" />
    <path d="M12 19v2.5M5 20l1.3-1.6M19 20l-1.3-1.6" />
  </Svg>
)

export const IconDance = (p: P) => (
  <Svg {...p}>
    <path d="M9 18V5.5l10-2V16" />
    <circle cx="6.5" cy="18" r="2.5" />
    <circle cx="16.5" cy="16" r="2.5" />
  </Svg>
)

export const IconHome = (p: P) => (
  <Svg {...p}>
    <path d="M3.5 11 12 4l8.5 7" />
    <path d="M5.5 9.5V20h13V9.5" />
    <path d="M10 20v-5.5h4V20" />
  </Svg>
)

export const IconBack = (p: P) => (
  <Svg {...p}>
    <path d="M10 6 4 12l6 6" />
    <path d="M4.5 12H15a5 5 0 0 1 0 10h-2" />
  </Svg>
)

export const IconClose = (p: P) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
)

export const IconSend = (p: P) => (
  <Svg {...p}>
    <path d="M4 12 20 4l-4 16-4.5-6.5Z" />
    <path d="m11.5 13.5 3-3" />
  </Svg>
)

export const IconEyeOff = (p: P) => (
  <Svg {...p}>
    <path d="M3 3l18 18" />
    <path d="M10.6 5.1A9.9 9.9 0 0 1 12 5c5 0 8.5 4.5 9.5 7a13 13 0 0 1-2.6 3.8M6.3 6.3C4.4 7.6 3.1 9.6 2.5 12c1 2.5 4.5 7 9.5 7 1.6 0 3-.4 4.3-1.1" />
    <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
  </Svg>
)
