import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  AccountSetting01Icon,
  Mic01Icon,
  HeadsetIcon,
  LanguageCircleIcon,
  SunIcon,
  MoonIcon,
  ComputerIcon,
  DeleteIcon,
  FolderOpenIcon,
  ArrowLeft01Icon,
  ShieldIcon,
  LockIcon,
  Settings02Icon,
  AiVoiceIcon,
  AiMagicIcon,
  CheckmarkBadge01Icon,
} from "@hugeicons/core-free-icons"
import { useAudioDevices } from "@/lib/use-audio-devices"
import { useMicrophonePermission } from "@/lib/use-permissions"
import { loadSettings, saveSettings, clearAllMeetings, loadMeetings, loadAISettings, saveAISettings } from "@/lib/storage"
import { testConnection } from "@/lib/ai-service"
import type { AppSettings, AISettings } from "@/types"
import { SPEECH_LANGS, AI_MODELS } from "@/types"
import { TemplateEditor } from "@/components/template-editor"

interface SettingsPageProps {
  onBack: () => void
  onClearData: () => void
  theme: AppSettings["theme"]
  onThemeChange: (theme: AppSettings["theme"]) => void
}

export function SettingsPage({
  onBack,
  onClearData,
  theme,
  onThemeChange,
}: SettingsPageProps) {
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings())
  const [aiSettings, setAiSettings] = useState<AISettings>(() => loadAISettings())
  const [meetingCount, setMeetingCount] = useState(0)
  const { devices } = useAudioDevices()
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const mic = useMicrophonePermission()
  const [fluidReady, setFluidReady] = useState<boolean | null>(null)
  const [fluidLoading, setFluidLoading] = useState(false)
  const [fluidLoaded, setFluidLoaded] = useState(false)
  const [testingConnection, setTestingConnection] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<"success" | "failed" | null>(null)

  useEffect(() => {
    setMeetingCount(loadMeetings().length)
    mic.check()
    checkFluid()
    const id = setInterval(async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core")
        setFluidLoaded(await invoke<boolean>("fluid_loaded"))
      } catch {
        // not under Tauri
      }
    }, 3000)
    return () => clearInterval(id)
  }, [])

  async function checkFluid() {
    try {
      const { invoke } = await import("@tauri-apps/api/core")
      setFluidReady(await invoke<boolean>("check_fluid_ready"))
      setFluidLoaded(await invoke<boolean>("fluid_loaded"))
    } catch {
      setFluidReady(null)
    }
  }

  async function handleSetupFluid() {
    setFluidLoading(true)
    try {
      const { invoke } = await import("@tauri-apps/api/core")
      const ready = await invoke<boolean>("setup_fluid")
      setFluidReady(ready)
      setFluidLoaded(true)
    } catch {
      setFluidReady(false)
    } finally {
      setFluidLoading(false)
    }
  }

  const update = useCallback(
    (patch: Partial<AppSettings>) => {
      setSettings((prev) => {
        const next = { ...prev, ...patch }
        saveSettings(next)
        return next
      })
    },
    []
  )

  const updateAI = useCallback(
    (patch: Partial<AISettings>) => {
      setAiSettings((prev) => {
        const next = { ...prev, ...patch }
        saveAISettings(next)
        return next
      })
    },
    []
  )

  const handleTestConnection = useCallback(async () => {
    setTestingConnection(true)
    setConnectionStatus(null)
    try {
      const ok = await testConnection()
      setConnectionStatus(ok ? "success" : "failed")
    } catch {
      setConnectionStatus("failed")
    } finally {
      setTestingConnection(false)
    }
  }, [])

  const handleClearData = useCallback(() => {
    clearAllMeetings()
    onClearData()
    setMeetingCount(0)
    setShowClearConfirm(false)
  }, [onClearData])

  return (
    <div className="flex flex-col gap-6 w-full max-w-2xl mx-auto">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon-sm" onClick={onBack}>
          <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} />
        </Button>
        <div>
          <h1 className="font-heading text-2xl font-medium">Settings</h1>
          <p className="text-muted-foreground text-sm">Configure audio, meetings, and appearance</p>
        </div>
      </div>

      {mic.permission === "denied" && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="flex items-start gap-4 pt-4">
            <div className="bg-destructive/15 inline-flex size-10 shrink-0 items-center justify-center rounded-full">
              <HugeiconsIcon icon={LockIcon} strokeWidth={2} className="size-5 text-destructive" />
            </div>
            <div className="flex flex-col gap-2 flex-1">
              <div>
                <p className="text-sm font-medium">Microphone Access Required</p>
                <p className="text-xs text-muted-foreground">
                  Meeting Notes cannot record audio without microphone permission.
                  Enable it in System Settings to use transcription features.
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={mic.request}>
                  <HugeiconsIcon icon={ShieldIcon} strokeWidth={2} data-icon="inline-start" />
                  Request Access
                </Button>
                <Button variant="default" size="sm" onClick={mic.openSystemSettings}>
                  <HugeiconsIcon icon={Settings02Icon} strokeWidth={2} data-icon="inline-start" />
                  Open System Settings
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Privacy &amp; Security &rarr; Microphone &rarr; enable Meeting Notes
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <HugeiconsIcon icon={AccountSetting01Icon} strokeWidth={2} className="size-5" />
            Audio
          </CardTitle>
          <CardDescription>
            Choose your audio source and input device for transcription
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium">Default Source</label>
            <div className="flex gap-2">
              <Button
                variant={settings.audioSource === "mic" ? "default" : "outline"}
                size="sm"
                onClick={() => update({ audioSource: "mic" })}
                className="flex-1"
              >
                <HugeiconsIcon icon={Mic01Icon} strokeWidth={2} data-icon="inline-start" />
                Microphone
              </Button>
              <Button
                variant={settings.audioSource === "system" ? "default" : "outline"}
                size="sm"
                onClick={() => update({ audioSource: "system" })}
                className="flex-1"
              >
                <HugeiconsIcon icon={HeadsetIcon} strokeWidth={2} data-icon="inline-start" />
                System Audio
              </Button>
            </div>
          </div>

          {devices.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium">Preferred Input Device</label>
              <Select
                value={settings.preferredDeviceId}
                onValueChange={(v) => update({ preferredDeviceId: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select device..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {devices.map((d) => (
                      <SelectItem key={d.deviceId} value={d.deviceId}>
                        {d.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium">Speech Language</label>
            <Select
              value={settings.speechLang}
              onValueChange={(v) => update({ speechLang: v })}
            >
              <SelectTrigger>
                <HugeiconsIcon icon={LanguageCircleIcon} strokeWidth={2} data-icon="inline-start" />
                <SelectValue placeholder="Select language..." />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {Object.entries(SPEECH_LANGS).map(([code, name]) => (
                    <SelectItem key={code} value={code}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Transcription Engine</span>
            <Badge variant="secondary">Fluid — Apple Neural Engine</Badge>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <HugeiconsIcon icon={AiVoiceIcon} strokeWidth={2} className="size-5" />
            Fluid Engine
            <Badge variant="default" className="ml-auto">Active</Badge>
          </CardTitle>
          <CardDescription>
            Parakeet v3 on the Apple Neural Engine via FluidAudio (Core ML sid), fastest on-device option
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-sm">Sidecar binary</span>
            {fluidReady === null ? (
              <Badge variant="outline">Unknown</Badge>
            ) : fluidReady ? (
              <Badge variant="secondary">Installed</Badge>
            ) : (
              <Badge variant="outline">Not found</Badge>
            )}
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm">Memory</span>
            {fluidLoaded ? (
              <Badge variant="secondary" className="gap-1.5">
                <span className="size-1.5 rounded-full bg-emerald-500" />
                Loaded
              </Badge>
            ) : (
              <Badge variant="outline">Idle (not running)</Badge>
            )}
          </div>
          {fluidReady ? (
            <div className="flex items-center gap-2 pt-1">
              <div className="size-2 rounded-full bg-emerald-500" />
              <span className="text-xs text-muted-foreground">
                Fluid sidecar is ready. Models are auto-downloaded by FluidAudio on first launch.
              </span>
            </div>
          ) : (
            <div className="flex flex-col gap-2 pt-1">
              <p className="text-xs text-muted-foreground">
                Build the fluidasr sidecar (Swift) and deploy it to the app data directory.
              </p>
              <div className="bg-muted rounded-2xl p-3 text-xs font-mono text-muted-foreground">
                cd fluid-sidecar &amp;&amp; swift build -c release
              </div>
              <Button size="sm" onClick={handleSetupFluid} disabled={fluidLoading}>
                {fluidLoading ? (
                  <>
                    <div className="size-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />
                    Starting engine…
                  </>
                ) : (
                  <>
                    <HugeiconsIcon icon={AiVoiceIcon} strokeWidth={2} data-icon="inline-start" />
                    Load Engine
                  </>
                )}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <HugeiconsIcon icon={AiMagicIcon} strokeWidth={2} className="size-5" />
            AI Enhancement
          </CardTitle>
          <CardDescription>
            Configure DeepSeek AI for note enhancement, quick actions, and meeting chat
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium">API Key</label>
            <input
              type="password"
              value={aiSettings.apiKey}
              onChange={(e) => updateAI({ apiKey: e.target.value })}
              placeholder="sk-..."
              className="h-8 w-full min-w-0 rounded-2xl border border-transparent bg-input/50 px-2.5 py-1 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
            />
            <p className="text-xs text-muted-foreground">
              Get your key at{" "}
              <a
                href="https://platform.deepseek.com/api_keys"
                target="_blank"
                rel="noreferrer"
                className="text-primary underline underline-offset-3"
              >
                platform.deepseek.com
              </a>
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium">Model</label>
            <Select
              value={aiSettings.model}
              onValueChange={(v) => updateAI({ model: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select model..." />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {Object.entries(AI_MODELS).map(([code, name]) => (
                    <SelectItem key={code} value={code}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm">Enable AI Features</span>
              <span className="text-xs text-muted-foreground">Toggle note enhancement, chat, and quick actions</span>
            </div>
            <button
              role="switch"
              aria-checked={aiSettings.enabled}
              onClick={() => updateAI({ enabled: !aiSettings.enabled })}
              className={`relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors ${
                aiSettings.enabled ? "bg-primary" : "bg-muted border border-border"
              }`}
            >
              <span
                className={`inline-block size-4 rounded-full bg-background shadow-sm transition-transform ${
                  aiSettings.enabled ? "translate-x-5" : "translate-x-1"
                }`}
              />
            </button>
          </div>

          <div className="flex items-center justify-between">
            <Button
              variant="outline"
              size="sm"
              onClick={handleTestConnection}
              disabled={testingConnection || !aiSettings.apiKey}
            >
              {testingConnection ? (
                <>
                  <div className="size-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />
                  Testing...
                </>
              ) : (
                "Test Connection"
              )}
            </Button>
            {connectionStatus === "success" && (
              <Badge variant="secondary" className="gap-1">
                <span className="size-1.5 rounded-full bg-emerald-500" />
                Connected
              </Badge>
            )}
            {connectionStatus === "failed" && (
              <Badge variant="destructive">Connection failed</Badge>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <HugeiconsIcon icon={AccountSetting01Icon} strokeWidth={2} className="size-5" />
            Meeting
          </CardTitle>
          <CardDescription>Default title prefix for new meetings</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium">Title Prefix</label>
            <input
              type="text"
              value={settings.titlePrefix}
              onChange={(e) => update({ titlePrefix: e.target.value })}
              placeholder="e.g. Weekly Standup, Sprint Review..."
              className="h-8 w-full min-w-0 rounded-2xl border border-transparent bg-input/50 px-2.5 py-1 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
            />
            <p className="text-xs text-muted-foreground">
              New meetings will use this as the default title if left blank.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <HugeiconsIcon icon={CheckmarkBadge01Icon} strokeWidth={2} className="size-5" />
            Templates
          </CardTitle>
          <CardDescription>
            Create and manage meeting note templates with custom sections and quick actions
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TemplateEditor />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <HugeiconsIcon icon={SunIcon} strokeWidth={2} className="size-5" />
            Appearance
          </CardTitle>
          <CardDescription>Choose your preferred theme</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            {(["light", "dark", "system"] as const).map((t) => (
              <Button
                key={t}
                variant={theme === t ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  onThemeChange(t)
                  update({ theme: t })
                }}
                className="flex-1"
              >
                <HugeiconsIcon
                  icon={t === "light" ? SunIcon : t === "dark" ? MoonIcon : ComputerIcon}
                  strokeWidth={2}
                  data-icon="inline-start"
                />
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <HugeiconsIcon icon={FolderOpenIcon} strokeWidth={2} className="size-5" />
            Data
          </CardTitle>
          <CardDescription>
            {meetingCount} meeting{meetingCount !== 1 ? "s" : ""} saved in local storage
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AlertDialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm" disabled={meetingCount === 0}>
                <HugeiconsIcon icon={DeleteIcon} strokeWidth={2} data-icon="inline-start" />
                Clear All Meetings
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent size="sm">
              <AlertDialogHeader>
                <AlertDialogTitle>Clear all meetings?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete all {meetingCount} meeting{meetingCount !== 1 ? "s" : ""},
                  including transcripts and notes. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={handleClearData}>
                  Delete All
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </div>
  )
}
