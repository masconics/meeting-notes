/**
 * Motion tabs — layoutId sliding indicator (beui.dev pattern), styled for Myna.
 *
 * Variants:
 * - pill     → dashboard top nav (rounded-full track)
 * - segment  → app control strip (rounded-2xl track)
 * - underline → bottom bar indicator
 */
import {
  motion,
  MotionConfig,
  useReducedMotion,
  type Transition,
} from "framer-motion"
import {
  createContext,
  useCallback,
  useContext,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { EASE_OUT } from "@/lib/ease"
import { cn } from "@/lib/utils"

type Variant = "pill" | "underline" | "segment"
type Size = "default" | "sm"

type Ctx = {
  value: string
  setValue: (v: string) => void
  layoutId: string
  variant: Variant
  size: Size
}

const TabsCtx = createContext<Ctx | null>(null)

function useTabs() {
  const ctx = useContext(TabsCtx)
  if (!ctx) throw new Error("Tabs.* must be used inside <Tabs>")
  return ctx
}

/**
 * Active-tab indicator spring — slight settle, not rubbery.
 * Scoped via MotionConfig so only the indicator inherits it.
 */
const indicatorTransition: Transition = {
  type: "spring",
  stiffness: 380,
  damping: 32,
  mass: 0.85,
}

export function Tabs({
  defaultValue,
  value,
  onValueChange,
  variant = "pill",
  size = "default",
  children,
  className,
}: {
  defaultValue?: string
  value?: string
  onValueChange?: (v: string) => void
  variant?: Variant
  size?: Size
  children: ReactNode
  className?: string
}) {
  const [internal, setInternal] = useState(defaultValue ?? "")
  const layoutId = useId()
  const reduce = useReducedMotion()
  const controlled = value !== undefined
  const current = controlled ? value! : internal
  const setValue = useCallback(
    (v: string) => {
      if (!controlled) setInternal(v)
      onValueChange?.(v)
    },
    [controlled, onValueChange],
  )
  const contextValue = useMemo(
    () => ({ value: current, setValue, layoutId, variant, size }),
    [current, layoutId, setValue, variant, size],
  )

  return (
    <MotionConfig transition={reduce ? { duration: 0 } : indicatorTransition}>
      <TabsCtx.Provider value={contextValue}>
        {/* layoutRoot: layoutId measures in page coords; scoping projection
            keeps the pill from replaying scroll offsets as movement. */}
        <motion.div layoutRoot className={className}>
          {children}
        </motion.div>
      </TabsCtx.Provider>
    </MotionConfig>
  )
}

/** Prefer product surface classes so tabs stay in sync with index.css tokens. */
const listClasses: Record<Variant, string> = {
  pill: "dashboard-nav",
  underline: "inline-flex select-none items-center gap-1 border-b border-border/60",
  segment: "app-control-strip",
}

export function TabsList({
  children,
  className,
  "aria-label": ariaLabel,
}: {
  children: ReactNode
  className?: string
  "aria-label"?: string
}) {
  const { variant } = useTabs()
  return (
    <div role="tablist" aria-label={ariaLabel} className={cn(listClasses[variant], className)}>
      {children}
    </div>
  )
}

export function TabsTrigger({
  value,
  children,
  className,
  indicatorClassName,
  disabled,
}: {
  value: string
  children: ReactNode
  className?: string
  indicatorClassName?: string
  disabled?: boolean
}) {
  const { value: current, setValue, layoutId, variant, size } = useTabs()
  const active = current === value
  const sm = size === "sm"

  if (variant === "underline") {
    return (
      <button
        type="button"
        role="tab"
        aria-selected={active}
        disabled={disabled}
        onClick={() => setValue(value)}
        className={cn(
          "relative isolate inline-flex min-h-9 select-none items-center px-3 pb-2.5 pt-1 -mb-px text-sm font-medium outline-none transition-colors duration-150",
          "focus-visible:ring-2 focus-visible:ring-ring/30",
          active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
          disabled && "pointer-events-none opacity-50",
          className,
        )}
      >
        {children}
        {active ? (
          <motion.span
            layoutId={layoutId}
            className={cn("absolute -bottom-px left-0 right-0 h-0.5 rounded-full bg-foreground", indicatorClassName)}
          />
        ) : null}
      </button>
    )
  }

  const radius = variant === "pill" ? "rounded-full" : "rounded-xl"
  const radiusPx = variant === "pill" ? 9999 : 12
  // Product item classes handle size/hover; active fill lives on the sliding
  // indicator (layoutId) so we never set data-active for background.
  const itemClass = variant === "pill" ? "dashboard-nav-item" : "app-control-item"

  return (
    <div className="relative">
      {active ? (
        <motion.span
          layoutId={layoutId}
          style={{ borderRadius: radiusPx }}
          className={cn("absolute inset-0 bg-background shadow-sm", radius, indicatorClassName)}
        />
      ) : null}
      <button
        type="button"
        role="tab"
        aria-selected={active}
        disabled={disabled}
        onClick={() => setValue(value)}
        className={cn(
          itemClass,
          "relative z-10 bg-transparent",
          sm && "h-7 px-2.5 text-xs",
          active && "text-foreground",
          disabled && "pointer-events-none opacity-50",
          className,
        )}
      >
        {children}
      </button>
    </div>
  )
}

export function TabsContent({
  value,
  children,
  className,
}: {
  value: string
  children: ReactNode
  className?: string
}) {
  const { value: current } = useTabs()
  const reduce = useReducedMotion()
  const active = current === value

  // Keep inactive panels mounted (hidden) for a11y / SSR stability.
  if (!active) {
    return (
      <div hidden className={className}>
        {children}
      </div>
    )
  }

  return (
    <motion.div
      key={value}
      initial={{ opacity: 0, y: reduce ? 0 : 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: EASE_OUT }}
      className={cn("mt-4", className)}
      role="tabpanel"
    >
      {children}
    </motion.div>
  )
}
