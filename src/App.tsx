import { useState, useCallback, useEffect, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { MeetingDashboard } from "@/components/meeting-dashboard"
import { MeetingRecorder } from "@/components/meeting-recorder"
import { SettingsPage } from "@/components/settings-page"
import { ChatPage } from "@/components/chat-page"
import { MeetingDetailPage } from "@/components/meeting-detail-page"
import { loadMeetings, saveMeetings, deleteMeeting, loadSettings, saveSettings, updateMeeting } from "@/lib/storage"
import { useTheme } from "@/lib/use-theme"
import type { Meeting, AppSettings } from "@/types"

type View = "dashboard" | "recorder" | "settings" | "chat" | "detail"

function parseHash(): { view: View; meetingId?: string } {
  const hash = window.location.hash.replace(/^#/, "")
  if (!hash || hash === "dashboard") return { view: "dashboard" }
  if (hash === "recorder") return { view: "recorder" }
  if (hash === "settings") return { view: "settings" }
  const detailMatch = hash.match(/^detail\/(.+)$/)
  if (detailMatch) return { view: "detail", meetingId: detailMatch[1] }
  const chatMatch = hash.match(/^chat\/(.+)$/)
  if (chatMatch) return { view: "chat", meetingId: chatMatch[1] }
  return { view: "dashboard" }
}

function buildHash(view: View, meetingId?: string): string {
  if (view === "dashboard") return "dashboard"
  if (view === "recorder") return "recorder"
  if (view === "settings") return "settings"
  if (view === "detail" && meetingId) return `detail/${meetingId}`
  if (view === "chat" && meetingId) return `chat/${meetingId}`
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
  const [chatMeeting, setChatMeeting] = useState<Meeting | null>(() => {
    if (initialHash.view === "chat" && initialHash.meetingId) {
      return loadedMeetings.find((m) => m.id === initialHash.meetingId) ?? null
    }
    return null
  })
  const [detailMeeting, setDetailMeeting] = useState<Meeting | null>(() => {
    if (initialHash.view === "detail" && initialHash.meetingId) {
      return loadedMeetings.find((m) => m.id === initialHash.meetingId) ?? null
    }
    return null
  })

  const viewRef = useRef(view)
  viewRef.current = view
  const meetingsRef = useRef(meetings)
  meetingsRef.current = meetings
  const isNavigatingRef = useRef(false)

  useTheme(settings.theme)

  const navigate = useCallback((nextView: View, meetingId?: string) => {
    isNavigatingRef.current = true
    window.location.hash = "#" + buildHash(nextView, meetingId)
    setView(nextView)
    setTimeout(() => { isNavigatingRef.current = false }, 0)
  }, [])

  const goBack = useCallback(() => {
    navigate("dashboard")
  }, [navigate])

  useEffect(() => {
    const handler = () => {
      if (isNavigatingRef.current) return
      const { view: hashView, meetingId } = parseHash()
      if (hashView !== viewRef.current) {
        if ((hashView === "detail" || hashView === "chat") && meetingId) {
          const m = meetingsRef.current.find((m) => m.id === meetingId)
          if (!m) {
            navigate("dashboard")
            return
          }
          if (hashView === "detail") setDetailMeeting(m)
          if (hashView === "chat") setChatMeeting(m)
        }
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

      if (mod && e.key === "n" && !isInput) {
        e.preventDefault()
        navigate("recorder")
        return
      }
      if (mod && e.shiftKey && e.key === "R" && viewRef.current === "recorder") {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent("toggle-recording"))
        return
      }
      if (e.key === "Escape" && viewRef.current !== "dashboard" && !isInput) {
        e.preventDefault()
        navigate("dashboard")
        return
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [navigate])

  const handleSettingsChange = useCallback((patch: Partial<AppSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch }
      saveSettings(next)
      return next
    })
  }, [])

  const handleThemeChange = useCallback((theme: AppSettings["theme"]) => {
    handleSettingsChange({ theme })
  }, [handleSettingsChange])

  const handleSave = useCallback((meeting: Meeting) => {
    const updated = [meeting, ...meetings]
    setMeetings(updated)
    saveMeetings(updated)
    navigate("dashboard")
  }, [meetings, navigate])

  const handleDelete = useCallback((id: string) => {
    const updated = deleteMeeting(id)
    setMeetings(updated)
  }, [])

  const handleUpdateMeeting = useCallback((id: string, patch: Partial<Meeting>) => {
    const updated = updateMeeting(id, patch)
    setMeetings(updated)
  }, [])

  const handleChatMeeting = useCallback((meeting: Meeting) => {
    setChatMeeting(meeting)
    navigate("chat", meeting.id)
  }, [navigate])

  const handleViewMeeting = useCallback((meeting: Meeting) => {
    setDetailMeeting(meeting)
    navigate("detail", meeting.id)
  }, [navigate])

  const handleClearData = useCallback(() => {
    setMeetings([])
  }, [])

  return (
    <div className="bg-background min-h-screen">
      <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <AnimatePresence mode="wait">
          {view === "dashboard" && (
            <motion.div key="dashboard" variants={pageVariants} initial="initial" animate="animate" exit="exit" transition={{ duration: 0.2, ease: "easeOut" }}>
              <MeetingDashboard
                meetings={meetings}
                onNewMeeting={() => navigate("recorder")}
                onDeleteMeeting={handleDelete}
                onUpdateMeeting={handleUpdateMeeting}
                onChatMeeting={handleChatMeeting}
                onViewMeeting={handleViewMeeting}
                onSettings={() => navigate("settings")}
              />
            </motion.div>
          )}
          {view === "recorder" && (
            <motion.div key="recorder" variants={pageVariants} initial="initial" animate="animate" exit="exit" transition={{ duration: 0.2, ease: "easeOut" }}>
              <MeetingRecorder
                onSave={handleSave}
                onCancel={goBack}
                onSettings={() => navigate("settings")}
                settings={settings}
              />
            </motion.div>
          )}
          {view === "settings" && (
            <motion.div key="settings" variants={pageVariants} initial="initial" animate="animate" exit="exit" transition={{ duration: 0.2, ease: "easeOut" }}>
              <SettingsPage
                onBack={goBack}
                onClearData={handleClearData}
                theme={settings.theme}
                onThemeChange={handleThemeChange}
              />
            </motion.div>
          )}
          {view === "chat" && chatMeeting && (
            <motion.div key="chat" variants={pageVariants} initial="initial" animate="animate" exit="exit" transition={{ duration: 0.2, ease: "easeOut" }}>
              <ChatPage
                meeting={chatMeeting}
                onBack={goBack}
                onSettings={() => navigate("settings")}
                onUpdate={(updated) => {
                  setChatMeeting(updated)
                  handleUpdateMeeting(updated.id, { chatHistory: updated.chatHistory })
                }}
              />
            </motion.div>
          )}
          {view === "detail" && detailMeeting && (
            <motion.div key="detail" variants={pageVariants} initial="initial" animate="animate" exit="exit" transition={{ duration: 0.2, ease: "easeOut" }}>
              <MeetingDetailPage
                key={detailMeeting.id}
                meeting={detailMeeting}
                onBack={goBack}
                onSettings={() => navigate("settings")}
                onChat={(m) => {
                  setChatMeeting(m)
                  navigate("chat", m.id)
                }}
                onDelete={handleDelete}
                onUpdate={handleUpdateMeeting}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

export default App
