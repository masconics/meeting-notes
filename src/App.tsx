import { useState, useCallback } from "react"
import { MeetingDashboard } from "@/components/meeting-dashboard"
import { MeetingRecorder } from "@/components/meeting-recorder"
import { SettingsPage } from "@/components/settings-page"
import { loadMeetings, saveMeetings, deleteMeeting, loadSettings, saveSettings } from "@/lib/storage"
import { useTheme } from "@/lib/use-theme"
import type { Meeting, AppSettings } from "@/types"

type View = "dashboard" | "recorder" | "settings"

export function App() {
  const [view, setView] = useState<View>("dashboard")
  const [meetings, setMeetings] = useState<Meeting[]>(() => loadMeetings())
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings())

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

  const handleClearData = useCallback(() => {
    setMeetings([])
  }, [])

  return (
    <div className="bg-background min-h-screen">
      <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        {view === "dashboard" && (
          <MeetingDashboard
            meetings={meetings}
            onNewMeeting={() => setView("recorder")}
            onDeleteMeeting={handleDelete}
            onViewMeeting={() => {}}
            onSettings={() => setView("settings")}
          />
        )}
        {view === "recorder" && (
          <MeetingRecorder
            onSave={handleSave}
            onCancel={() => setView("dashboard")}
            onSettings={() => setView("settings")}
            settings={settings}
          />
        )}
        {view === "settings" && (
          <SettingsPage
            onBack={() => setView("dashboard")}
            onClearData={handleClearData}
            theme={settings.theme}
            onThemeChange={handleThemeChange}
          />
        )}
      </div>
    </div>
  )
}

export default App
