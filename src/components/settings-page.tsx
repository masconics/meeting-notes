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
  loadRecipes,
  saveRecipes,
  upsertRecipe,
  deleteRecipe,
  loadSlackWebhookUrl,
  saveSlackWebhookUrl,
} from "@/lib/storage"
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { testConnection } from "@/lib/ai-service"
import { exportAllMeetings, exportAllMeetingsMarkdown } from "@/lib/export"
import type { AppSettings, AISettings, DictionaryEntry, Snippet, Recipe } from "@/types"
import { SPEECH_LANGS, AI_MODELS, TRANSCRIPTION_MODELS, WRITING_STYLES, BUILTIN_RECIPES } from "@/types"
import { Textarea } from "@/components/ui/textarea"
import { TemplateEditor } from "@/components/template-editor"
import { Waveform } from "@/components/Waveform"
import { cn } from "@/lib/utils"
import { APP_NAME, APP_VERSION, APP_TAGLINE, APP_PRIVACY } from "@/lib/app-meta"
import { MynaAppIcon } from "@/components/myna-logo"

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
  | "recipes"
  | "share"
  | "appearance"
  | "data"
  | "about"

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
      { id: "recipes", label: "Recipes", icon: AiMagicIcon },
      { id: "share", label: "Share", icon: FolderOpenIcon },
    ],
  },
  {
    label: "App",
    items: [
      { id: "appearance", label: "Appearance", icon: SunIcon },
      { id: "data", label: "Data", icon: FolderOpenIcon },
      { id: "about", label: "About", icon: ShieldIcon },
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
  const [editingDictId, setEditingDictId] = useState<string | null>(null)
  const [dictQuery, setDictQuery] = useState("")
  const dictTermRef = useRef<HTMLInputElement>(null)
  const [newTrigger, setNewTrigger] = useState("")
  const [newExpansion, setNewExpansion] = useState("")
  const [editingSnippetId, setEditingSnippetId] = useState<string | null>(null)
  const [snippetQuery, setSnippetQuery] = useState("")
  const [activeSection, setActiveSection] = useState<SettingsSection>("audio")
  const expansionRef = useRef<HTMLTextAreaElement>(null)
  const triggerRef = useRef<HTMLInputElement>(null)
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

  const resetDictionaryForm = useCallback(() => {
    setNewTerm("")
    setNewAliases("")
    setEditingDictId(null)
  }, [])

  const addDictionaryEntry = useCallback(() => {
    const term = newTerm.trim()
    if (!term) return
    const aliases = newAliases
      .split(/[,;\n]/)
      .map((a) => a.trim())
      .filter((a) => a && a.toLowerCase() !== term.toLowerCase())
    // Deduplicate aliases case-insensitively while keeping first spelling.
    const seen = new Set<string>()
    const uniqueAliases = aliases.filter((a) => {
      const key = a.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    setDictionary((prev) => {
      const existingById = editingDictId
        ? prev.find((e) => e.id === editingDictId)
        : undefined
      // Prefer the row being edited; otherwise merge into a case-insensitive
      // term match so re-adding "Siddharth" updates instead of duplicating.
      const replaceId =
        existingById?.id ??
        prev.find((e) => e.term.toLowerCase() === term.toLowerCase())?.id
      const entry: DictionaryEntry = {
        id: replaceId ?? crypto.randomUUID(),
        term,
        aliases: uniqueAliases,
      }
      const next = [...prev.filter((e) => e.id !== entry.id), entry]
      saveDictionary(next)
      return next
    })
    resetDictionaryForm()
  }, [newTerm, newAliases, editingDictId, resetDictionaryForm])

  const beginEditDictionaryEntry = useCallback((entry: DictionaryEntry) => {
    setEditingDictId(entry.id)
    setNewTerm(entry.term)
    setNewAliases(entry.aliases.join(", "))
    requestAnimationFrame(() => dictTermRef.current?.focus())
  }, [])

  const removeDictionaryEntry = useCallback((id: string) => {
    setDictionary((prev) => {
      const next = prev.filter((e) => e.id !== id)
      saveDictionary(next)
      return next
    })
    if (editingDictId === id) resetDictionaryForm()
  }, [editingDictId, resetDictionaryForm])

  const resetSnippetForm = useCallback(() => {
    setEditingSnippetId(null)
    setNewTrigger("")
    setNewExpansion("")
  }, [])

  const addSnippet = useCallback(() => {
    const trigger = newTrigger.trim().replace(/^;+/, "")
    const expansion = newExpansion.trim()
    if (!trigger || !expansion || /\s/.test(trigger)) return
    setSnippets((prev) => {
      const existingById = editingSnippetId
        ? prev.find((s) => s.id === editingSnippetId)
        : undefined
      const replaceId =
        existingById?.id ??
        prev.find((s) => s.trigger.toLowerCase() === trigger.toLowerCase())?.id
      const entry: Snippet = {
        id: replaceId ?? crypto.randomUUID(),
        trigger,
        expansion,
      }
      const next = [...prev.filter((s) => s.id !== entry.id), entry]
      saveSnippets(next)
      return next
    })
    resetSnippetForm()
  }, [newTrigger, newExpansion, editingSnippetId, resetSnippetForm])

  const beginEditSnippet = useCallback((snippet: Snippet) => {
    setEditingSnippetId(snippet.id)
    setNewTrigger(snippet.trigger)
    setNewExpansion(snippet.expansion)
    requestAnimationFrame(() => {
      expansionRef.current?.focus()
      const len = snippet.expansion.length
      expansionRef.current?.setSelectionRange(len, len)
    })
  }, [])

  const removeSnippet = useCallback((id: string) => {
    setSnippets((prev) => {
      const next = prev.filter((s) => s.id !== id)
      saveSnippets(next)
      return next
    })
    if (editingSnippetId === id) resetSnippetForm()
  }, [editingSnippetId, resetSnippetForm])

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
  const filteredDictionary = useMemo(() => {
    const q = dictQuery.trim().toLowerCase()
    if (!q) return sortedDictionary
    return sortedDictionary.filter(
      (e) =>
        e.term.toLowerCase().includes(q) ||
        e.aliases.some((a) => a.toLowerCase().includes(q)),
    )
  }, [sortedDictionary, dictQuery])
  const isEditingDictionary = editingDictId !== null
  const sortedSnippets = useMemo(
    () => [...snippets].sort((a, b) => a.trigger.localeCompare(b.trigger)),
    [snippets],
  )
  const filteredSnippets = useMemo(() => {
    const q = snippetQuery.trim().toLowerCase()
    if (!q) return sortedSnippets
    return sortedSnippets.filter(
      (s) =>
        s.trigger.toLowerCase().includes(q) ||
        s.expansion.toLowerCase().includes(q),
    )
  }, [sortedSnippets, snippetQuery])
  const triggerHasSpace = /\s/.test(newTrigger)
  const isEditingSnippet = editingSnippetId !== null
  const canSaveSnippet = Boolean(newTrigger.trim() && newExpansion.trim() && !triggerHasSpace)

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
  const activeDownloadModelInfo =
    TRANSCRIPTION_MODELS[
      (downloadingModel ?? settings.transcriptionModel) as AppSettings["transcriptionModel"]
    ] ?? selectedModel
  const showingDownloadProgress = settingUpModel || Boolean(modelProgress && modelProgress.phase !== "ready")
  const shouldShowDownloadCard = fluidReady && !fluidLoaded && !modelStorage?.present
  const activeOperationLabel = modelOperation === "load" ? "Loading" : "Downloading"

  return (
    <div className="app-page">
      <div className="app-page-header flex items-start justify-between gap-4">
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
                  Myna Notes cannot record audio without microphone permission.
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
                Privacy &amp; Security &rarr; Microphone &rarr; enable Myna Notes
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
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background p-3">
              <div className="min-w-0 flex flex-col gap-1">
                <span className="truncate text-sm font-medium">{selectedModel.name}</span>
                <span className="line-clamp-2 text-xs text-muted-foreground">{selectedModel.description}</span>
              </div>
              <Badge variant="outline" className="shrink-0">{selectedModel.size}</Badge>
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
            Teach correct spellings once — mis-hearings are rewritten in transcripts and AI prompts.
            Names in People, attendees, or speakers are never force-rewritten (so Christy and Christian can both exist).
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 rounded-2xl bg-muted/50 p-3 ring-1 ring-border/60">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium">
                {isEditingDictionary ? "Edit term" : "Add a term"}
              </p>
              {isEditingDictionary && (
                <Button variant="ghost" size="sm" onClick={resetDictionaryForm}>
                  Cancel
                </Button>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="dict-term" className="text-[11px] font-medium text-muted-foreground">
                Correct spelling
              </label>
              <Input
                id="dict-term"
                ref={dictTermRef}
                value={newTerm}
                onChange={(e) => setNewTerm(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    addDictionaryEntry()
                  } else if (e.key === "Escape" && isEditingDictionary) {
                    resetDictionaryForm()
                  }
                }}
                placeholder="e.g. Siddharth"
                aria-label="Correct spelling"
                className="bg-background"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="dict-aliases" className="text-[11px] font-medium text-muted-foreground">
                Mis-hearings <span className="font-normal">(optional, comma-separated)</span>
              </label>
              <Input
                id="dict-aliases"
                value={newAliases}
                onChange={(e) => setNewAliases(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    addDictionaryEntry()
                  } else if (e.key === "Escape" && isEditingDictionary) {
                    resetDictionaryForm()
                  }
                }}
                placeholder="e.g. sidharth, siddart, Sid Hart"
                aria-label="Mis-hearings"
                className="bg-background font-mono text-sm"
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] text-muted-foreground">
                {isEditingDictionary
                  ? "Save replaces this term’s corrections."
                  : "Existing terms with the same spelling are updated."}
              </p>
              <Button size="sm" onClick={addDictionaryEntry} disabled={!newTerm.trim()} className="shrink-0">
                {!isEditingDictionary && (
                  <HugeiconsIcon icon={Add01Icon} strokeWidth={2} data-icon="inline-start" />
                )}
                {isEditingDictionary ? "Save" : "Add"}
              </Button>
            </div>
          </div>

          {sortedDictionary.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border/70 px-4 py-8 text-center">
              <div className="inline-flex size-10 items-center justify-center rounded-2xl bg-muted">
                <HugeiconsIcon icon={Book02Icon} strokeWidth={2} className="size-5 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium">No terms yet</p>
              <p className="max-w-sm text-xs text-muted-foreground">
                Add a name or jargon above. Mis-hearings like{" "}
                <span className="font-mono text-foreground">sidharth</span> will be rewritten to{" "}
                <span className="font-medium text-foreground">Siddharth</span>.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2.5 rounded-xl bg-muted/50 px-3 py-2 text-xs ring-1 ring-border/60">
                <Badge variant="secondary" className="shrink-0 font-mono font-normal">sidharth</Badge>
                <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} className="size-3.5 shrink-0 text-muted-foreground/60" />
                <span className="font-medium text-foreground">Siddharth</span>
                <span className="ml-auto hidden text-muted-foreground sm:inline">in every transcript</span>
              </div>

              {sortedDictionary.length > 6 && (
                <Input
                  value={dictQuery}
                  onChange={(e) => setDictQuery(e.target.value)}
                  placeholder="Search terms or mis-hearings…"
                  aria-label="Search dictionary"
                  className="bg-background"
                />
              )}

              {filteredDictionary.length === 0 ? (
                <p className="px-1 py-4 text-center text-xs text-muted-foreground">
                  No terms match “{dictQuery.trim()}”
                </p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {filteredDictionary.map((e) => {
                    const editing = editingDictId === e.id
                    return (
                      <div
                        key={e.id}
                        className={cn(
                          "group flex items-start gap-3 rounded-xl border px-3 py-2.5 transition-colors",
                          editing
                            ? "border-primary bg-primary/5"
                            : "border-border/60 hover:bg-muted/40",
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => beginEditDictionaryEntry(e)}
                          className="min-w-0 flex-1 text-left"
                          aria-label={`Edit ${e.term}`}
                        >
                          <div className="flex min-w-0 flex-col gap-1.5">
                            <span className="truncate text-sm font-medium">{e.term}</span>
                            {e.aliases.length > 0 ? (
                              <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                                <span className="text-[11px] text-muted-foreground">Also matches</span>
                                {e.aliases.map((alias) => (
                                  <Badge
                                    key={alias}
                                    variant="secondary"
                                    className="font-mono text-[11px] font-normal"
                                  >
                                    {alias}
                                  </Badge>
                                ))}
                              </span>
                            ) : (
                              <span className="text-[11px] text-muted-foreground">
                                No mis-hearings — still guides AI spelling
                              </span>
                            )}
                          </div>
                        </button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="shrink-0 text-muted-foreground hover:text-destructive"
                          onClick={() => removeDictionaryEntry(e.id)}
                          aria-label={`Remove ${e.term}`}
                        >
                          <HugeiconsIcon icon={DeleteIcon} strokeWidth={2} />
                        </Button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Applied when a recording stops, and included in AI prompts for titles, notes, and knowledge.
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
            <div className="flex flex-col gap-0.5">
              <span className="text-sm">Auto-enhance on stop</span>
              <span className="text-xs text-muted-foreground">Run Enhance + run-on-stop recipes when recording ends</span>
            </div>
            <button
              role="switch"
              aria-checked={settings.autoEnhanceOnStop}
              onClick={() => update({ autoEnhanceOnStop: !settings.autoEnhanceOnStop })}
              className={`relative inline-flex h-6 w-10 shrink-0 items-center rounded-2xl ring-1 ring-border/70 transition-colors ${
                settings.autoEnhanceOnStop ? "bg-primary" : "bg-muted"
              }`}
            >
              <span
                className={`inline-block size-4 rounded-[calc(var(--radius)+2px)] bg-background shadow-sm transition-transform ${
                  settings.autoEnhanceOnStop ? "translate-x-5" : "translate-x-1"
                }`}
              />
            </button>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm">Auto-tag on enhance</span>
              <span className="text-xs text-muted-foreground">
                AI adds concept tags from notes (reuses existing tags when possible)
              </span>
            </div>
            <button
              role="switch"
              aria-checked={settings.autoTagOnEnhance !== false}
              onClick={() => update({ autoTagOnEnhance: !(settings.autoTagOnEnhance !== false) })}
              className={`relative inline-flex h-6 w-10 shrink-0 items-center rounded-2xl ring-1 ring-border/70 transition-colors ${
                settings.autoTagOnEnhance !== false ? "bg-primary" : "bg-muted"
              }`}
            >
              <span
                className={`inline-block size-4 rounded-[calc(var(--radius)+2px)] bg-background shadow-sm transition-transform ${
                  settings.autoTagOnEnhance !== false ? "translate-x-5" : "translate-x-1"
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
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-[15px] font-medium tracking-tight">
            <HugeiconsIcon icon={KeyboardIcon} strokeWidth={2} className="size-4 text-muted-foreground" />
            Text shortcuts
            {snippets.length > 0 && (
              <Badge variant="secondary" className="ml-auto tabular-nums">
                {snippets.length}
              </Badge>
            )}
          </CardTitle>
          <CardDescription className="text-[13px]">
            Type{" "}
            <kbd className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground ring-1 ring-border/60">
              ;trigger
            </kbd>{" "}
            then space in a note to expand.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {/* How it works — one quiet strip, not a wall of helper text */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-2xl bg-muted/40 px-3 py-2 text-[12px] text-muted-foreground">
            <kbd className="rounded-md bg-background px-1.5 py-0.5 font-mono text-[11px] text-foreground ring-1 ring-border/60">
              ;sig
            </kbd>
            <span>+</span>
            <kbd className="rounded-md bg-background px-1.5 py-0.5 font-mono text-[11px] text-foreground ring-1 ring-border/60">
              space
            </kbd>
            <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} className="size-3 text-muted-foreground/50" />
            <span className="min-w-0 truncate">
              Signature with <span className="font-mono text-[11px] text-foreground/80">{"{{date}}"}</span>
            </span>
          </div>

          {sortedSnippets.length > 4 && (
            <Input
              value={snippetQuery}
              onChange={(e) => setSnippetQuery(e.target.value)}
              placeholder="Filter shortcuts…"
              aria-label="Filter shortcuts"
              className="h-8 text-[13px]"
            />
          )}

          {sortedSnippets.length === 0 ? (
            <div className="rounded-2xl bg-muted/30 px-4 py-6 text-center">
              <p className="text-[13px] font-medium">No shortcuts yet</p>
              <p className="mt-1 text-[12px] text-muted-foreground">
                Create one below — e.g. <span className="font-mono text-foreground/80">;sig</span> for your sign-off.
              </p>
            </div>
          ) : filteredSnippets.length === 0 ? (
            <p className="py-4 text-center text-[13px] text-muted-foreground">No matches for “{snippetQuery.trim()}”</p>
          ) : (
            <ul className="flex flex-col gap-0.5" role="list" aria-label="Text shortcuts">
              {filteredSnippets.map((s) => {
                const active = editingSnippetId === s.id
                return (
                  <li key={s.id}>
                    <div
                      className={cn(
                        "group flex h-auto min-h-11 items-start gap-2.5 rounded-xl px-2.5 py-2 transition-colors",
                        active ? "bg-muted ring-1 ring-border/70" : "hover:bg-muted/50",
                      )}
                    >
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-start gap-2.5 text-left"
                        onClick={() => beginEditSnippet(s)}
                        aria-label={`Edit ;${s.trigger}`}
                      >
                        <span className="mt-0.5 shrink-0 rounded-md bg-background px-1.5 py-0.5 font-mono text-[11px] font-medium text-foreground ring-1 ring-border/60">
                          ;{s.trigger}
                        </span>
                        <span className="min-w-0 flex-1 whitespace-pre-line text-[12px] leading-relaxed text-muted-foreground line-clamp-2">
                          {renderExpansionPreview(s.expansion)}
                        </span>
                      </button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="mt-0.5 size-7 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 hover:text-destructive focus-visible:opacity-100"
                        onClick={() => removeSnippet(s.id)}
                        aria-label={`Delete ;${s.trigger}`}
                      >
                        <HugeiconsIcon icon={DeleteIcon} strokeWidth={2} className="size-3.5" />
                      </Button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}

          {/* Composer — production editor block */}
          <div
            className={cn(
              "flex flex-col gap-2.5 rounded-2xl p-3 ring-1 transition-[box-shadow,background-color]",
              isEditingSnippet
                ? "bg-card ring-foreground/10 shadow-sm"
                : "bg-muted/40 ring-border/60",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-medium uppercase tracking-[0.05em] text-muted-foreground">
                {isEditingSnippet ? "Edit shortcut" : "New shortcut"}
              </p>
              {isEditingSnippet && (
                <button
                  type="button"
                  onClick={resetSnippetForm}
                  className="text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                >
                  Cancel
                </button>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="snippet-trigger" className="text-[12px] font-medium text-foreground/90">
                Trigger
              </label>
              <div
                className={cn(
                  "flex h-9 items-center rounded-xl bg-background ring-1 transition-[box-shadow,color]",
                  triggerHasSpace
                    ? "ring-destructive/40 focus-within:ring-3 focus-within:ring-destructive/25"
                    : "ring-border/70 focus-within:ring-3 focus-within:ring-ring/30",
                )}
              >
                <span className="select-none pl-2.5 pr-0.5 font-mono text-[13px] text-muted-foreground">;</span>
                <Input
                  ref={triggerRef}
                  id="snippet-trigger"
                  value={newTrigger}
                  onChange={(e) => setNewTrigger(e.target.value.replace(/^;+/, "").replace(/\s/g, ""))}
                  placeholder="sig"
                  aria-label="Shortcut trigger"
                  aria-invalid={triggerHasSpace}
                  className="h-full min-w-0 flex-1 rounded-none border-0 bg-transparent px-1 font-mono text-[13px] shadow-none focus-visible:border-transparent focus-visible:ring-0"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      expansionRef.current?.focus()
                    }
                  }}
                />
              </div>
              {triggerHasSpace && (
                <p className="text-[11px] text-destructive">No spaces in triggers.</p>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="snippet-expansion" className="text-[12px] font-medium text-foreground/90">
                  Expands to
                </label>
                <div className="flex items-center gap-1">
                  {["date", "time", "datetime"].map((variable) => (
                    <button
                      key={variable}
                      type="button"
                      onClick={() => insertVariable(variable)}
                      className="rounded-md px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground ring-1 ring-border/60 transition-colors hover:bg-background hover:text-foreground"
                      title={`Insert {{${variable}}}`}
                    >
                      {`{{${variable}}}`}
                    </button>
                  ))}
                </div>
              </div>
              <Textarea
                ref={expansionRef}
                id="snippet-expansion"
                value={newExpansion}
                onChange={(e) => setNewExpansion(e.target.value)}
                placeholder={"Best,\nCriston\n{{date}}"}
                rows={4}
                aria-label="Shortcut expansion"
                className="min-h-[5.5rem] resize-y bg-background px-3 py-2.5 text-[13px] leading-relaxed ring-1 ring-border/70 focus-visible:ring-ring/30"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    addSnippet()
                  }
                  if (e.key === "Escape" && isEditingSnippet) {
                    e.preventDefault()
                    resetSnippetForm()
                  }
                }}
              />
              <p className="text-[11px] text-muted-foreground">
                Markdown allowed · variables insert at the caret
              </p>
            </div>

            {newExpansion.trim() && (
              <div className="rounded-xl bg-muted/50 px-3 py-2 ring-1 ring-border/50">
                <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Preview
                </p>
                <p className="whitespace-pre-line text-[12px] leading-relaxed text-foreground/85">
                  {renderExpansionPreview(newExpansion)}
                </p>
              </div>
            )}

            <div className="flex items-center justify-between gap-2 pt-0.5">
              <p className="text-[11px] text-muted-foreground">
                <kbd className="rounded bg-muted px-1 font-mono text-[10px] ring-1 ring-border/50">⌘</kbd>
                <kbd className="ml-0.5 rounded bg-muted px-1 font-mono text-[10px] ring-1 ring-border/50">↵</kbd>
                {" "}
                {isEditingSnippet ? "to save" : "to add"}
              </p>
              <Button
                size="sm"
                onClick={addSnippet}
                disabled={!canSaveSnippet}
                className="h-8 shrink-0 rounded-xl px-3 active:scale-[0.96]"
              >
                {!isEditingSnippet && (
                  <HugeiconsIcon icon={Add01Icon} strokeWidth={2} data-icon="inline-start" className="size-3.5" />
                )}
                {isEditingSnippet ? "Save changes" : "Add shortcut"}
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
          <CardDescription>Defaults for new meetings and calendar prep</CardDescription>
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
          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm">macOS Calendar</span>
              <span className="text-xs text-muted-foreground">
                Show upcoming meetings from Apple Calendar (EventKit)
              </span>
            </div>
            <button
              role="switch"
              aria-checked={settings.calendarEnabled}
              onClick={() => update({ calendarEnabled: !settings.calendarEnabled })}
              className={`relative inline-flex h-6 w-10 shrink-0 items-center rounded-2xl ring-1 ring-border/70 transition-colors ${
                settings.calendarEnabled ? "bg-primary" : "bg-muted"
              }`}
            >
              <span
                className={`inline-block size-4 rounded-[calc(var(--radius)+2px)] bg-background shadow-sm transition-transform ${
                  settings.calendarEnabled ? "translate-x-5" : "translate-x-1"
                }`}
              />
            </button>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm">MCP snapshot</span>
              <span className="text-xs text-muted-foreground">Write meetings-mcp-snapshot.json for Cursor/Claude</span>
            </div>
            <button
              role="switch"
              aria-checked={settings.mcpEnabled}
              onClick={() => update({ mcpEnabled: !settings.mcpEnabled })}
              className={`relative inline-flex h-6 w-10 shrink-0 items-center rounded-2xl ring-1 ring-border/70 transition-colors ${
                settings.mcpEnabled ? "bg-primary" : "bg-muted"
              }`}
            >
              <span
                className={`inline-block size-4 rounded-[calc(var(--radius)+2px)] bg-background shadow-sm transition-transform ${
                  settings.mcpEnabled ? "translate-x-5" : "translate-x-1"
                }`}
              />
            </button>
          </div>
        </CardContent>
      </Card>

      <RecipesSettingsCard active={activeSection === "recipes"} />
      <ShareSettingsCard
        active={activeSection === "share"}
        settings={settings}
        update={update}
      />

      <Card size="sm" className={cn(activeSection !== "templates" && "hidden")}>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-[15px] font-medium tracking-tight">
            <HugeiconsIcon icon={CheckmarkBadge01Icon} strokeWidth={2} className="size-4 text-muted-foreground" />
            Templates
          </CardTitle>
          <CardDescription className="text-[13px]">
            Sections structure enhance. Optional quick actions for follow-ups.
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
            {meetingCount} note{meetingCount !== 1 ? "s" : ""} saved on this Mac (local storage)
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-xs text-pretty text-muted-foreground">
            Your notes never leave this computer unless you export them or send text to AI with your own API key.
            Export regularly if this Mac is your only copy.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={meetingCount === 0}
              onClick={() => exportAllMeetings()}
            >
              <HugeiconsIcon icon={Download01Icon} strokeWidth={2} data-icon="inline-start" />
              Export all (JSON)
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={meetingCount === 0}
              onClick={() => exportAllMeetingsMarkdown()}
            >
              <HugeiconsIcon icon={Download01Icon} strokeWidth={2} data-icon="inline-start" />
              Export all (Markdown)
            </Button>
          </div>
          <AlertDialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm" disabled={meetingCount === 0}>
                <HugeiconsIcon icon={DeleteIcon} strokeWidth={2} data-icon="inline-start" />
                Clear all notes
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent size="sm">
              <AlertDialogHeader>
                <AlertDialogTitle>Clear all notes?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete all {meetingCount} note{meetingCount !== 1 ? "s" : ""},
                  including transcripts and tags. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={handleClearData}>
                  Delete all
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>

      <Card size="sm" className={cn(activeSection !== "about" && "hidden")}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <HugeiconsIcon icon={ShieldIcon} strokeWidth={2} className="size-5" />
            About
          </CardTitle>
          <CardDescription>{APP_TAGLINE}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <MynaAppIcon className="size-14 shrink-0 shadow-sm ring-1 ring-foreground/10" />
            <div className="min-w-0">
              <p className="text-base font-medium tracking-tight">{APP_NAME}</p>
              <p className="text-sm text-muted-foreground">Version {APP_VERSION}</p>
            </div>
          </div>
          <p className="text-sm text-pretty text-muted-foreground">{APP_PRIVACY}</p>
          <ul className="flex flex-col gap-1.5 text-xs text-muted-foreground">
            <li>· On-device speech recognition (Parakeet / Apple Neural Engine)</li>
            <li>· Optional cloud AI only when you set an API key</li>
            <li>· Concept tags, Actions, and People stay on this Mac</li>
          </ul>
        </CardContent>
      </Card>
        </div>
      </div>
    </div>
  )
}

function SettingsSwitch({
  checked,
  onCheckedChange,
  label,
}: {
  checked: boolean
  onCheckedChange: (next: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-10 shrink-0 items-center rounded-2xl ring-1 ring-border/70 transition-colors",
        checked ? "bg-primary" : "bg-muted",
      )}
    >
      <span
        className={cn(
          "inline-block size-4 rounded-[calc(var(--radius)+2px)] bg-background shadow-sm transition-transform",
          checked ? "translate-x-5" : "translate-x-1",
        )}
      />
    </button>
  )
}

function RecipesSettingsCard({ active }: { active: boolean }) {
  const [recipes, setRecipes] = useState<Recipe[]>(() => loadRecipes())
  const [name, setName] = useState("")
  const [prompt, setPrompt] = useState("")
  const [runOnStop, setRunOnStop] = useState(false)

  const refresh = () => setRecipes(loadRecipes())

  return (
    <Card size="sm" className={cn(active ? undefined : "hidden")}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <HugeiconsIcon icon={AiMagicIcon} strokeWidth={2} className="size-5" />
          Recipes
          {recipes.length > 0 && (
            <Badge variant="secondary" className="ml-auto">
              {recipes.length}
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          Post-meeting prompts. Enable “Run on stop” to execute automatically after Enhance.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {recipes.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border/70 px-4 py-8 text-center">
            <div className="inline-flex size-10 items-center justify-center rounded-2xl bg-muted">
              <HugeiconsIcon icon={AiMagicIcon} strokeWidth={2} className="size-5 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium">No recipes yet</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              Add a prompt below, or restore the built-in follow-up, action digest, and standup recipes.
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                saveRecipes(BUILTIN_RECIPES)
                refresh()
              }}
            >
              Restore built-ins
            </Button>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {recipes.map((r) => (
              <li
                key={r.id}
                className="rounded-2xl bg-muted/30 px-3 py-2.5 ring-1 ring-border/60"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="text-sm font-medium">{r.name}</p>
                      {r.builtin && (
                        <Badge variant="outline" className="h-5 text-[10px]">
                          Built-in
                        </Badge>
                      )}
                      {r.runOnStop && (
                        <Badge variant="secondary" className="h-5 text-[10px]">
                          On stop
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-pretty text-muted-foreground">
                      {r.prompt}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <SettingsSwitch
                      checked={Boolean(r.runOnStop)}
                      onCheckedChange={(next) => {
                        upsertRecipe({ ...r, runOnStop: next })
                        refresh()
                      }}
                      label={`${r.runOnStop ? "Disable" : "Enable"} run on stop for ${r.name}`}
                    />
                    {!r.builtin && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Delete recipe ${r.name}`}
                        onClick={() => {
                          deleteRecipe(r.id)
                          refresh()
                        }}
                      >
                        <HugeiconsIcon icon={DeleteIcon} strokeWidth={2} className="size-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-col gap-2.5 rounded-2xl border border-dashed border-border/70 bg-muted/20 p-3">
          <p className="text-xs font-medium text-muted-foreground">New recipe</p>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Recipe name"
            className="h-8"
            aria-label="Recipe name"
          />
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Prompt instructions…"
            rows={3}
            className="resize-none text-sm"
            aria-label="Recipe prompt"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <SettingsSwitch
                checked={runOnStop}
                onCheckedChange={setRunOnStop}
                label="Run new recipe on stop"
              />
              <span className="text-xs text-muted-foreground">Run on stop</span>
            </div>
            <Button
              size="sm"
              disabled={!name.trim() || !prompt.trim()}
              onClick={() => {
                upsertRecipe({
                  id: crypto.randomUUID(),
                  name: name.trim(),
                  prompt: prompt.trim(),
                  runOnStop,
                })
                setName("")
                setPrompt("")
                setRunOnStop(false)
                refresh()
              }}
            >
              <HugeiconsIcon icon={Add01Icon} strokeWidth={2} data-icon="inline-start" />
              Add recipe
            </Button>
          </div>
        </div>

        {recipes.some((r) => r.builtin) && (
          <Button
            variant="ghost"
            size="sm"
            className="self-start text-xs text-muted-foreground"
            onClick={() => {
              saveRecipes(BUILTIN_RECIPES)
              refresh()
            }}
          >
            Reset built-ins
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

function ShareSettingsCard({
  active,
  settings,
  update,
}: {
  active: boolean
  settings: AppSettings
  update: (patch: Partial<AppSettings>) => void
}) {
  const [webhook, setWebhook] = useState(settings.slackWebhookUrl || "")
  const [snapshotPath, setSnapshotPath] = useState("")

  useEffect(() => {
    loadSlackWebhookUrl()
      .then((u) => {
        if (u) setWebhook(u)
      })
      .catch(() => {})
    invoke<string>("mcp_snapshot_path")
      .then(setSnapshotPath)
      .catch(() => {})
  }, [])

  return (
    <Card size="sm" className={cn(active ? undefined : "hidden")}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <HugeiconsIcon icon={FolderOpenIcon} strokeWidth={2} className="size-5" />
          Share
        </CardTitle>
        <CardDescription>
          Default export folder and optional Slack Incoming Webhook for one-click sharing from a note.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="export-folder-path" className="text-xs font-medium">
            Export folder
          </label>
          <div className="flex gap-2">
            <Input
              id="export-folder-path"
              value={settings.exportFolderPath}
              onChange={(e) => update({ exportFolderPath: e.target.value })}
              placeholder="/Users/you/Documents/Myna Notes"
              className="font-mono text-xs"
            />
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={async () => {
                try {
                  const { open } = await import("@tauri-apps/plugin-dialog")
                  const dir = await open({ directory: true, multiple: false })
                  if (typeof dir === "string") update({ exportFolderPath: dir })
                } catch {
                  /* ignore */
                }
              }}
            >
              Choose…
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Used by Share → Export to folder in the note menu.
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="slack-webhook" className="text-xs font-medium">
            Slack webhook URL
          </label>
          <Input
            id="slack-webhook"
            type="password"
            autoComplete="off"
            value={webhook}
            onChange={(e) => setWebhook(e.target.value)}
            onBlur={() => {
              update({ slackWebhookUrl: webhook })
              void saveSlackWebhookUrl(webhook)
            }}
            placeholder="https://hooks.slack.com/services/…"
            className="font-mono text-xs"
          />
          <p className="text-xs text-muted-foreground">
            Stored securely. Used by Share → Slack in the note menu.
          </p>
        </div>
        {snapshotPath && (
          <div className="rounded-2xl bg-muted/30 px-3 py-2.5 ring-1 ring-border/60">
            <p className="text-xs font-medium">MCP snapshot</p>
            <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
              {snapshotPath}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
