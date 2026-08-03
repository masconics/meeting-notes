/** Shared cubic easings — keep in sync with `src/lib/motion.ts` easings. */

/** Arrive fast, settle gently (entrances, content swaps). */
export const EASE_OUT = [0.2, 0, 0, 1] as const

/** Build momentum then leave (exits). */
export const EASE_IN = [0.4, 0, 1, 1] as const

/** Soft bidirectional. */
export const EASE_IN_OUT = [0.4, 0, 0.2, 1] as const
