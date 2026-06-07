import { useState, useCallback } from "react"

export type PermissionState = "idle" | "requesting" | "granted" | "denied"

export function useMicrophonePermission() {
  const [permission, setPermission] = useState<PermissionState>("idle")
  const [error, setError] = useState<string | null>(null)

  const check = useCallback(async (): Promise<PermissionState> => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setPermission("denied")
      setError("Media devices API not available.")
      return "denied"
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach((t) => t.stop())
      setPermission("granted")
      setError(null)
      return "granted"
    } catch (err: unknown) {
      const msg = err instanceof DOMException ? err.name : "Unknown error"

      if (msg === "NotAllowedError") {
        setPermission("denied")
        setError("Microphone access was denied. Enable it in System Settings.")
        return "denied"
      }

      if (msg === "NotFoundError") {
        setPermission("denied")
        setError("No microphone found on this device.")
        return "denied"
      }

      setPermission("denied")
      setError(`Microphone unavailable: ${msg}`)
      return "denied"
    }
  }, [])

  const request = useCallback(async (): Promise<PermissionState> => {
    setPermission("requesting")
    setError(null)
    const result = await check()
    setPermission(result)
    return result
  }, [check])

  const openSystemSettings = useCallback(async () => {
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener")
      await openUrl(
        "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"
      )
    } catch {
      try {
        const { openUrl } = await import("@tauri-apps/plugin-opener")
        await openUrl(
          "x-apple.systempreferences:com.apple.preference.security?Privacy"
        )
      } catch {
        // Fallback: browser cannot open system settings
      }
    }
  }, [])

  const reset = useCallback(() => {
    setPermission("idle")
    setError(null)
  }, [])

  return {
    permission,
    error,
    check,
    request,
    openSystemSettings,
    reset,
  }
}
