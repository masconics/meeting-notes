import { useState, useEffect, useCallback, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
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
  RefreshIcon,
  Download01Icon,
} from "@hugeicons/core-free-icons"
import { useAudioDevices } from "@/lib/use-audio-devices"
import { useMicrophonePermission } from "@/lib/use-permissions"
import {
  clearAllMeetings,
  loadAISettings,
  loadApiKey,
  loadMeetings,
  loadSettings,
  saveAISettings,
  saveApiKey,
  saveSettings,
} from "@/lib/storage"
import { invoke } from "@tauri-apps/api/core"
import { testConnection } from "@/lib/ai-service"
import { exportAllMeetings, exportAllMeetingsMarkdown } from "@/lib/export"
import type { AppSettings, AISettings } from "@/types"
import { SPEECH_LANGS, AI_MODELS, ASR_MODELS } from "@/types"
import { TemplateEditor } from "@/components/template-editor"
import { Waveform } from "@/components/Waveform"

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
  const { devices, enumerate } = useAudioDevices()

  const getDeviceLabel = useCallback((id: string) => {
    return devices.find(d => d.deviceId === id)?.label ?? null
  }, [devices])
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const mic = useMicrophonePermission()
  const [fluidReady, setFluidReady] = useState<boolean | null>(null)
  const [fluidLoaded, setFluidLoaded] = useState(false)
  const [testingConnection, setTestingConnection] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<"success" | "failed" | null>(null)
  const [apiKeyError, setApiKeyError] = useState<string | null>(null)
  const [pendingTheme, setPendingTheme] = useState<AppSettings["theme"]>(theme)
  const [micTesting, setMicTesting] = useState(false)
  const [micTestLevel, setMicTestLevel] = useState(0)

  useEffect(() => {
    let unlisten: (() => void) | undefined
    if (micTesting) {
      const setup = async () => {
        const { listen } = await import("@tauri-apps/api/event")
        unlisten = await listen<{ rms: number }>("audio-level", (e) => {
          setMicTestLevel(e.payload.rms)
        })
      }
      setup()
    }
    return () => {
      unlisten?.()
    }
  }, [micTesting])

  useEffect(() => {
    setMeetingCount(loadMeetings().length)
    mic.check()
    checkFluid()
    loadApiKey().then((key) => {
      if (key) setAiSettings((prev) => ({ ...prev, apiKey: key }))
    })
    const id = setInterval(async () => {
      try {
        setFluidLoaded(await invoke<boolean>("fluid_loaded"))
      } catch {
        setFluidLoaded(false)
      }
    }, 1000)
    return () => {
      clearInterval(id)
      invoke("stop_mic_test").catch(() => {})
    }
  }, [])

  async function checkFluid() {
    try {
      setFluidReady(await invoke<boolean>("check_fluid_ready"))
      setFluidLoaded(await invoke<boolean>("fluid_loaded"))
    } catch {
      setFluidReady(null)
    }
  }

  const startMicTest = useCallback(async () => {
    try {
      const label = settings.preferredDeviceId !== "default"
        ? getDeviceLabel(settings.preferredDeviceId)
        : null
      await invoke("start_mic_test", { deviceId: label })
      setMicTesting(true)
    } catch {
      setMicTesting(false)
    }
  }, [settings.preferredDeviceId, getDeviceLabel])

  const stopMicTest = useCallback(async () => {
    setMicTesting(false)
    setMicTestLevel(0)
    await invoke("stop_mic_test").catch(() => {})
  }, [])

  const validateApiKey = useCallback((key: string): string | null => {
    if (!key) return null
    if (!key.startsWith("sk-")) return "API key must start with 'sk-'"
    if (key.length < 20) return "API key must be at least 20 characters"
    return null
  }, [])

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
        if (patch.apiKey !== undefined) saveApiKey(patch.apiKey)
        return next
      })
    },
    []
  )

  const handleTestConnection = useCallback(async () => {
    const err = validateApiKey(aiSettings.apiKey)
    if (err) {
      setApiKeyError(err)
      return
    }
    setApiKeyError(null)
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
  }, [aiSettings.apiKey, validateApiKey])

  const handleClearData = useCallback(() => {
    clearAllMeetings()
    onClearData()
    setMeetingCount(0)
    setShowClearConfirm(false)
  }, [onClearData])

  return (
    <div className="app-page app-page-narrow">
      <div className="app-page-header">
        <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon-sm" onClick={onBack} title="Back" aria-label="Back">
          <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} />
        </Button>
        <div>
          <h1 className="app-page-title">Settings</h1>
          <p className="app-page-description">Configure audio, AI, templates, and appearance</p>
        </div>
        </div>
      </div>

      {mic.permission === "denied" && (
        <Card size="sm" className="border-destructive/30">
          <CardContent className="flex items-start gap-4 pt-4">
            <div className="bg-destructive/10 inline-flex size-10 shrink-0 items-center justify-center rounded-2xl">
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

      <Card size="sm">
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
            </div>
          </div>

          {devices.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <label className="text-xs font-medium">Preferred Input Device</label>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="size-5"
                  onClick={() => enumerate()}
                  title="Refresh devices"
                  aria-label="Refresh device list"
                >
                  <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} className="size-3.5" />
                </Button>
              </div>
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

          <div className="flex flex-col gap-2">
            {!micTesting ? (
              <Button variant="outline" size="sm" onClick={startMicTest} className="w-fit">
                <HugeiconsIcon icon={Mic01Icon} strokeWidth={2} data-icon="inline-start" />
                Test Microphone
              </Button>
            ) : (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <Button variant="destructive" size="sm" onClick={stopMicTest}>
                    Stop Testing
                  </Button>
                  <div className="size-2 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-xs text-muted-foreground">Listening...</span>
                </div>
                <Waveform active={micTesting} level={micTestLevel} className="w-full" height={48} />
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <HugeiconsIcon icon={AiVoiceIcon} strokeWidth={2} className="size-5" />
            Transcription
            {fluidLoaded ? (
              <Badge variant="default" className="ml-auto">Ready</Badge>
            ) : fluidReady ? (
              <Badge variant="outline" className="ml-auto">Setting up&hellip;</Badge>
            ) : fluidReady === false ? (
              <Badge variant="destructive" className="ml-auto">Not installed</Badge>
            ) : (
              <Badge variant="outline" className="ml-auto">Checking&hellip;</Badge>
            )}
          </CardTitle>
          <CardDescription>
            On-device transcription via Apple Neural Engine &mdash; nothing leaves your computer
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium">Model</label>
            <Select
              value={settings.asrModel || "parakeet"}
              onValueChange={(v) => update({ asrModel: v as "parakeet" | "sensevoice" })}
            >
              <SelectTrigger>
                <HugeiconsIcon icon={AiVoiceIcon} strokeWidth={2} data-icon="inline-start" />
                <SelectValue placeholder="Select model..." />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {Object.entries(ASR_MODELS).map(([key, name]) => (
                    <SelectItem key={key} value={key}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium">Language</label>
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

          {!fluidReady && fluidReady !== null && (
            <div className="rounded-2xl bg-muted p-4 text-sm ring-1 ring-border/70">
              <p className="font-medium mb-2">Transcription engine not installed</p>
              <p className="text-muted-foreground mb-3">Build the engine from the source and place it in the app bundle:</p>
              <div className="app-code-block">
                cd fluid-sidecar<br />
                swift build -c release<br />
                cp .build/release/fluidasr ../src-tauri/binaries/fluidasr-aarch64-apple-darwin
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card size="sm">
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
            <Input
              type="password"
              value={aiSettings.apiKey}
              onChange={(e) => {
                updateAI({ apiKey: e.target.value });
                setApiKeyError(null);
              }}
              onBlur={() => {
                if (aiSettings.apiKey) setApiKeyError(validateApiKey(aiSettings.apiKey));
              }}
              placeholder="sk-..."
            />
            {apiKeyError && (
              <p className="text-xs text-destructive">{apiKeyError}</p>
            )}
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
              className={`relative inline-flex h-6 w-10 shrink-0 items-center rounded-2xl ring-1 ring-border/70 transition-colors ${
                aiSettings.enabled ? "bg-primary" : "bg-muted"
              }`}
            >
              <span
                className={`inline-block size-4 rounded-[calc(var(--radius)+2px)] bg-background shadow-sm transition-transform ${
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
              <Badge variant="secondary">Connected</Badge>
            )}
            {connectionStatus === "failed" && (
              <Badge variant="destructive">Connection failed</Badge>
            )}
          </div>
        </CardContent>
      </Card>

      <Card size="sm">
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
            <Input
              type="text"
              value={settings.titlePrefix}
              onChange={(e) => update({ titlePrefix: e.target.value })}
              placeholder="e.g. Weekly Standup, Sprint Review..."
            />
            <p className="text-xs text-muted-foreground">
              New meetings will use this as the default title if left blank.
            </p>
            <p className="text-xs text-muted-foreground">
              Preview: <span className="font-medium text-foreground">{settings.titlePrefix || "[prefix]"}</span>Untitled
            </p>
          </div>
        </CardContent>
      </Card>

      <Card size="sm">
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

      <Card size="sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <HugeiconsIcon icon={SunIcon} strokeWidth={2} className="size-5" />
            Appearance
          </CardTitle>
          <CardDescription>Choose your preferred theme</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-3">
            {(["light", "dark", "system"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setPendingTheme(t)}
                className={`flex items-center gap-3 rounded-xl border p-3 text-left transition-colors ${
                  pendingTheme === t
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "border-border hover:border-primary/40"
                }`}
              >
                <HugeiconsIcon
                  icon={t === "light" ? SunIcon : t === "dark" ? MoonIcon : ComputerIcon}
                  strokeWidth={2}
                  className="size-5 shrink-0"
                />
                <div className="flex-1">
                  <p className="text-sm font-medium">{t.charAt(0).toUpperCase() + t.slice(1)}</p>
                  <p className="text-xs text-muted-foreground">
                    {t === "light" ? "Light appearance" : t === "dark" ? "Dark appearance" : "Follow system preference"}
                  </p>
                </div>
                <div
                  className={`h-8 w-14 shrink-0 rounded-md border overflow-hidden ${
                    t === "light"
                      ? "bg-amber-50"
                      : t === "dark"
                        ? "bg-gray-900"
                        : "bg-gradient-to-br from-amber-50 to-gray-900"
                  }`}
                >
                  <div
                    className={`h-2 ${
                      t === "light"
                        ? "bg-amber-100"
                        : t === "dark"
                          ? "bg-gray-700"
                          : "bg-gradient-to-r from-amber-100 to-gray-700"
                    }`}
                  />
                  <div
                    className={`mx-1.5 mt-0.5 h-0.5 rounded-full ${
                      t === "light" ? "bg-amber-200" : "bg-gray-600"
                    }`}
                  />
                  <div
                    className={`mx-1.5 mt-0.5 h-0.5 w-2/3 rounded-full ${
                      t === "light" ? "bg-amber-200" : "bg-gray-600"
                    }`}
                  />
                </div>
              </button>
            ))}
          </div>
          {pendingTheme !== theme && (
            <Button
              size="sm"
              onClick={() => {
                onThemeChange(pendingTheme)
                update({ theme: pendingTheme })
              }}
            >
              Apply Theme
            </Button>
          )}
        </CardContent>
      </Card>

      <Card size="sm" className="border-destructive/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <HugeiconsIcon icon={FolderOpenIcon} strokeWidth={2} className="size-5" />
            Data
          </CardTitle>
          <CardDescription>
            {meetingCount} meeting{meetingCount !== 1 ? "s" : ""} saved in local storage
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={meetingCount === 0}
              onClick={() => exportAllMeetings()}
            >
              <HugeiconsIcon icon={Download01Icon} strokeWidth={2} data-icon="inline-start" />
              Export All (JSON)
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={meetingCount === 0}
              onClick={() => exportAllMeetingsMarkdown()}
            >
              <HugeiconsIcon icon={Download01Icon} strokeWidth={2} data-icon="inline-start" />
              Export All (Markdown)
            </Button>
          </div>
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
