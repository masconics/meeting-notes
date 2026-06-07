import { HugeiconsIcon } from "@hugeicons/react"
import {
  UserSearchIcon,
  UserIcon,
  Comment01Icon,
  PresentationIcon,
  DashboardCircleIcon,
  CheckmarkBadge01Icon,
} from "@hugeicons/core-free-icons"
import type { IconSvgElement } from "@hugeicons/react"

const ICON_MAP: Record<string, IconSvgElement> = {
  UserSearchIcon,
  UserIcon,
  Comment01Icon,
  PresentationIcon,
  DashboardCircleIcon,
}

interface TemplateIconProps {
  name: string
  className?: string
  inline?: boolean
}

export function TemplateIcon({ name, className, inline }: TemplateIconProps) {
  const Icon = ICON_MAP[name] || CheckmarkBadge01Icon
  if (inline) {
    return <HugeiconsIcon icon={Icon} strokeWidth={2} className={className} />
  }
  return (
    <div className="size-10 shrink-0 rounded-full bg-muted inline-flex items-center justify-center">
      <HugeiconsIcon icon={Icon} strokeWidth={2} className={className || "size-5 text-foreground"} />
    </div>
  )
}
