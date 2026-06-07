import { useState, useCallback } from "react"
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

const pageVariants = {
  initial: { opacity: 0, y: 8, scale: 0.995 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -8, scale: 0.995 },
}

export function App() {
  const [view, setView] = useState<View>("dashboard")
  const [meetings, setMeetings] = useState<Meeting[]>(() => loadMeetings())
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings())
  const [chatMeeting, setChatMeeting] = useState<Meeting | null>(null)
  const [detailMeeting, setDetailMeeting] = useState<Meeting | null>(null)

  useTheme(settings.theme)

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
    setView("dashboard")
  }, [meetings])

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
    setView("chat")
  }, [])

  const handleViewMeeting = useCallback((meeting: Meeting) => {
    setDetailMeeting(meeting)
    setView("detail")
  }, [])

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
                onNewMeeting={() => setView("recorder")}
                onDeleteMeeting={handleDelete}
                onUpdateMeeting={handleUpdateMeeting}
                onChatMeeting={handleChatMeeting}
                onViewMeeting={handleViewMeeting}
                onSettings={() => setView("settings")}
              />
            </motion.div>
        )}
        {view === "recorder" && (
            <motion.div key="recorder" variants={pageVariants} initial="initial" animate="animate" exit="exit" transition={{ duration: 0.2, ease: "easeOut" }}>
              <MeetingRecorder
                onSave={handleSave}
                onCancel={() => setView("dashboard")}
                onSettings={() => setView("settings")}
                settings={settings}
              />
            </motion.div>
          )}
          {view === "settings" && (
            <motion.div key="settings" variants={pageVariants} initial="initial" animate="animate" exit="exit" transition={{ duration: 0.2, ease: "easeOut" }}>
              <SettingsPage
                onBack={() => setView("dashboard")}
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
                onBack={() => setView("dashboard")}
                onSettings={() => setView("settings")}
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
                meeting={detailMeeting}
                onBack={() => setView("dashboard")}
                onSettings={() => setView("settings")}
                onChat={(m) => {
                  setChatMeeting(m)
                  setView("chat")
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
