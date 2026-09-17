'use client'

import { motion } from 'framer-motion'

// ─── Part Family Icons ──────────────────────────────────────────────────────
// SVG inline icons for each part family with subtle animations.
// Gentle float for most, slow rotate for gears.

export type PartFamilyKey =
  | 'spur_gear'
  | 'device_stand'
  | 'phone_case'
  | 'electronics_enclosure'
  | 'bracket'
  | 'bolt'
  | 'unknown'

interface PartFamilyIconProps {
  family: string | null
  size?: number | 'xs' | 'sm' | 'md' | 'lg'
  className?: string
  animate?: boolean
}

const SIZE_MAP: Record<string, number> = { xs: 12, sm: 16, md: 24, lg: 32 }

// ─── Gear Icon (with rotation animation) ────────────────────────────────────

function GearIcon({ size = 24, animate = true }: { size?: number; animate?: boolean }) {
  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      animate={animate ? { rotate: 360 } : undefined}
      transition={animate ? { duration: 12, repeat: Infinity, ease: 'linear' } : undefined}
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
    </motion.svg>
  )
}

// ─── Stand/Tripod Icon ──────────────────────────────────────────────────────

function StandIcon({ size = 24, animate = true }: { size?: number; animate?: boolean }) {
  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      animate={animate ? { y: [0, -1, 0] } : undefined}
      transition={animate ? { duration: 3, repeat: Infinity, ease: 'easeInOut' } : undefined}
    >
      {/* Base plate */}
      <rect x="3" y="19" width="18" height="2" rx="1" />
      {/* Back support */}
      <rect x="5" y="5" width="2" height="14" rx="0.5" />
      {/* Top ledge */}
      <rect x="3" y="3" width="18" height="2" rx="1" />
      {/* Front lip */}
      <rect x="17" y="7" width="2" height="4" rx="0.5" />
    </motion.svg>
  )
}

// ─── Phone Case Icon ────────────────────────────────────────────────────────

function PhoneCaseIcon({ size = 24, animate = true }: { size?: number; animate?: boolean }) {
  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      animate={animate ? { y: [0, -0.5, 0] } : undefined}
      transition={animate ? { duration: 4, repeat: Infinity, ease: 'easeInOut' } : undefined}
    >
      {/* Outer shell */}
      <rect x="5" y="2" width="14" height="20" rx="2" />
      {/* Inner screen */}
      <rect x="7" y="4" width="10" height="14" rx="1" opacity={0.3} />
      {/* Camera cutout */}
      <circle cx="12" cy="5.5" r="0.7" />
      {/* Home indicator */}
      <line x1="10" y1="20" x2="14" y2="20" strokeWidth={1} />
    </motion.svg>
  )
}

// ─── Electronics Enclosure Icon (Box with circuit pattern) ──────────────────

function EnclosureIcon({ size = 24, animate = true }: { size?: number; animate?: boolean }) {
  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      animate={animate ? { y: [0, -0.5, 0] } : undefined}
      transition={animate ? { duration: 3.5, repeat: Infinity, ease: 'easeInOut' } : undefined}
    >
      {/* Outer box */}
      <rect x="3" y="5" width="18" height="14" rx="1.5" />
      {/* Circuit traces */}
      <path d="M6 8h3v3H6z" strokeWidth={1} opacity={0.4} />
      <path d="M11 8h2M14 8h2M11 10h5" strokeWidth={0.8} opacity={0.3} />
      <path d="M6 13h2M10 13h4" strokeWidth={0.8} opacity={0.3} />
      {/* Mounting holes */}
      <circle cx="5" cy="7" r="0.7" />
      <circle cx="19" cy="7" r="0.7" />
      <circle cx="5" cy="17" r="0.7" />
      <circle cx="19" cy="17" r="0.7" />
      {/* LED indicator */}
      <circle cx="17" cy="13" r="1" strokeWidth={0.8} opacity={0.5} />
    </motion.svg>
  )
}

// ─── Bracket Icon (L-shaped) ────────────────────────────────────────────────

function BracketIcon({ size = 24, animate = true }: { size?: number; animate?: boolean }) {
  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      animate={animate ? { y: [0, -0.5, 0] } : undefined}
      transition={animate ? { duration: 3, repeat: Infinity, ease: 'easeInOut' } : undefined}
    >
      {/* L-shape bracket */}
      <path d="M4 4h4v12h12v4H4V4z" />
      {/* Mounting holes */}
      <circle cx="6" cy="6" r="0.8" />
      <circle cx="16" cy="18" r="0.8" />
      {/* Fillet indicator */}
      <path d="M8 14c0 1.1.9 2 2 2" strokeWidth={0.8} opacity={0.4} />
    </motion.svg>
  )
}

// ─── Hex Bolt Icon ──────────────────────────────────────────────────────────

function BoltIcon({ size = 24, animate = true }: { size?: number; animate?: boolean }) {
  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      animate={animate ? { y: [0, -0.5, 0] } : undefined}
      transition={animate ? { duration: 2.5, repeat: Infinity, ease: 'easeInOut' } : undefined}
    >
      {/* Hex head */}
      <path d="M7 4h10l3 5-3 5H7l-3-5 3-5z" />
      {/* Shaft */}
      <line x1="12" y1="14" x2="12" y2="21" />
      {/* Thread lines */}
      <line x1="10.5" y1="16" x2="13.5" y2="16" strokeWidth={0.8} opacity={0.3} />
      <line x1="10.5" y1="18" x2="13.5" y2="18" strokeWidth={0.8} opacity={0.3} />
      <line x1="10.5" y1="20" x2="13.5" y2="20" strokeWidth={0.8} opacity={0.3} />
    </motion.svg>
  )
}

// ─── Unknown Icon (Question mark in circle) ─────────────────────────────────

function UnknownIcon({ size = 24, animate = true }: { size?: number; animate?: boolean }) {
  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      animate={animate ? { scale: [1, 1.05, 1] } : undefined}
      transition={animate ? { duration: 2, repeat: Infinity, ease: 'easeInOut' } : undefined}
    >
      <circle cx="12" cy="12" r="9" opacity={0.3} />
      <path d="M9 9a3 3 0 1 1 3 3v1" />
      <circle cx="12" cy="17" r="0.5" fill="currentColor" />
    </motion.svg>
  )
}

// ─── Main Component ─────────────────────────────────────────────────────────

const ICON_MAP: Record<PartFamilyKey, React.FC<{ size?: number; animate?: boolean }>> = {
  spur_gear: GearIcon,
  device_stand: StandIcon,
  phone_case: PhoneCaseIcon,
  electronics_enclosure: EnclosureIcon,
  bracket: BracketIcon,
  bolt: BoltIcon,
  unknown: UnknownIcon,
}

export function PartFamilyIcon({
  family,
  size = 24,
  className = '',
  animate = true,
}: PartFamilyIconProps) {
  const key = (family?.toLowerCase() as PartFamilyKey) || 'unknown'
  const Icon = ICON_MAP[key] || ICON_MAP.unknown
  const resolvedSize = typeof size === 'string' ? (SIZE_MAP[size] ?? 24) : size

  return (
    <span className={`inline-flex items-center justify-center text-[var(--app-text-muted)] ${className}`}>
      <Icon size={resolvedSize} animate={animate} />
    </span>
  )
}

/**
 * Returns the display label for a part family key.
 */
export function getPartFamilyLabel(family: string | null): string {
  if (!family) return 'Unknown'
  const labels: Record<string, string> = {
    spur_gear: 'Spur Gear',
    device_stand: 'Device Stand',
    phone_case: 'Phone Case',
    electronics_enclosure: 'Enclosure',
    bracket: 'Bracket',
    bolt: 'Bolt',
  }
  return labels[family.toLowerCase()] || family.replace(/_/g, ' ')
}

/**
 * Returns a color class for the part family icon.
 */
export function getPartFamilyColor(family: string | null): string {
  if (!family) return 'text-[var(--app-text-muted)]'
  const colors: Record<string, string> = {
    spur_gear: 'text-amber-400',
    device_stand: 'text-teal-400',
    phone_case: 'text-emerald-400',
    electronics_enclosure: 'text-amber-500',
    bracket: 'text-rose-400',
    bolt: 'text-stone-300',
  }
  return colors[family.toLowerCase()] || 'text-[var(--app-text-muted)]'
}
