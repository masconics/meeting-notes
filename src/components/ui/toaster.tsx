import { useEffect, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { HugeiconsIcon } from "@hugeicons/react"
import { AlertCircleIcon, Cancel01Icon, CheckmarkCircle02Icon } from "@hugeicons/core-free-icons"

export interface ToastOptions {
  /** Stable id replaces any existing toast with the same id (good for "one at a time" flows). */
  id?: string
  description?: string
  /** ms before auto-dismiss. Defaults: 4000 default, 6000 error, 8000 when an action is present. 0 = sticky. */
  duration?: number
  action?: { label: string; onClick: () => void }
}

type ToastVariant = "default" | "success" | "error"

interface ToastItem extends ToastOptions {
  id: string
  message: string
  variant: ToastVariant
}

const MAX_VISIBLE = 3
let toasts: ToastItem[] = []
let seq = 0
const listeners = new Set<(items: ToastItem[]) => void>()

function emit() {
  for (const l of listeners) l([...toasts])
}

function dismiss(id: string) {
  if (!toasts.some(t => t.id === id)) return
  toasts = toasts.filter(t => t.id !== id)
  emit()
}

function push(variant: ToastVariant, message: string, opts?: ToastOptions): string {
  const id = opts?.id ?? `toast-${++seq}`
  toasts = [...toasts.filter(t => t.id !== id), { ...opts, id, message, variant }].slice(-MAX_VISIBLE)
  emit()
  const duration = opts?.duration ?? (variant === "error" ? 6000 : opts?.action ? 8000 : 4000)
  if (duration > 0) setTimeout(() => dismiss(id), duration)
  return id
}

/**
 * Imperative toast API — call from anywhere, no context required:
 *   toast("Copied")
 *   toast.success("Template saved")
 *   toast.error("Export failed", { description: err.message })
 *   toast("Note deleted", { id: "delete", action: { label: "Undo", onClick: restore } })
 */
export const toast = Object.assign(
  (message: string, opts?: ToastOptions) => push("default", message, opts),
  {
    success: (message: string, opts?: ToastOptions) => push("success", message, opts),
    error: (message: string, opts?: ToastOptions) => push("error", message, opts),
    dismiss: (id?: string) => {
      if (id === undefined) { toasts = [] } else { toasts = toasts.filter(t => t.id !== id) }
      emit()
    },
  },
)

const variantStyles: Record<ToastVariant, string> = {
  default: "border-border/70",
  success: "border-border/70",
  error: "border-destructive/30",
}

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([])

  useEffect(() => {
    const listener = (next: ToastItem[]) => setItems(next)
    listeners.add(listener)
    listener([...toasts])
    return () => { listeners.delete(listener) }
  }, [])

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 left-1/2 z-[100] flex w-full max-w-sm -translate-x-1/2 flex-col items-center gap-2 px-4"
    >
      <AnimatePresence>
        {items.map(t => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.97 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            role={t.variant === "error" ? "alert" : "status"}
            onMouseDown={(e) => e.preventDefault() /* keep editor selection when clicking actions */}
            className={`pointer-events-auto flex max-w-full items-center gap-2.5 rounded-xl border bg-card/95 px-3.5 py-2.5 shadow-xl backdrop-blur ${variantStyles[t.variant]}`}
          >
            {t.variant === "success" && (
              <HugeiconsIcon icon={CheckmarkCircle02Icon} className="size-4 shrink-0 text-primary" />
            )}
            {t.variant === "error" && (
              <HugeiconsIcon icon={AlertCircleIcon} className="size-4 shrink-0 text-destructive" />
            )}
            <div className="min-w-0 text-xs">
              <div className={t.variant === "error" ? "text-destructive" : "text-foreground"}>{t.message}</div>
              {t.description && <div className="mt-0.5 text-muted-foreground">{t.description}</div>}
            </div>
            {t.action && (
              <button
                onClick={() => { t.action!.onClick(); dismiss(t.id) }}
                className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
              >
                {t.action.label}
              </button>
            )}
            <button
              aria-label="Dismiss"
              onClick={() => dismiss(t.id)}
              className="shrink-0 rounded-md p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-3.5" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
