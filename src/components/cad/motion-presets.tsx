'use client'

import type { Variants, Transition } from 'framer-motion'

// ─── Animation Presets ──────────────────────────────────────────────────────
// Reusable motion animation variants for the AgentSCAD dashboard.
// Each preset exports `initial`, `animate`, `exit`, and `transition` objects.

// Fade in from below with slight Y offset
export const fadeInUp: Variants = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 10 },
}

export const fadeInUpTransition: Transition = {
  duration: 0.4,
  ease: [0.25, 0.46, 0.45, 0.94],
}

// Slide in from left
export const slideInLeft: Variants = {
  initial: { opacity: 0, x: -30 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -15 },
}

export const slideInLeftTransition: Transition = {
  duration: 0.35,
  ease: [0.25, 0.46, 0.45, 0.94],
}

// Slide in from right
export const slideInRight: Variants = {
  initial: { opacity: 0, x: 30 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: 15 },
}

export const slideInRightTransition: Transition = {
  duration: 0.35,
  ease: [0.25, 0.46, 0.45, 0.94],
}

// Scale up from 0.9
export const scaleIn: Variants = {
  initial: { opacity: 0, scale: 0.9 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.95 },
}

export const scaleInTransition: Transition = {
  duration: 0.3,
  ease: [0.25, 0.46, 0.45, 0.94],
}

// Stagger container – wrap children to stagger their animations
export const staggerContainer: Variants = {
  initial: {},
  animate: {
    transition: {
      staggerChildren: 0.06,
      delayChildren: 0.05,
    },
  },
  exit: {
    transition: {
      staggerChildren: 0.03,
      staggerDirection: -1,
    },
  },
}

// Stagger child – pair with staggerContainer
export const staggerChild: Variants = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 6 },
}

export const staggerTransition: Transition = {
  duration: 0.3,
  ease: 'easeOut',
}

/*
 * `pulseGlow`, `pulseGlowTransition`, `shimmer`, `shimmerTransition` and
 * `shimmerStyle` were removed here. All five were unreferenced, and all five
 * painted violet (#8B5CF6 at 30% and 8%) - a second accent that DESIGN.md
 * section 11 does not allow, sitting in a file every panel imports. The live
 * state glow is the signal token's job (`--shell-signal-rgb`), and the loading
 * state is a skeleton, not a shimmer.
 */

// Success animation (scale + color flash)
export const successPop: Variants = {
  initial: { opacity: 0, scale: 0.8 },
  animate: {
    opacity: 1,
    scale: [0.8, 1.08, 1],
  },
  exit: { opacity: 0, scale: 0.9 },
}

export const successPopTransition: Transition = {
  duration: 0.5,
  ease: [0.34, 1.56, 0.64, 1], // overshoot easing
}

// Error animation (horizontal shake)
export const errorShake: Variants = {
  initial: { x: 0 },
  animate: {
    x: [0, -8, 8, -6, 6, -3, 3, 0],
  },
  exit: { x: 0 },
}

export const errorShakeTransition: Transition = {
  duration: 0.5,
  ease: 'easeInOut',
}

// Animated number counter – used with motion.span and animate prop
// Set `animate` to the target number value
export const counterAnimation = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
}

export const counterTransition: Transition = {
  duration: 0.6,
  ease: [0.25, 0.46, 0.45, 0.94],
}

// ─── Utility Hooks ──────────────────────────────────────────────────────────

/**
 * Generates framer-motion variants for an animated counter.
 * The number transitions from `from` to `to` over the specified duration.
 * Use with motion.span and the `animate` prop.
 */
export function makeCounterVariants(from: number, to: number): Variants {
  return {
    initial: { opacity: 0.4 },
    animate: { opacity: 1 },
    exit: { opacity: 0.4 },
  }
}

/**
 * Creates a spring transition suitable for interactive elements.
 */
export function springTransition(stiffness = 300, damping = 25): Transition {
  return {
    type: 'spring',
    stiffness,
    damping,
  }
}
