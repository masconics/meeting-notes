import { cn } from "@/lib/utils"
import { useId } from "react"

/**
 * Geometric myna head mark (profile →).
 *
 * Illustrator-style: circle head + triangle beak + eye punched with a mask.
 * (Evenodd is wrong here — it would cut a hole where head and beak overlap.)
 */

type MynaLogoProps = {
  className?: string
  title?: string
  decorative?: boolean
}

export function MynaLogo({ className, title = "Myna Notes", decorative }: MynaLogoProps) {
  const uid = useId().replace(/:/g, "")
  const maskId = `myna-eye-${uid}`

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 112 96"
      fill="currentColor"
      className={cn("shrink-0", className)}
      role={decorative ? "presentation" : "img"}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : title}
    >
      {!decorative && <title>{title}</title>}
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="112" height="96">
          <rect width="112" height="96" fill="#fff" />
          <circle cx="54" cy="40" r="6" fill="#000" />
        </mask>
      </defs>
      <g mask={`url(#${maskId})`}>
        <circle cx="40" cy="48" r="36" />
        <polygon points="62,36 110,48 62,60" />
      </g>
    </svg>
  )
}

export function MynaAppIcon({ className, title = "Myna Notes" }: { className?: string; title?: string }) {
  const uid = useId().replace(/:/g, "")
  const maskId = `myna-app-eye-${uid}`

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 128 128"
      className={cn("shrink-0", className)}
      role="img"
      aria-label={title}
    >
      <title>{title}</title>
      {/* Plate matches app --background; bird uses --foreground for contrast. */}
      <rect width="128" height="128" rx="28" fill="var(--background)" />
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="112" height="96">
          <rect width="112" height="96" fill="#fff" />
          <circle cx="54" cy="40" r="6" fill="#000" />
        </mask>
      </defs>
      <g transform="translate(10 16)" fill="var(--foreground)" mask={`url(#${maskId})`}>
        <circle cx="40" cy="48" r="36" />
        <polygon points="62,36 110,48 62,60" />
      </g>
    </svg>
  )
}
