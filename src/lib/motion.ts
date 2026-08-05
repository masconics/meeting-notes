/**
 * Shared motion tokens for Myna Notes.
 *
 * Production rules (aligned with better-ui + 12 principles):
 * - User-initiated motion ≤ 300ms
 * - Entrances ease-out; exits ease-in and shorter than enter
 * - Springs use bounce: 0 (no rubbery overshoot)
 * - Stagger ≤ 50ms per child
 * - Scale-on-press = 0.96 only
 * - Prefer opacity + transform (GPU-friendly); avoid layout thrash
 *
 * Wrap the app in <MotionConfig reducedMotion="user"> so OS settings are respected.
 */
import type { Transition, Variants } from "framer-motion"

/** Cubic easings — prefer these over named "easeOut" for consistency across CSS + FM. */
export const easings = {
  /** Arrive fast, settle gently (entrances, interactive). */
  out: [0.2, 0, 0, 1] as const,
  /** Build momentum then leave (exits). */
  in: [0.4, 0, 1, 1] as const,
  /** Soft bidirectional (step slides). */
  inOut: [0.4, 0, 0.2, 1] as const,
} as const

/** Durations in seconds. Keep under 0.3 for interaction. */
export const duration = {
  instant: 0.1,
  micro: 0.12,
  fast: 0.15,
  base: 0.2,
  moderate: 0.25,
  /** Icon swap spring length (bounce still 0). */
  spring: 0.3,
} as const

/** Shared transition presets. */
export const transitions = {
  /** Overlay / backdrop fade. */
  overlay: { duration: duration.micro, ease: easings.out } satisfies Transition,
  /** Default enter (panels, pages, popovers). */
  enter: { duration: duration.base, ease: easings.out } satisfies Transition,
  /** Soft exit — shorter than enter. */
  exit: { duration: duration.fast, ease: easings.in } satisfies Transition,
  /** Popover / command palette content. */
  pop: { duration: duration.fast, ease: easings.out } satisfies Transition,
  /** Toast enter/exit. */
  toast: { duration: 0.18, ease: easings.out } satisfies Transition,
  /** Slide panels (drawers, side sheets). */
  panel: { duration: duration.base, ease: easings.out } satisfies Transition,
  /** Width-collapsing editor sidebars. */
  width: { duration: duration.base, ease: easings.out } satisfies Transition,
  /** Chat bubbles / list rows. */
  item: { duration: duration.fast, ease: easings.out } satisfies Transition,
  /** Wizard steps. */
  step: { duration: duration.moderate, ease: easings.inOut } satisfies Transition,
  /** Contextual icon swap — spring with zero bounce. */
  icon: { type: "spring", duration: duration.spring, bounce: 0 } satisfies Transition,
  /** Layout animations (toasts stacking). */
  layout: { type: "spring", duration: duration.spring, bounce: 0 } satisfies Transition,
} as const

/** Stagger between list children — stay ≤ 50ms. */
export const stagger = {
  fast: 0.03,
  base: 0.04,
} as const

/** Scale used for press feedback. Never below 0.95. */
export const pressScale = 0.96

/**
 * Micro-interactions for Framer Motion (buttons, chips, rows).
 * Keep springs bounce: 0; durations ≤ 300ms.
 */
export const micro = {
  /** Primary control press */
  tap: { scale: pressScale } as const,
  /** Soft press for large rows / cards */
  tapSoft: { scale: 0.985 } as const,
  /** Icon / compact control hover */
  hover: { scale: 1.04 } as const,
  /** Transition for hover + tap */
  spring: { type: "spring", duration: duration.spring, bounce: 0 } as const satisfies Transition,
  /** Snappier CSS-like ease for simple taps */
  snap: { duration: duration.fast, ease: easings.out } as const satisfies Transition,
} as const

// ── Variants ──────────────────────────────────────────────────────────────

/** Route / full-page view swap (dashboard ↔ editor ↔ settings). */
export const pageVariants: Variants = {
  initial: { opacity: 0, y: 8, scale: 0.995 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: {
    opacity: 0,
    y: -6,
    scale: 0.995,
    transition: transitions.exit,
  },
}

/** In-page pane swap (notes / actions / people). Lighter than page. */
export const paneVariants: Variants = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: {
    opacity: 0,
    y: -4,
    transition: { duration: duration.micro, ease: easings.in },
  },
}

/** Dimmed overlay behind modals / drawers / palette. */
export const overlayVariants: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0, transition: { duration: duration.micro, ease: easings.in } },
}

/** Centered popover (command palette). */
export const popoverVariants: Variants = {
  initial: { opacity: 0, y: -8, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: {
    opacity: 0,
    y: -6,
    scale: 0.98,
    transition: { duration: duration.micro, ease: easings.in },
  },
}

/** Bottom toast. */
export const toastVariants: Variants = {
  initial: { opacity: 0, y: 12, scale: 0.97 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: {
    opacity: 0,
    y: 8,
    scale: 0.97,
    transition: { duration: duration.fast, ease: easings.in },
  },
}

/** Right-edge drawer (global chat on small screens). */
export const drawerRightVariants: Variants = {
  initial: { x: "100%" },
  animate: { x: 0 },
  exit: { x: "100%", transition: { duration: duration.fast, ease: easings.in } },
}

/** List / section container for staggered children. */
export const listContainerVariants: Variants = {
  initial: {},
  animate: {
    transition: { staggerChildren: stagger.fast, delayChildren: 0.02 },
  },
  exit: {},
}

/** Individual list row / card. */
export const listItemVariants: Variants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: {
    opacity: 0,
    y: -4,
    transition: { duration: duration.micro, ease: easings.in },
  },
}

/** Chat message bubble. */
export const messageVariants: Variants = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: {
    opacity: 0,
    y: 4,
    transition: { duration: duration.micro, ease: easings.in },
  },
}

/** Onboarding / multi-step wizard — custom = direction (±1). */
export const stepSlideVariants: Variants = {
  enter: (dir: number) => ({
    opacity: 0,
    x: dir > 0 ? 28 : -28,
    scale: 0.98,
  }),
  center: { opacity: 1, x: 0, scale: 1 },
  exit: (dir: number) => ({
    opacity: 0,
    x: dir > 0 ? -28 : 28,
    scale: 0.98,
    transition: { duration: duration.fast, ease: easings.in },
  }),
}

/** Contextual icon swap (scale 0.25 → 1 + blur). */
export const iconSwapVariants: Variants = {
  initial: { opacity: 0, scale: 0.25, filter: "blur(4px)" },
  animate: { opacity: 1, scale: 1, filter: "blur(0px)" },
  exit: { opacity: 0, scale: 0.25, filter: "blur(4px)" },
}

/** Fade only — empty states, soft content swaps. */
export const fadeVariants: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0, transition: { duration: duration.micro, ease: easings.in } },
}

/** Default page transition prop for motion components. */
export const pageTransition = transitions.enter
