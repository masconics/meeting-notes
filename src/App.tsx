import { useState, useCallback, useEffect, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { MeetingDashboard } from "@/components/meeting-dashboard"
import { NoteEditor } from "@/components/note-editor"
import { SettingsPage } from "@/components/settings-page"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { OnboardingWizard } from "@/components/onboarding-wizard"
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

const pageVariants = {
  initial: { opacity: 0, y: 8, scale: 0.995 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -8, scale: 0.995 },
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
  const [pendingDelete, setPendingDelete] = useState<Meeting | null>(null)
  const [onboardingComplete, setOnboardingComplete] = useState(() => isOnboardingComplete())
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string
    message: string
    onConfirm: () => void
    variant?: "destructive" | "default"
  } | null>(null)

  const viewRef = useRef(view)
  const meetingsRef = useRef(meetings)
  const isNavigatingRef = useRef(false)
  const recorderDirtyRef = useRef(false)
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
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
      if (mod && e.key === "n" && !isInput) { e.preventDefault(); navigate("editor"); return }
      if (mod && e.shiftKey && e.key === "R" && viewRef.current === "editor") { e.preventDefault(); window.dispatchEvent(new CustomEvent("toggle-recording")); return }
      if (e.key === "Escape" && viewRef.current !== "dashboard" && !isInput) {
        if (viewRef.current === "editor" && recorderDirtyRef.current) { if (!window.confirm("You have unsaved changes. Leave anyway?")) return; recorderDirtyRef.current = false }
        e.preventDefault(); navigate("dashboard"); return
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [navigate])

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
    if (isNew) {
      if (stayOnEditor) {
        setEditorNote(undefined)
      } else {
        navigate("dashboard")
      }
    }
  }, [navigate])

  const handleDelete = useCallback((id: string) => {
    const meeting = meetingsRef.current.find(m => m.id === id); if (!meeting) return
    const updated = meetingsRef.current.filter(m => m.id !== id)
    saveMeetings(updated); setMeetings(updated); setPendingDelete(meeting)
    if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current)
    deleteTimerRef.current = setTimeout(() => setPendingDelete(null), 5000)
  }, [])

  const handleUndoDelete = useCallback(() => {
    if (!pendingDelete) return
    const restored = [pendingDelete, ...meetingsRef.current]
    saveMeetings(restored); setMeetings(restored); setPendingDelete(null)
    if (deleteTimerRef.current) { clearTimeout(deleteTimerRef.current); deleteTimerRef.current = null }
  }, [pendingDelete])

  const handleUpdateMeeting = useCallback((id: string, patch: Partial<Meeting>) => {
    const updated = updateMeeting(id, patch); setMeetings(updated)
  }, [])

  const handleOpenNote = useCallback((note: Meeting) => {
    setEditorNote(note); navigate("editor", note.id)
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

  return (
    <div className="h-screen overflow-hidden bg-muted/30">
      <AnimatePresence mode="wait">
        {view === "dashboard" && (
          <motion.div key="dashboard" variants={pageVariants} initial="initial" animate="animate" exit="exit" transition={{ duration: 0.2, ease: "easeOut" }}>
            <main className="h-screen overflow-y-auto">
              <MeetingDashboard
                meetings={meetings}
                pendingDelete={pendingDelete}
                onUndoDelete={handleUndoDelete}
                onNewMeeting={() => { setEditorNote(undefined); navigate("editor") }}
                onDeleteMeeting={handleDelete}
                onUpdateMeeting={handleUpdateMeeting}
                onViewMeeting={handleOpenNote}
                onSettings={() => navigate("settings")}
              />
            </main>
          </motion.div>
        )}
        {view === "editor" && (
          <motion.div key={editorNote?.id || "new"} variants={pageVariants} initial="initial" animate="animate" exit="exit" transition={{ duration: 0.2, ease: "easeOut" }} className="h-full">
            <NoteEditor
              note={editorNote}
              meetings={meetings}
              onSave={handleSave}
              onCancel={goBack}
              onSettings={() => navigate("settings")}
              settings={settings}
            />
          </motion.div>
        )}
        {view === "settings" && (
          <motion.div key="settings" variants={pageVariants} initial="initial" animate="animate" exit="exit" transition={{ duration: 0.2, ease: "easeOut" }}>
            <main className="h-screen overflow-y-auto">
              <SettingsPage
                onBack={goBack}
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
    </div>
  )
}

export default App
