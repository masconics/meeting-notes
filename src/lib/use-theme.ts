import { useEffect, useCallback } from "react"
import type { AppSettings } from "@/types"

export function useTheme(theme: AppSettings["theme"]) {
  const apply = useCallback((t: AppSettings["theme"]) => {
    const root = document.documentElement
    if (t === "dark") {
      root.classList.add("dark")
    } else if (t === "light") {
      root.classList.remove("dark")
    } else {
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches
      root.classList.toggle("dark", prefersDark)
    }
  }, [])

  useEffect(() => {
    apply(theme)
  }, [theme, apply])

  useEffect(() => {
    if (theme !== "system") return
    const mq = window.matchMedia("(prefers-color-scheme: dark)")
    const handler = () => apply("system")
    mq.addEventListener("change", handler)
    return () => mq.removeEventListener("change", handler)
  }, [theme, apply])

  return { apply }
}
