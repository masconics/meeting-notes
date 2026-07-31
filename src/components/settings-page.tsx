import { useState, useEffect, useCallback, useMemo, useRef } from "react"
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
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
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
  ArrowRight01Icon,
  ShieldIcon,
  LockIcon,
  Settings02Icon,
  AiVoiceIcon,
  AiMagicIcon,
  CheckmarkBadge01Icon,
  RefreshIcon,
  Download01Icon,
  Book02Icon,
  PenToolIcon,
  KeyboardIcon,
  Add01Icon,
} from "@hugeicons/core-free-icons"
import { useAudioDevices } from "@/lib/use-audio-devices"
import { useMicrophonePermission } from "@/lib/use-permissions"
import {
  clearAllMeetings,
  loadAISettings,
  loadApiKey,
  loadDictionary,
  loadMeetings,
  loadSettings,
  loadSnippets,
  saveAISettings,
  saveApiKey,
  saveDictionary,
  saveSettings,
  saveSnippets,
} from "@/lib/storage"
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { testConnection } from "@/lib/ai-service"
import { exportAllMeetings, exportAllMeetingsMarkdown } from "@/lib/export"
import type { AppSettings, AISettings, DictionaryEntry, Snippet } from "@/types"
import { SPEECH_LANGS, AI_MODELS, TRANSCRIPTION_MODELS, WRITING_STYLES } from "@/types"
import { Textarea } from "@/components/ui/textarea"
import { TemplateEditor } from "@/components/template-editor"
import { Waveform } from "@/components/Waveform"
import { cn } from "@/lib/utils"

interface SettingsPageProps {
  onBack: () => void
  onClearData: () => void
  theme: AppSettings["theme"]
  onThemeChange: (theme: AppSettings["theme"]) => void
}

type ModelProgress = {
  fraction: number
  percent: number
  phase: string
  model: AppSettings["transcriptionModel"]
}

type ModelSetupStatus = {
  running: boolean
  model: AppSettings["transcriptionModel"] | null
  progress: ModelProgress | null
  error: string | null
}

type ModelSetupError = {
  model: AppSettings["transcriptionModel"]
  error: string
}

type SettingsSection =
  | "audio"
  | "transcription"
  | "ai"
  | "style"
  | "dictionary"
  | "snippets"
  | "meeting"
  | "templates"
  | "appearance"
  | "data"

const SECTION_GROUPS: {
  label: string
  items: { id: SettingsSection; label: string; icon: IconSvgElement }[]
}[] = [
  {
    label: "Capture",
    items: [
      { id: "audio", label: "Audio", icon: Mic01Icon },
      { id: "transcription", label: "Transcription", icon: AiVoiceIcon },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { id: "ai", label: "AI Enhancement", icon: AiMagicIcon },
      { id: "style", label: "Writing Style", icon: PenToolIcon },
      { id: "dictionary", label: "Dictionary", icon: Book02Icon },
      { id: "snippets", label: "Shortcuts", icon: KeyboardIcon },
    ],
  },
  {
    label: "Notes",
    items: [
      { id: "meeting", label: "Meeting", icon: AccountSetting01Icon },
      { id: "templates", label: "Templates", icon: CheckmarkBadge01Icon },
    ],
  },
  {
    label: "App",
    items: [
      { id: "appearance", label: "Appearance", icon: SunIcon },
      { id: "data", label: "Data", icon: FolderOpenIcon },
    ],
  },
]

function SettingsSidebar({
  active,
  onSelect,
  micDenied,
}: {
  active: SettingsSection
  onSelect: (section: SettingsSection) => void
  micDenied: boolean
}) {
  return (
    <aside className="sticky top-5 w-11 shrink-0 self-start sm:w-44">
      <nav className="flex flex-col gap-4" aria-label="Settings sections">
        {SECTION_GROUPS.map((group) => (
          <div key={group.label} className="flex flex-col gap-0.5">
            <p className="hidden px-2.5 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70 sm:block">
              {group.label}
            </p>
            {group.items.map((item) => {
              const isActive = active === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelect(item.id)}
                  title={item.label}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "flex items-center justify-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors sm:justify-start",
                    isActive
                      ? "bg-primary/10 font-medium text-primary"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  <HugeiconsIcon icon={item.icon} strokeWidth={2} className="size-4 shrink-0" />
                  <span className="hidden truncate sm:inline">{item.label}</span>
                  {item.id === "audio" && micDenied && (
                    <span className="ml-auto hidden size-1.5 shrink-0 rounded-full bg-amber-500 sm:inline" aria-label="Microphone permission needed" />
                  )}
                </button>
              )
            })}
          </div>
        ))}
      </nav>
    </aside>
  )
}

// Renders a snippet expansion preview with {{variables}} highlighted as inline code chips.
function renderExpansionPreview(expansion: string) {
  return expansion.split(/(\{\{[^}]+\}\})/g).map((part, i) =>
    /^\{\{[^}]+\}\}$/.test(part) ? (
      <code
        key={i}
        className="rounded-md bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground ring-1 ring-border/60"
      >
        {part}
      </code>
    ) : (
      <span key={i}>{part}</span>
    ),
  )
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
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const {
    permission: micPermission,
    check: checkMicPermission,
    request: requestMicPermission,
    openSystemSettings: openMicSystemSettings,
  } = useMicrophonePermission()
  const [fluidReady, setFluidReady] = useState<boolean | null>(null)
  const [fluidLoaded, setFluidLoaded] = useState(false)
  const [modelStorage, setModelStorage] = useState<{ present: boolean; bytes: number } | null>(null)
  const [modelProgress, setModelProgress] = useState<ModelProgress | null>(null)
  const [settingUpModel, setSettingUpModel] = useState(false)
  const [downloadingModel, setDownloadingModel] = useState<AppSettings["transcriptionModel"] | null>(null)
  const [modelOperation, setModelOperation] = useState<"download" | "load" | null>(null)
  const [setupError, setSetupError] = useState<string | null>(null)
  const [deletingModel, setDeletingModel] = useState(false)
  const [cancellingModel, setCancellingModel] = useState(false)
  const [testingConnection, setTestingConnection] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<"success" | "failed" | null>(null)
  const [apiKeyError, setApiKeyError] = useState<string | null>(null)
  const [pendingTheme, setPendingTheme] = useState<AppSettings["theme"]>(theme)
  const [dictionary, setDictionary] = useState<DictionaryEntry[]>(() => loadDictionary())
  const [snippets, setSnippets] = useState<Snippet[]>(() => loadSnippets())
  const [newTerm, setNewTerm] = useState("")
  const [newAliases, setNewAliases] = useState("")
  const [newTrigger, setNewTrigger] = useState("")
  const [newExpansion, setNewExpansion] = useState("")
  const [activeSection, setActiveSection] = useState<SettingsSection>("audio")
  const expansionRef = useRef<HTMLTextAreaElement>(null)
  const [micTesting, setMicTesting] = useState(false)
  const [micTestLevel, setMicTestLevel] = useState(0)
  const micTestStreamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const micTestFrameRef = useRef<number>(0)
  const downloadingModelRef = useRef<AppSettings["transcriptionModel"] | null>(null)
  const selectedModelRef = useRef<AppSettings["transcriptionModel"]>(settings.transcriptionModel)

  useEffect(() => {
    downloadingModelRef.current = downloadingModel
  }, [downloadingModel])

  useEffect(() => {
    selectedModelRef.current = settings.transcriptionModel
  }, [settings.transcriptionModel])

  const setReadyProgress = useCallback((model: AppSettings["transcriptionModel"]) => {
    setModelProgress((prev) => {
      if (prev?.model === model && prev.phase === "ready" && prev.percent === 100) return prev
      return { fraction: 1, percent: 100, phase: "ready", model }
    })
  }, [])

  const setProgressSnapshot = useCallback((progress: ModelProgress) => {
    setModelProgress((prev) => {
      if (
        prev?.model === progress.model &&
        prev.phase === progress.phase &&
        prev.percent === progress.percent
      ) return prev
      return progress
    })
  }, [])

  const inferOperation = useCallback((progress: ModelProgress | null): "download" | "load" => {
    return progress?.phase === "loading" ? "load" : "download"
  }, [])

  const refreshModelStorage = useCallback(async () => {
    try {
      setModelStorage(await invoke<{ present: boolean; bytes: number }>("model_storage_info", {
        model: settings.transcriptionModel,
      }))
    } catch {
      setModelStorage(null)
    }
  }, [settings.transcriptionModel])

  const checkFluid = useCallback(async () => {
    try {
      setFluidReady(await invoke<boolean>("check_fluid_ready"))
      const loaded = await invoke<boolean>("fluid_loaded", { model: settings.transcriptionModel })
      setFluidLoaded(loaded)
      if (loaded) {
        setSettingUpModel(false)
        setDownloadingModel(null)
        setModelOperation(null)
        setReadyProgress(settings.transcriptionModel)
      } else {
        const status = await invoke<ModelSetupStatus>("model_setup_status", {
          model: settings.transcriptionModel,
        })
        if (status.running && status.model === settings.transcriptionModel) {
          setSettingUpModel(true)
          setDownloadingModel(status.model)
          setModelOperation(inferOperation(status.progress))
          if (status.progress) setProgressSnapshot(status.progress)
        } else if (status.error) {
          setSetupError(status.error)
        }
      }
    } catch {
      setFluidReady(null)
    }
    await refreshModelStorage()
  }, [inferOperation, refreshModelStorage, setProgressSnapshot, setReadyProgress, settings.transcriptionModel])

  useEffect(() => {
    queueMicrotask(() => setMeetingCount(loadMeetings().length))
    checkMicPermission()
    queueMicrotask(() => {
      void checkFluid()
    })
    loadApiKey().then((key) => {
      if (key) setAiSettings((prev) => ({ ...prev, apiKey: key }))
    })
    const id = setInterval(async () => {
      try {
        const loaded = await invoke<boolean>("fluid_loaded", { model: settings.transcriptionModel })
        setFluidLoaded((prev) => prev === loaded ? prev : loaded)
        if (loaded) {
          setSettingUpModel((prev) => prev ? false : prev)
          setDownloadingModel((prev) => prev === null ? prev : null)
          setModelOperation((prev) => prev === null ? prev : null)
          setReadyProgress(settings.transcriptionModel)
        } else {
          const status = await invoke<ModelSetupStatus>("model_setup_status", {
            model: settings.transcriptionModel,
          })
          if (status.running && status.model === settings.transcriptionModel) {
            setSettingUpModel((prev) => prev ? prev : true)
            setDownloadingModel((prev) => prev === status.model ? prev : status.model)
            setModelOperation((prev) => prev ?? inferOperation(status.progress))
            if (status.progress) setProgressSnapshot(status.progress)
          }
        }
      } catch {
        setFluidLoaded(false)
      }
    }, 1000)
    let unlisten: (() => void) | undefined
    listen<ModelProgress>("fluid-model-progress", (event) => {
      const progress = event.payload
      const activeModel = downloadingModelRef.current ?? selectedModelRef.current
      if (progress.model !== activeModel) return
      setModelProgress((prev) => {
        const previousPercent = prev?.model === progress.model ? prev.percent : 0
        const percent = progress.phase === "ready"
          ? 100
          : Math.max(previousPercent, progress.percent)
        return {
          ...progress,
          percent,
          fraction: percent / 100,
        }
      })
      setSetupError(null)
      if (progress.phase === "downloaded") {
        setSettingUpModel(false)
        setDownloadingModel(null)
        setModelOperation(null)
        void refreshModelStorage()
      }
    }).then((fn) => {
      unlisten = fn
    }).catch(() => {})
    let unlistenError: (() => void) | undefined
    listen<ModelSetupError>("fluid-model-error", (event) => {
      const payload = event.payload
      const activeModel = downloadingModelRef.current ?? selectedModelRef.current
      if (payload.model !== activeModel) return
      setSetupError(payload.error)
      setSettingUpModel(false)
      setDownloadingModel(null)
      setModelOperation(null)
    }).then((fn) => {
      unlistenError = fn
    }).catch(() => {})
    return () => {
      clearInterval(id)
      unlisten?.()
      unlistenError?.()
      if (micTestFrameRef.current) cancelAnimationFrame(micTestFrameRef.current)
      if (micTestStreamRef.current) micTestStreamRef.current.getTracks().forEach((t) => t.stop())
      if (audioContextRef.current) audioContextRef.current.close()
    }
  }, [checkFluid, checkMicPermission, inferOperation, refreshModelStorage, setProgressSnapshot, setReadyProgress, settings.transcriptionModel])

  async function setupModel() {
    const model = settings.transcriptionModel
    setSettingUpModel(true)
    setDownloadingModel(model)
    setModelOperation("load")
    setSetupError(null)
    setModelProgress({ fraction: 0, percent: 0, phase: "loading", model })
    try {
      await invoke<boolean>("setup_fluid_model", { model })
      setFluidReady(true)
      const loaded = await invoke<boolean>("fluid_loaded", { model })
      setFluidLoaded(loaded)
      if (loaded) {
        setModelProgress({ fraction: 1, percent: 100, phase: "ready", model })
        setSettingUpModel(false)
        setDownloadingModel(null)
        setModelOperation(null)
      }
      await refreshModelStorage()
    } catch (e) {
      setSetupError(e instanceof Error ? e.message : String(e))
      setSettingUpModel(false)
      setDownloadingModel(null)
      setModelOperation(null)
    }
  }

  async function downloadModel() {
    const model = settings.transcriptionModel
    setSettingUpModel(true)
    setDownloadingModel(model)
    setModelOperation("download")
    setSetupError(null)
    setModelProgress({ fraction: 0, percent: 0, phase: "starting", model })
    try {
      await invoke<boolean>("download_model", { model })
      setFluidReady(true)
      await refreshModelStorage()
    } catch (e) {
      setSetupError(e instanceof Error ? e.message : String(e))
      setSettingUpModel(false)
      setDownloadingModel(null)
      setModelOperation(null)
    }
  }

  async function cancelModelSetup() {
    const model = downloadingModel ?? settings.transcriptionModel
    setCancellingModel(true)
    try {
      await invoke<boolean>("cancel_model_setup", { model })
      setSettingUpModel(false)
      setDownloadingModel(null)
      setModelOperation(null)
      setModelProgress(null)
      setSetupError(null)
      await refreshModelStorage()
    } catch (e) {
      setSetupError(e instanceof Error ? e.message : String(e))
    } finally {
      setCancellingModel(false)
    }
  }

  async function unloadModelFromMemory() {
    try {
      await invoke<void>("unload_fluid")
      setFluidLoaded(false)
      setModelProgress(null)
      setSetupError(null)
    } catch (e) {
      setSetupError(e instanceof Error ? e.message : String(e))
    }
  }

  async function deleteModel() {
    if (!window.confirm(
      "Delete the downloaded transcription model? It will stay removed until you download it again or start transcription.",
    )) return
    setDeletingModel(true)
    try {
      setModelStorage(await invoke<{ present: boolean; bytes: number }>("delete_model", {
        model: settings.transcriptionModel,
      }))
      setFluidLoaded(false)
      setSettingUpModel(false)
      setDownloadingModel(null)
      setModelOperation(null)
      setModelProgress(null)
      setSetupError(null)
    } catch (e) {
      window.alert(`Couldn't delete the model: ${e}`)
    } finally {
      setDeletingModel(false)
    }
  }

  function formatBytes(bytes: number): string {
    if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`
    if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`
    if (bytes >= 1e3) return `${Math.round(bytes / 1e3)} KB`
    return `${bytes} B`
  }

  function formatProgressPhase(phase: string): string {
    switch (phase) {
      case "listing":
        return "Preparing download"
      case "downloading":
        return "Downloading model"
      case "compiling":
        return "Compiling Core ML model"
      case "loading":
        return "Loading model"
      case "downloaded":
        return "Downloaded"
      case "ready":
        return "Ready"
      default:
        return "Starting"
    }
  }

  function selectTranscriptionModel(model: AppSettings["transcriptionModel"]) {
    update({ transcriptionModel: model })
    setFluidLoaded(false)
    setDownloadingModel(null)
    setModelOperation(null)
    setModelProgress(null)
    setSetupError(null)
    setModelStorage(null)
  }

  const startMicTest = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      micTestStreamRef.current = stream
      const audioCtx = new AudioContext()
      audioContextRef.current = audioCtx
      const source = audioCtx.createMediaStreamSource(stream)
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 256
      source.connect(analyser)
      const dataArray = new Uint8Array(analyser.frequencyBinCount)
      const loop = () => {
        analyser.getByteTimeDomainData(dataArray)
        let sum = 0
        for (let i = 0; i < dataArray.length; i++) {
          const v = (dataArray[i] - 128) / 128
          sum += v * v
        }
        setMicTestLevel(Math.sqrt(sum / dataArray.length))
        micTestFrameRef.current = requestAnimationFrame(loop)
      }
      loop()
      setMicTesting(true)
    } catch {
      setMicTesting(false)
    }
  }, [])

  const stopMicTest = useCallback(() => {
    if (micTestFrameRef.current) {
      cancelAnimationFrame(micTestFrameRef.current)
      micTestFrameRef.current = 0
    }
    if (micTestStreamRef.current) {
      micTestStreamRef.current.getTracks().forEach((t) => t.stop())
      micTestStreamRef.current = null
    }
    if (audioContextRef.current) {
      audioContextRef.current.close()
      audioContextRef.current = null
    }
    setMicTesting(false)
    setMicTestLevel(0)
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

  const addDictionaryEntry = useCallback(() => {
    const term = newTerm.trim()
    if (!term) return
    const aliases = newAliases
      .split(",")
      .map((a) => a.trim())
      .filter((a) => a && a.toLowerCase() !== term.toLowerCase())
    setDictionary((prev) => {
      // Re-adding an existing term updates its aliases instead of duplicating.
      const next = [
        ...prev.filter((e) => e.term.toLowerCase() !== term.toLowerCase()),
        { id: crypto.randomUUID(), term, aliases },
      ]
      saveDictionary(next)
      return next
    })
    setNewTerm("")
    setNewAliases("")
  }, [newTerm, newAliases])

  const removeDictionaryEntry = useCallback((id: string) => {
    setDictionary((prev) => {
      const next = prev.filter((e) => e.id !== id)
      saveDictionary(next)
      return next
    })
  }, [])

  const addSnippet = useCallback(() => {
    const trigger = newTrigger.trim().replace(/^;+/, "")
    const expansion = newExpansion.trim()
    if (!trigger || !expansion || /\s/.test(trigger)) return
    setSnippets((prev) => {
      const next = [
        ...prev.filter((s) => s.trigger.toLowerCase() !== trigger.toLowerCase()),
        { id: crypto.randomUUID(), trigger, expansion },
      ]
      saveSnippets(next)
      return next
    })
    setNewTrigger("")
    setNewExpansion("")
  }, [newTrigger, newExpansion])

  const removeSnippet = useCallback((id: string) => {
    setSnippets((prev) => {
      const next = prev.filter((s) => s.id !== id)
      saveSnippets(next)
      return next
    })
  }, [])

  // Insert a {{variable}} token at the textarea cursor, restoring focus and caret.
  const insertVariable = useCallback((variable: string) => {
    const token = `{{${variable}}}`
    const ta = expansionRef.current
    if (!ta) {
      setNewExpansion((prev) => prev + token)
      return
    }
    const start = ta.selectionStart ?? ta.value.length
    const end = ta.selectionEnd ?? ta.value.length
    setNewExpansion((prev) => prev.slice(0, start) + token + prev.slice(end))
    requestAnimationFrame(() => {
      ta.focus()
      const pos = start + token.length
      ta.setSelectionRange(pos, pos)
    })
  }, [])

  const sortedDictionary = useMemo(
    () => [...dictionary].sort((a, b) => a.term.localeCompare(b.term)),
    [dictionary],
  )
  const sortedSnippets = useMemo(
    () => [...snippets].sort((a, b) => a.trigger.localeCompare(b.trigger)),
    [snippets],
  )
  const triggerHasSpace = /\s/.test(newTrigger)

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

  const selectedModel = TRANSCRIPTION_MODELS[settings.transcriptionModel]
  const activeDownloadModel = downloadingModel ?? modelProgress?.model ?? settings.transcriptionModel
  const activeDownloadModelInfo = TRANSCRIPTION_MODELS[activeDownloadModel]
  const showingDownloadProgress = settingUpModel || Boolean(modelProgress && modelProgress.phase !== "ready")
  const shouldShowDownloadCard = fluidReady && !fluidLoaded && !modelStorage?.present
  const activeOperationLabel = modelOperation === "load" ? "Loading" : "Downloading"

  return (
    <div className="app-page">
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

      <div className="flex items-start gap-6">
        <SettingsSidebar
          active={activeSection}
          onSelect={setActiveSection}
          micDenied={micPermission === "denied"}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-3">
      {micPermission === "denied" && (
        <Card size="sm" className={cn("border-destructive/30", activeSection !== "audio" && "hidden")}>
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
                <Button variant="outline" size="sm" onClick={requestMicPermission}>
                  <HugeiconsIcon icon={ShieldIcon} strokeWidth={2} data-icon="inline-start" />
                  Request Access
                </Button>
                <Button variant="default" size="sm" onClick={openMicSystemSettings}>
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

      <Card size="sm" className={cn(activeSection !== "audio" && "hidden")}>
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
              <Button
                variant={settings.audioSource === "both" ? "default" : "outline"}
                size="sm"
                onClick={() => update({ audioSource: "both" })}
                className="flex-1"
              >
                Both
              </Button>
            </div>
            {settings.audioSource !== "mic" && (
              <p className="text-xs text-muted-foreground">
                System audio is captured directly (Core Audio tap — no screen recording) and uses the Parakeet model. Requires macOS 14.4+.
              </p>
            )}
          </div>

          {settings.audioSource !== "system" && devices.length > 0 && (
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

          {settings.audioSource !== "system" && (
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
                  <Waveform active={micTesting} level={micTestLevel} className="min-w-[160px]" />
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card size="sm" className={cn(activeSection !== "transcription" && "hidden")}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <HugeiconsIcon icon={AiVoiceIcon} strokeWidth={2} className="size-5" />
            Transcription
            {fluidLoaded ? (
              <Badge variant="default" className="ml-auto">Ready</Badge>
            ) : fluidReady ? (
              <Badge variant="outline" className="ml-auto">Needs model</Badge>
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
          <div className="flex flex-col gap-2">
            <label className="text-xs font-medium">Model</label>
            <div className="grid gap-3 md:grid-cols-2">
              {Object.entries(TRANSCRIPTION_MODELS).map(([id, model]) => {
                const selected = settings.transcriptionModel === id
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => selectTranscriptionModel(id as AppSettings["transcriptionModel"])}
                    disabled={settingUpModel}
                    className={cn(
                      "flex items-center justify-between gap-3 rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-70",
                      selected
                        ? "border-primary bg-primary/5"
                        : "border-border bg-background hover:bg-muted/50"
                    )}
                    aria-pressed={selected}
                  >
                    <div className="min-w-0 flex flex-col gap-1">
                      <span className="truncate text-sm font-medium">{model.name}</span>
                      <span className="line-clamp-2 text-xs text-muted-foreground">{model.bestFor}</span>
                    </div>
                    <Badge variant={selected ? "default" : "outline"} className="shrink-0">
                      {selected ? "Selected" : model.size}
                    </Badge>
                  </button>
                )
              })}
            </div>
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

          {modelStorage?.present && (
            <div className="flex flex-col gap-3 rounded-2xl bg-muted p-4 ring-1 ring-border/70">
              <div className="flex items-center justify-between gap-3">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">{selectedModel.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {fluidLoaded ? "Loaded in memory" : "Downloaded on disk"} · {formatBytes(modelStorage.bytes)}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {fluidLoaded ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={unloadModelFromMemory}
                    >
                      Unload from memory
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={setupModel}
                      disabled={settingUpModel}
                    >
                      {modelOperation === "load" ? "Loading…" : "Load into memory"}
                    </Button>
                  )}
                  {modelOperation === "load" && settingUpModel && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={cancelModelSetup}
                      disabled={cancellingModel}
                    >
                      {cancellingModel ? "Canceling…" : "Cancel"}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={deleteModel}
                    disabled={deletingModel || settingUpModel}
                  >
                    <HugeiconsIcon icon={DeleteIcon} strokeWidth={2} data-icon="inline-start" />
                    {deletingModel ? "Deleting…" : "Delete model"}
                  </Button>
                </div>
              </div>
              {modelOperation === "load" && showingDownloadProgress && (
                <div className="h-2 overflow-hidden rounded-full bg-background ring-1 ring-border/70">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-300"
                    style={{ width: `${modelProgress?.percent ?? 0}%` }}
                  />
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Keep the download on disk for faster startup later. Loading puts the model in memory; unloading frees memory without deleting the downloaded files.
              </p>
              {setupError && (
                <p className="text-xs text-destructive">{setupError}</p>
              )}
            </div>
          )}

          {shouldShowDownloadCard && (
            <div className="flex flex-col gap-3 rounded-2xl bg-muted p-4 ring-1 ring-border/70">
              <div className="flex items-center justify-between gap-3">
                <div className="flex flex-col gap-0.5">
                  <span className="truncate text-sm font-medium">
                    {showingDownloadProgress
                      ? `${activeOperationLabel} ${activeDownloadModelInfo.name}`
                      : `Download ${selectedModel.name}`}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {modelProgress
                      ? `${formatProgressPhase(modelProgress.phase)} · ${modelProgress.percent}%`
                      : "Downloads the model to disk and keeps it for future use"}
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={downloadModel}
                  disabled={settingUpModel}
                >
                  <HugeiconsIcon icon={Download01Icon} strokeWidth={2} data-icon="inline-start" />
                  {modelOperation === "download" ? "Downloading…" : "Download model"}
                </Button>
                {modelOperation === "download" && settingUpModel && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={cancelModelSetup}
                    disabled={cancellingModel}
                  >
                    {cancellingModel ? "Canceling…" : "Cancel"}
                  </Button>
                )}
              </div>
              {modelOperation === "download" && showingDownloadProgress && (
                <div className="h-2 overflow-hidden rounded-full bg-background ring-1 ring-border/70">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-300"
                    style={{ width: `${modelProgress?.percent ?? 0}%` }}
                  />
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Downloading does not keep the model loaded in memory. After it finishes, you can load it when you need local transcription or leave it stored on disk.
              </p>
              {setupError && (
                <p className="text-xs text-destructive">{setupError}</p>
              )}
            </div>
          )}

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

      <Card size="sm" className={cn(activeSection !== "dictionary" && "hidden")}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <HugeiconsIcon icon={Book02Icon} strokeWidth={2} className="size-5" />
            Dictionary
            {dictionary.length > 0 && (
              <Badge variant="secondary" className="ml-auto">{dictionary.length} term{dictionary.length !== 1 ? "s" : ""}</Badge>
            )}
          </CardTitle>
          <CardDescription>
            Names and jargon the transcriber should always get right — teach it once and it never misspells them again
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {sortedDictionary.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border/70 px-4 py-8 text-center">
              <div className="inline-flex size-10 items-center justify-center rounded-2xl bg-muted">
                <HugeiconsIcon icon={Book02Icon} strokeWidth={2} className="size-5 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium">No terms yet</p>
              <p className="max-w-sm text-xs text-muted-foreground">
                Add names of people, products, or jargon — e.g.{" "}
                <span className="font-medium text-foreground">Siddharth</span> with mis-hearings{" "}
                <span className="font-mono text-foreground">sidharth, siddart</span> — and every
                transcript spells them right.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {sortedDictionary.map((e) => (
                <div
                  key={e.id}
                  className="group flex items-center gap-3 rounded-xl border border-border/60 px-3 py-2.5 transition-colors hover:bg-muted/40"
                >
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-sm font-medium">{e.term}</span>
                    {e.aliases.length > 0 && (
                      <>
                        <HugeiconsIcon
                          icon={ArrowLeft01Icon}
                          strokeWidth={2}
                          className="size-3.5 shrink-0 text-muted-foreground/60"
                        />
                        <span className="flex flex-wrap gap-1">
                          {e.aliases.map((alias) => (
                            <Badge key={alias} variant="secondary" className="font-mono text-[11px] font-normal">
                              {alias}
                            </Badge>
                          ))}
                        </span>
                      </>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 hover:text-destructive focus-visible:opacity-100"
                    onClick={() => removeDictionaryEntry(e.id)}
                    aria-label={`Remove ${e.term}`}
                  >
                    <HugeiconsIcon icon={DeleteIcon} strokeWidth={2} />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-2 rounded-2xl bg-muted/50 p-3 ring-1 ring-border/60">
            <div className="flex flex-col gap-1.5 sm:flex-row">
              <Input
                value={newTerm}
                onChange={(e) => setNewTerm(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") addDictionaryEntry() }}
                placeholder="Correct spelling (e.g. Siddharth)"
                aria-label="Correct spelling"
                className="flex-1 bg-background"
              />
              <Input
                value={newAliases}
                onChange={(e) => setNewAliases(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") addDictionaryEntry() }}
                placeholder="Mis-hearings, comma-separated (optional)"
                aria-label="Mis-hearings"
                className="flex-1 bg-background"
              />
              <Button size="sm" onClick={addDictionaryEntry} disabled={!newTerm.trim()} className="shrink-0 self-start sm:self-auto">
                <HugeiconsIcon icon={Add01Icon} strokeWidth={2} data-icon="inline-start" />
                Add
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Re-adding an existing term updates its corrections.
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            Applied when a recording stops and included in AI prompts, so transcripts, titles, notes, and knowledge all use the right spellings.
          </p>
        </CardContent>
      </Card>

      <Card size="sm" className={cn(activeSection !== "ai" && "hidden")}>
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
            <div className="flex flex-col gap-0.5">
              <span className="text-sm">Selection AI Popup</span>
              <span className="text-xs text-muted-foreground">Show AI actions when you select text in the editor</span>
            </div>
            <button
              role="switch"
              aria-checked={settings.aiSelectionPopup}
              onClick={() => update({ aiSelectionPopup: !settings.aiSelectionPopup })}
              className={`relative inline-flex h-6 w-10 shrink-0 items-center rounded-2xl ring-1 ring-border/70 transition-colors ${
                settings.aiSelectionPopup ? "bg-primary" : "bg-muted"
              }`}
            >
              <span
                className={`inline-block size-4 rounded-[calc(var(--radius)+2px)] bg-background shadow-sm transition-transform ${
                  settings.aiSelectionPopup ? "translate-x-5" : "translate-x-1"
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

      <Card size="sm" className={cn(activeSection !== "style" && "hidden")}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <HugeiconsIcon icon={PenToolIcon} strokeWidth={2} className="size-5" />
            Writing Style
          </CardTitle>
          <CardDescription>
            Give your notes a persona — the same meeting can read formal, casual, or crisp. Templates can override this.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="grid gap-2 sm:grid-cols-2">
            {Object.entries(WRITING_STYLES).map(([id, s]) => {
              const selected = settings.writingStyle === id
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => update({ writingStyle: id as AppSettings["writingStyle"] })}
                  className={cn(
                    "flex flex-col gap-0.5 rounded-lg border p-3 text-left transition-colors",
                    selected ? "border-primary bg-primary/5" : "border-border bg-background hover:bg-muted/50"
                  )}
                  aria-pressed={selected}
                >
                  <span className="text-sm font-medium">{s.label}</span>
                  <span className="text-xs text-muted-foreground">{s.hint}</span>
                </button>
              )
            })}
            <button
              type="button"
              onClick={() => update({ writingStyle: "custom" })}
              className={cn(
                "flex flex-col gap-0.5 rounded-lg border p-3 text-left transition-colors sm:col-span-2",
                settings.writingStyle === "custom" ? "border-primary bg-primary/5" : "border-border bg-background hover:bg-muted/50"
              )}
              aria-pressed={settings.writingStyle === "custom"}
            >
              <span className="text-sm font-medium">Custom</span>
              <span className="text-xs text-muted-foreground">Describe your own persona in a sentence or two</span>
            </button>
          </div>
          {settings.writingStyle === "custom" && (
            <Textarea
              value={settings.customStylePrompt}
              onChange={(e) => update({ customStylePrompt: e.target.value })}
              placeholder={'e.g. "Write like a staff engineer\'s status update — direct, dry, no fluff"'}
              rows={3}
              className="resize-none text-sm"
            />
          )}
          <p className="text-xs text-muted-foreground">
            Applied when AI generates or enhances notes. Set a per-template override in the template editor below.
          </p>
        </CardContent>
      </Card>

      <Card size="sm" className={cn(activeSection !== "snippets" && "hidden")}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <HugeiconsIcon icon={KeyboardIcon} strokeWidth={2} className="size-5" />
            Shortcuts
            {snippets.length > 0 && (
              <Badge variant="secondary" className="ml-auto">{snippets.length} snippet{snippets.length !== 1 ? "s" : ""}</Badge>
            )}
          </CardTitle>
          <CardDescription>
            Quick text expansion — type <span className="font-mono text-foreground">;trigger</span> then a space in the editor, and the whole formatted thing appears
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {sortedSnippets.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border/70 px-4 py-8 text-center">
              <div className="inline-flex size-10 items-center justify-center rounded-2xl bg-muted">
                <HugeiconsIcon icon={KeyboardIcon} strokeWidth={2} className="size-5 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium">No shortcuts yet</p>
              <p className="max-w-sm text-xs text-muted-foreground">
                Type <span className="font-mono text-foreground">;sig</span> then a space in any note and
                it expands into your full signature — markdown and{" "}
                <span className="font-mono text-foreground">{"{{date}}"}</span> variables included.
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2.5 rounded-xl bg-muted/50 px-3 py-2 text-xs ring-1 ring-border/60">
                <Badge variant="outline" className="shrink-0 font-mono">;sig</Badge>
                <span className="shrink-0 text-muted-foreground">+ space</span>
                <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} className="size-3.5 shrink-0 text-muted-foreground/60" />
                <span className="truncate text-muted-foreground">
                  Best, Criston — <span className="font-mono text-[11px]">{"{{date}}"}</span>
                </span>
              </div>
              <div className="flex flex-col gap-1.5">
                {sortedSnippets.map((s) => (
                  <div
                    key={s.id}
                    className="group flex items-start gap-3 rounded-xl border border-border/60 px-3 py-2.5 transition-colors hover:bg-muted/40"
                  >
                    <Badge variant="outline" className="mt-0.5 shrink-0 font-mono">;{s.trigger}</Badge>
                    <p className="min-w-0 flex-1 whitespace-pre-line text-xs leading-relaxed text-muted-foreground line-clamp-2">
                      {renderExpansionPreview(s.expansion)}
                    </p>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="-mt-0.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 hover:text-destructive focus-visible:opacity-100"
                      onClick={() => removeSnippet(s.id)}
                      aria-label={`Remove ;${s.trigger}`}
                    >
                      <HugeiconsIcon icon={DeleteIcon} strokeWidth={2} />
                    </Button>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="flex flex-col gap-2 rounded-2xl bg-muted/50 p-3 ring-1 ring-border/60">
            <div className="flex items-center rounded-2xl border border-transparent bg-background transition-[color,box-shadow] duration-200 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30 has-[aria-invalid=true]:border-destructive has-[aria-invalid=true]:ring-3 has-[aria-invalid=true]:ring-destructive/20">
              <span className="pr-1 pl-2.5 font-mono text-sm text-muted-foreground select-none">;</span>
              <Input
                value={newTrigger}
                onChange={(e) => setNewTrigger(e.target.value.replace(/^;+/, ""))}
                placeholder="trigger (no spaces, e.g. sig)"
                aria-label="Snippet trigger"
                aria-invalid={triggerHasSpace}
                className="min-w-0 flex-1 rounded-none border-0 bg-transparent px-1 focus-visible:border-transparent focus-visible:ring-0 aria-invalid:border-transparent aria-invalid:ring-0"
              />
            </div>
            {triggerHasSpace && (
              <p className="text-[11px] text-destructive">Triggers can&apos;t contain spaces.</p>
            )}
            <Textarea
              ref={expansionRef}
              value={newExpansion}
              onChange={(e) => setNewExpansion(e.target.value)}
              placeholder={"What it expands to — markdown works.\n\ne.g. Best,\nCriston\n{{date}}"}
              rows={3}
              aria-label="Snippet expansion"
              className="resize-none bg-background text-sm"
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) addSnippet() }}
            />
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-muted-foreground">Insert:</span>
              {["date", "time", "datetime"].map((variable) => (
                <button
                  key={variable}
                  type="button"
                  onClick={() => insertVariable(variable)}
                  className="rounded-md bg-background px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground ring-1 ring-border/60 transition-colors hover:text-foreground hover:ring-border"
                >
                  {`{{${variable}}}`}
                </button>
              ))}
            </div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] text-muted-foreground">
                ⌘↵ to add · re-adding a trigger updates it
              </p>
              <Button size="sm" onClick={addSnippet} disabled={!newTrigger.trim() || !newExpansion.trim() || triggerHasSpace} className="shrink-0">
                <HugeiconsIcon icon={Add01Icon} strokeWidth={2} data-icon="inline-start" />
                Add shortcut
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card size="sm" className={cn(activeSection !== "meeting" && "hidden")}>
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

      <Card size="sm" className={cn(activeSection !== "templates" && "hidden")}>
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

      <Card size="sm" className={cn(activeSection !== "appearance" && "hidden")}>
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

      <Card size="sm" className={cn("border-destructive/30", activeSection !== "data" && "hidden")}>
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
      </div>
    </div>
  )
}
