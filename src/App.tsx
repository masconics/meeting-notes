import { useState, useCallback, useEffect, useRef } from "react"
import { listen } from "@tauri-apps/api/event"
import { motion, AnimatePresence, MotionConfig } from "framer-motion"
import { MeetingDashboard } from "@/components/meeting-dashboard"
import { NoteEditor } from "@/components/note-editor"
import { SettingsPage } from "@/components/settings-page"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { OnboardingWizard } from "@/components/onboarding-wizard"
import { ErrorBoundary } from "@/components/error-boundary"
import { CommandPalette } from "@/components/command-palette"
import { ShortcutsDialog } from "@/components/shortcuts-dialog"
import { Toaster, toast } from "@/components/ui/toaster"
import { isOnboardingComplete } from "@/lib/onboarding"
import {
  loadMeetings,
  loadSettings,
  saveMeetings,
  saveSettings,
  updateMeeting,
  hydrateFromVault,
} from "@/lib/storage"
import { useTheme } from "@/lib/use-theme"
import { pageTransition, pageVariants } from "@/lib/motion"
import type { Meeting, AppSettings } from "@/types"

type View = "dashboard" | "editor" | "settings"

function parseHash(): { view: View; meetingId?: string } {
  const hash = window.location.hash.replace(/^#/, "")
  if (!hash || hash === "dashboard") return { view: "dashboard" }
  if (hash === "editor") return { view: "editor" }
  if (hash.startsWith("editor/")) return { view: "editor", meetingId: hash.slice(7) }
  if (hash === "settings") return { view: "settings" }
  return { view: "dashboard" }
}

function buildHash(view: View, meetingId?: string): string {
  if (view === "dashboard") return "dashboard"
  if (view === "editor" && meetingId) return `editor/${meetingId}`
  if (view === "editor") return "editor"
  if (view === "settings") return "settings"
  return "dashboard"
}

export function App() {
  const initialHash = parseHash()
  const loadedMeetings = loadMeetings()

  const [view, setView] = useState<View>(initialHash.view)
  const [meetings, setMeetings] = useState<Meeting[]>(loadedMeetings)
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings())
  const [editorNote, setEditorNote] = useState<Meeting | undefined>(() => {
    if (initialHash.view === "editor" && initialHash.meetingId) {
      return loadedMeetings.find(m => m.id === initialHash.meetingId)
    }
    return undefined
  })
  const [onboardingComplete, setOnboardingComplete] = useState(() => isOnboardingComplete())
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string
    message: string
    onConfirm: () => void
    variant?: "destructive" | "default"
  } | null>(null)

  const viewRef = useRef(view)
  const meetingsRef = useRef(meetings)
  const editorNoteRef = useRef(editorNote)
  // Where to return when leaving Settings. Recorded every time Settings is
  // opened so Back/Escape restore the view the user came from (e.g. the note
  // they were editing) instead of always landing on the dashboard.
  const settingsReturnRef = useRef<{ view: View; meetingId?: string }>({ view: "dashboard" })
  const isNavigatingRef = useRef(false)
  const recorderDirtyRef = useRef(false)
  const pendingNavigateRef = useRef<{ view: View; meetingId?: string } | null>(null)

  useTheme(settings.theme)

  useEffect(() => {
    hydrateFromVault().then(() => {
      setMeetings(loadMeetings())
      setSettings(loadSettings())
    }).catch(() => {})
  }, [])

  useEffect(() => {
    viewRef.current = view
  }, [view])

  useEffect(() => {
    meetingsRef.current = meetings
  }, [meetings])

  useEffect(() => {
    editorNoteRef.current = editorNote
  }, [editorNote])

  const navigate = useCallback((nextView: View, meetingId?: string) => {
    if (viewRef.current === "editor" && nextView !== "editor" && recorderDirtyRef.current) {
      pendingNavigateRef.current = { view: nextView, meetingId }
      setConfirmDialog({
        title: "Unsaved Changes",
        message: "You have unsaved changes. Leave anyway?",
        variant: "destructive",
        onConfirm: () => {
          recorderDirtyRef.current = false
          const nav = pendingNavigateRef.current!
          pendingNavigateRef.current = null
          isNavigatingRef.current = true
          window.location.hash = "#" + buildHash(nav.view, nav.meetingId)
          setView(nav.view)
          setTimeout(() => { isNavigatingRef.current = false }, 0)
        },
      })
      return
    }
    isNavigatingRef.current = true
    window.location.hash = "#" + buildHash(nextView, meetingId)
    setView(nextView)
    setTimeout(() => { isNavigatingRef.current = false }, 0)
  }, [])

  const goBack = useCallback(() => navigate("dashboard"), [navigate])

  const openSettings = useCallback(() => {
    settingsReturnRef.current = viewRef.current === "editor"
      ? { view: "editor", meetingId: editorNoteRef.current?.id }
      : { view: "dashboard" }
    navigate("settings")
  }, [navigate])

  // Back from Settings returns to the recorded origin: the note being edited
  // (it autosaved/flushed on the way out), a fresh editor for a never-saved
  // new note, or the dashboard. If the note no longer exists (data cleared),
  // the dashboard is the only sensible destination.
  const goBackFromSettings = useCallback(() => {
    // SettingsPage persists independently, so re-sync App's settings state on
    // the way out — otherwise the rest of the app runs on stale values
    // (title prefix, audio source, AI popup toggle…) until the next launch.
    setSettings(loadSettings())
    // Imports and other Data actions write straight to storage — refresh list.
    setMeetings(loadMeetings())
    const ret = settingsReturnRef.current
    if (ret.view === "editor") {
      if (ret.meetingId) {
        const m = meetingsRef.current.find(m => m.id === ret.meetingId)
        if (m) { setEditorNote(m); navigate("editor", m.id); return }
      } else {
        setEditorNote(undefined)
        navigate("editor")
        return
      }
    }
    navigate("dashboard")
  }, [navigate])

  useEffect(() => {
    const handler = () => {
      if (isNavigatingRef.current) return
      const { view: hashView, meetingId } = parseHash()
      if (hashView !== viewRef.current) {
        if (hashView === "editor" && meetingId) {
          const m = meetingsRef.current.find(m => m.id === meetingId)
          if (m) setEditorNote(m)
        }
        if (hashView === "editor" && !meetingId) setEditorNote(undefined)
        setView(hashView)
      }
    }
    window.addEventListener("hashchange", handler)
    return () => window.removeEventListener("hashchange", handler)
  }, [navigate])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      const target = e.target as HTMLElement
      const isInput = ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable
      // Palette, settings, and find work from anywhere — including while
      // typing in an input, matching macOS/browser muscle memory.
      if (mod && e.key === "k") { e.preventDefault(); setPaletteOpen(o => !o); return }
      if (mod && e.key === ",") { e.preventDefault(); if (viewRef.current !== "settings") openSettings(); return }
      if (mod && e.key === "/") { e.preventDefault(); setShortcutsOpen(o => !o); return }
      // ⌘F only — ⌘⇧F is focus mode (handled by the note editor); without the
      // shift guard both fire and the find input steals focus mid-toggle.
      if (mod && !e.shiftKey && e.key === "f") {
        if (viewRef.current === "dashboard") { e.preventDefault(); window.dispatchEvent(new CustomEvent("focus-dashboard-search")); return }
        if (viewRef.current === "editor") { e.preventDefault(); window.dispatchEvent(new CustomEvent("open-note-find")); return }
      }
      if (mod && e.key === "n" && !isInput) { e.preventDefault(); navigate("editor"); return }
      if (mod && e.shiftKey && e.key === "R" && viewRef.current === "editor") { e.preventDefault(); window.dispatchEvent(new CustomEvent("toggle-recording")); return }
      if (e.key === "Escape" && viewRef.current !== "dashboard" && !isInput) {
        if (viewRef.current === "editor" && recorderDirtyRef.current) { if (!window.confirm("You have unsaved changes. Leave anyway?")) return; recorderDirtyRef.current = false }
        e.preventDefault()
        if (viewRef.current === "settings") { goBackFromSettings(); return }
        navigate("dashboard"); return
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [navigate, goBackFromSettings, openSettings])

  useEffect(() => {
    const handler = (e: Event) => { const detail = (e as CustomEvent).detail; if (detail.dirty !== undefined) recorderDirtyRef.current = detail.dirty }
    window.addEventListener("recorder-dirty", handler)
    return () => window.removeEventListener("recorder-dirty", handler)
  }, [])

  const handleSettingsChange = useCallback((patch: Partial<AppSettings>) => {
    setSettings(prev => { const next = { ...prev, ...patch }; saveSettings(next); return next })
  }, [])

  const handleThemeChange = useCallback((theme: AppSettings["theme"]) => handleSettingsChange({ theme }), [handleSettingsChange])

  const handleSave = useCallback((meeting: Meeting, stayOnEditor?: boolean) => {
    recorderDirtyRef.current = false
    const isNew = !meetingsRef.current.find(m => m.id === meeting.id)
    const updated = isNew ? [meeting, ...meetingsRef.current] : meetingsRef.current.map(m => m.id === meeting.id ? meeting : m)
    saveMeetings(updated); setMeetings(updated)

    import("@/lib/ai-service").then(({ indexMeetingInMemory }) => {
      indexMeetingInMemory(meeting).catch(() => {})
    })

    if (isNew) {
      if (stayOnEditor) {
        // Keep the note mounted so enhance/knowledge can attach to a real id.
        setEditorNote(meeting)
      } else {
        navigate("dashboard")
      }
    } else if (stayOnEditor && editorNoteRef.current?.id === meeting.id) {
      setEditorNote(meeting)
    }
  }, [navigate])

  const handleDelete = useCallback((id: string) => {
    const meeting = meetingsRef.current.find(m => m.id === id); if (!meeting) return
    const updated = meetingsRef.current.filter(m => m.id !== id)
    saveMeetings(updated); setMeetings(updated)
    toast(`"${meeting.title}" deleted`, {
      id: "delete-meeting",
      action: {
        label: "Undo",
        onClick: () => {
          const restored = [meeting, ...meetingsRef.current]
          saveMeetings(restored); setMeetings(restored)
        },
      },
    })

    import("@/lib/context-memory").then(({ unindexMeeting }) => {
      unindexMeeting(id)
    })
  }, [])

  const handleUpdateMeeting = useCallback((id: string, patch: Partial<Meeting>) => {
    const updated = updateMeeting(id, patch); setMeetings(updated)
  }, [])

  const handleOpenNote = useCallback((note: Meeting) => {
    setEditorNote(note); navigate("editor", note.id)
  }, [navigate])

  // Dashboard "Import Audio": a fully-formed meeting arrives (transcript +
  // notes already set); persist it and drop the user into the editor.
  const handleImportMeeting = useCallback((meeting: Meeting) => {
    const updated = [meeting, ...meetingsRef.current]
    saveMeetings(updated); setMeetings(updated)
    setEditorNote(meeting); navigate("editor", meeting.id)
    import("@/lib/ai-service").then(({ indexMeetingInMemory }) => {
      indexMeetingInMemory(meeting).catch(() => {})
    })
  }, [navigate])

  const handleClearData = useCallback(() => setMeetings([]), [])

  const handleOnboardingComplete = useCallback(() => {
    setOnboardingComplete(true)
    navigate("dashboard")
  }, [navigate])

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { id: string }
      const m = meetingsRef.current.find(m => m.id === detail.id)
      if (m) { setEditorNote(m); navigate("editor", m.id) }
    }
    window.addEventListener("navigate-meeting", handler)
    return () => window.removeEventListener("navigate-meeting", handler)
  }, [navigate])

  // Global quick-capture hotkey (⌘⇧N, registered in Rust): the window is
  // already focused by the backend; we just open a fresh note. Never clobber
  // an unsaved recording in progress.
  useEffect(() => {
    let unlisten: (() => void) | undefined
    let cancelled = false
    listen("quick-capture", () => {
      if (viewRef.current === "editor" && recorderDirtyRef.current) return
      setEditorNote(undefined)
      navigate("editor")
    }).then((u) => { if (cancelled) u(); else unlisten = u })
     .catch(() => { /* not running inside Tauri (plain vite dev) */ })
    return () => { cancelled = true; unlisten?.() }
  }, [navigate])

  // Smart start: when idle on dashboard, detect Zoom/Teams/etc. and prompt —
  // never auto-records (consent + privacy).
  useEffect(() => {
    if (!settings.callDetectEnabled) return
    let cancelled = false
    let lastPromptAt = 0
    let dismissedKey = ""

    const tick = async () => {
      if (cancelled) return
      if (viewRef.current !== "dashboard") return
      if (recorderDirtyRef.current) return
      try {
        const { invoke } = await import("@tauri-apps/api/core")
        const result = await invoke<{ active: boolean; apps: string[]; strong: boolean }>(
          "detect_call_apps",
        )
        if (!result?.active || !result.strong) return
        const key = result.apps.slice().sort().join("|") || "call"
        const now = Date.now()
        // Don't re-prompt same app cluster within 20 minutes.
        if (key === dismissedKey && now - lastPromptAt < 20 * 60 * 1000) return
        if (now - lastPromptAt < 90_000) return
        lastPromptAt = now
        const appLabel = result.apps[0] || "a call"
        toast(`Looks like you're in ${appLabel}`, {
          id: "call-detect",
          description: "Start notes? Myna never records without you.",
          duration: 12_000,
          action: {
            label: "Start notes",
            onClick: () => {
              dismissedKey = key
              setEditorNote(undefined)
              navigate("editor")
              // Let the editor mount, then kick recording.
              window.setTimeout(() => {
                window.dispatchEvent(new CustomEvent("toggle-recording"))
              }, 400)
            },
          },
        })
        dismissedKey = key
      } catch {
        /* not in Tauri or command missing */
      }
    }

    const id = window.setInterval(() => { void tick() }, 45_000)
    // First check after a short delay so startup isn't noisy.
    const first = window.setTimeout(() => { void tick() }, 8_000)
    return () => {
      cancelled = true
      window.clearInterval(id)
      window.clearTimeout(first)
    }
  }, [settings.callDetectEnabled, navigate])

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { pane?: string }
      if (!detail?.pane) return
      try { sessionStorage.setItem("dashboard-pane", detail.pane) } catch { /* ignore */ }
      if (viewRef.current !== "dashboard") navigate("dashboard")
    }
    window.addEventListener("dashboard-pane", handler)
    return () => window.removeEventListener("dashboard-pane", handler)
  }, [navigate])

  return (
    <MotionConfig reducedMotion="user">
      <div className="h-screen overflow-hidden bg-background">
        <ErrorBoundary>
        <AnimatePresence mode="wait">
          {view === "dashboard" && (
            <motion.div
              key="dashboard"
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={pageTransition}
              className="h-screen"
            >
              <main className="h-full min-h-0">
                <MeetingDashboard
                  meetings={meetings}
                  onNewMeeting={() => { setEditorNote(undefined); navigate("editor") }}
                  onImportMeeting={handleImportMeeting}
                  onDeleteMeeting={handleDelete}
                  onUpdateMeeting={handleUpdateMeeting}
                  onViewMeeting={handleOpenNote}
                  onSettings={openSettings}
                />
              </main>
            </motion.div>
          )}
          {view === "editor" && (
            <motion.div
              key={editorNote?.id || "new"}
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={pageTransition}
              className="h-full"
            >
              <NoteEditor
                note={editorNote}
                meetings={meetings}
                onSave={handleSave}
                onCancel={goBack}
                onSettings={openSettings}
                settings={settings}
              />
            </motion.div>
          )}
          {view === "settings" && (
            <motion.div
              key="settings"
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={pageTransition}
              className="flex h-screen min-h-0 flex-col overflow-hidden"
            >
              <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <SettingsPage
                  onBack={goBackFromSettings}
                  onClearData={handleClearData}
                  theme={settings.theme}
                  onThemeChange={handleThemeChange}
                />
              </main>
            </motion.div>
          )}
        </AnimatePresence>
        {confirmDialog && (
          <ConfirmDialog
            open={true}
            onOpenChange={() => setConfirmDialog(null)}
            onConfirm={confirmDialog.onConfirm}
            title={confirmDialog.title}
            message={confirmDialog.message}
            confirmLabel="Leave"
            cancelLabel="Stay"
            variant={confirmDialog.variant ?? "destructive"}
          />
        )}
        {!onboardingComplete && (
          <OnboardingWizard
            open={true}
            onComplete={handleOnboardingComplete}
          />
        )}
        <CommandPalette
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          meetings={meetings}
          onOpenMeeting={handleOpenNote}
          onNewNote={() => { setEditorNote(undefined); navigate("editor") }}
          onOpenSettings={openSettings}
        />
        <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
        <Toaster />
        </ErrorBoundary>
      </div>
    </MotionConfig>
  )
}

export default App
