import { useState, useEffect, useCallback, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { stepSlideVariants, transitions } from "@/lib/motion"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Mic01Icon,
  AiVoiceIcon,
  AiMagicIcon,
  CheckmarkBadge01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  ShieldIcon,
  Cancel01Icon,
  RefreshIcon,
} from "@hugeicons/core-free-icons"
import { MynaAppIcon } from "@/components/myna-logo"
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import {
  loadAISettings,
  loadApiKey,
  saveAISettings,
  saveApiKey,
} from "@/lib/storage"
import { markOnboardingComplete } from "@/lib/onboarding"
import { testConnection } from "@/lib/ai-service"
import type { AISettings } from "@/types"
import { AI_MODELS } from "@/types"

const TOTAL_STEPS = 5

interface OnboardingWizardProps {
  open: boolean
  onComplete: () => void
}

type FluidStatus = "checking" | "ready" | "loaded" | "not-installed" | "error"
type ModelProgress = {
  fraction: number
  percent: number
  phase: string
  model?: string
}

type ModelSetupError = {
  model: string
  error: string
}

export function OnboardingWizard({ open, onComplete }: OnboardingWizardProps) {
  const [step, setStep] = useState(0)
  const [direction, setDirection] = useState(1)

  const [micState, setMicState] = useState<"idle" | "requesting" | "granted" | "denied" | "error">("idle")
  const [micStream, setMicStream] = useState<MediaStream | null>(null)

  const [fluidStatus, setFluidStatus] = useState<FluidStatus>("checking")
  const [modelProgress, setModelProgress] = useState<ModelProgress | null>(null)
  const [settingUpModel, setSettingUpModel] = useState(false)
  const [setupError, setSetupError] = useState<string | null>(null)
  const fluidIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const [aiSettings, setAiSettings] = useState<AISettings>(() => loadAISettings())
  const [apiKeyError, setApiKeyError] = useState<string | null>(null)
  const [testingConnection, setTestingConnection] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<"success" | "failed" | null>(null)

  const prevStepRef = useRef(0)

  useEffect(() => {
    if (!open) return
    loadApiKey().then((key) => {
      if (key) setAiSettings((prev) => ({ ...prev, apiKey: key }))
    })
  }, [open])

  useEffect(() => {
    if (step === 2) {
      queueMicrotask(() => setFluidStatus("checking"))
      checkFluid()
      fluidIntervalRef.current = setInterval(() => {
        invoke<boolean>("fluid_loaded")
          .then((loaded) => {
            if (loaded) setFluidStatus("loaded")
          })
          .catch(() => {})
      }, 1000)
    } else {
      if (fluidIntervalRef.current) {
        clearInterval(fluidIntervalRef.current)
        fluidIntervalRef.current = null
      }
    }
    return () => {
      if (fluidIntervalRef.current) {
        clearInterval(fluidIntervalRef.current)
        fluidIntervalRef.current = null
      }
    }
  }, [step, open])

  useEffect(() => {
    if (!open) return
    let unlisten: (() => void) | undefined
    listen<ModelProgress>("fluid-model-progress", (event) => {
      setModelProgress(event.payload)
      setSetupError(null)
      if (event.payload.percent >= 100) {
        setFluidStatus("loaded")
        setSettingUpModel(false)
      }
    }).then((fn) => {
      unlisten = fn
    }).catch(() => {})
    let unlistenError: (() => void) | undefined
    listen<ModelSetupError>("fluid-model-error", (event) => {
      setSetupError(event.payload.error)
      setFluidStatus("error")
      setSettingUpModel(false)
    }).then((fn) => {
      unlistenError = fn
    }).catch(() => {})

    return () => {
      unlisten?.()
      unlistenError?.()
    }
  }, [open])

  async function checkFluid() {
    try {
      const ready = await invoke<boolean>("check_fluid_ready")
      const loaded = await invoke<boolean>("fluid_loaded")
      if (loaded) setFluidStatus("loaded")
      else if (ready) setFluidStatus("ready")
      else setFluidStatus("not-installed")
    } catch {
      setFluidStatus("error")
    }
  }

  async function setupModel() {
    setSettingUpModel(true)
    setSetupError(null)
    setModelProgress((prev) => prev ?? { fraction: 0, percent: 0, phase: "starting" })
    try {
      await invoke<boolean>("setup_fluid")
      const loaded = await invoke<boolean>("fluid_loaded")
      setFluidStatus(loaded ? "loaded" : "ready")
      if (loaded) {
        setModelProgress({ fraction: 1, percent: 100, phase: "ready" })
        setSettingUpModel(false)
      }
    } catch (e) {
      setFluidStatus("error")
      setSetupError(e instanceof Error ? e.message : String(e))
      setSettingUpModel(false)
    }
  }

  function formatProgressPhase(phase: string): string {
    switch (phase) {
      case "listing":
        return "Preparing download"
      case "downloading":
        return "Downloading model"
      case "compiling":
        return "Compiling Core ML model"
      case "ready":
        return "Ready"
      default:
        return "Starting"
    }
  }

  const handleNext = useCallback(() => {
    prevStepRef.current = step
    setDirection(1)
    if (step < TOTAL_STEPS - 1) setStep((s) => s + 1)
  }, [step])

  const handleBack = useCallback(() => {
    prevStepRef.current = step
    setDirection(-1)
    if (step > 0) setStep((s) => s - 1)
  }, [step])

  const handleRequestMic = useCallback(async () => {
    setMicState("requesting")
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      setMicStream(stream)
      setMicState("granted")
    } catch {
      setMicState("denied")
    }
  }, [])

  const handleSkipMic = useCallback(() => {
    if (micStream) {
      micStream.getTracks().forEach((t) => t.stop())
      setMicStream(null)
    }
    setMicState("idle")
    handleNext()
  }, [micStream, handleNext])

  const handleComplete = useCallback(() => {
    markOnboardingComplete()
    if (micStream) {
      micStream.getTracks().forEach((t) => t.stop())
      setMicStream(null)
    }
    onComplete()
  }, [micStream, onComplete])

  const validateApiKey = useCallback((key: string): string | null => {
    if (!key) return null
    if (!key.startsWith("sk-")) return "API key must start with 'sk-'"
    if (key.length < 20) return "API key must be at least 20 characters"
    return null
  }, [])

  const updateAI = useCallback((patch: Partial<AISettings>) => {
    setAiSettings((prev) => {
      const next = { ...prev, ...patch }
      saveAISettings(next)
      if (patch.apiKey !== undefined) saveApiKey(patch.apiKey)
      return next
    })
  }, [])

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

  const stepConfig = [
    { name: "Welcome", dot: 0 },
    { name: "Mic", dot: 1 },
    { name: "Transcription", dot: 2 },
    { name: "AI", dot: 3 },
    { name: "Ready", dot: 4 },
  ]

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent showCloseButton={false} className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center justify-center gap-2 mb-2">
            {stepConfig.map((s) => (
              <button
                key={s.dot}
                className={`size-2.5 rounded-full transition-[background-color,transform] duration-200 ease-out ${
                  s.dot === step
                    ? "scale-125 bg-primary"
                    : s.dot < step
                      ? "bg-primary/30"
                      : "bg-muted-foreground/20"
                }`}
                onClick={() => {
                  if (s.dot < step) {
                    prevStepRef.current = step
                    setDirection(-1)
                    setStep(s.dot)
                  }
                }}
                aria-label={`Go to step ${s.name}`}
              />
            ))}
          </div>
          <DialogTitle className="text-center text-lg">
            {step === 0 && "Welcome to Myna Notes"}
            {step === 1 && "Grant Microphone Access"}
            {step === 2 && "On-Device Transcription"}
            {step === 3 && "AI Enhancement"}
            {step === 4 && "You're All Set!"}
          </DialogTitle>
        </DialogHeader>

        <div className="overflow-hidden min-h-[240px]">
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={step}
              custom={direction}
              variants={stepSlideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={transitions.step}
            >
              {step === 0 && (
                <div className="flex flex-col items-center text-center gap-4 py-2">
                  <MynaAppIcon className="size-16 shadow-sm ring-1 ring-foreground/10" />
                  <DialogDescription className="text-base text-pretty">
                    Local meeting notes — live captions on this Mac, optional AI when you want polish.
                  </DialogDescription>
                  <div className="grid grid-cols-2 gap-3 w-full">
                    {[
                      { label: "Mic & system audio", icon: Mic01Icon },
                      { label: "On-device ASR", icon: AiVoiceIcon },
                      { label: "Enhance with AI", icon: AiMagicIcon },
                      { label: "Tags & actions", icon: CheckmarkBadge01Icon },
                    ].map((f) => (
                      <div
                        key={f.label}
                        className="flex items-center gap-2 rounded-xl bg-muted/60 p-3 text-sm font-medium"
                      >
                        <HugeiconsIcon icon={f.icon} strokeWidth={2} className="size-4 shrink-0 text-primary" />
                        {f.label}
                      </div>
                    ))}
                  </div>
                  <p className="text-[11px] text-pretty text-muted-foreground">
                    Speech stays on-device. Cloud AI only runs if you add an API key later.
                  </p>
                </div>
              )}

              {step === 1 && (
                <div className="flex flex-col items-center text-center gap-4 py-2">
                  <div className={`inline-flex size-16 items-center justify-center rounded-[2rem] ${
                    micState === "granted" ? "bg-green-500/10" : micState === "denied" ? "bg-destructive/10" : "bg-primary/10"
                  }`}>
                    <HugeiconsIcon icon={Mic01Icon} strokeWidth={2} className={`size-8 ${
                      micState === "granted" ? "text-green-500" : micState === "denied" ? "text-destructive" : "text-primary"
                    }`} />
                  </div>
                  <DialogDescription>
                    Myna Notes needs microphone access to record and transcribe your meetings.
                    Audio is processed locally and never leaves your device.
                  </DialogDescription>

                  {micState === "granted" && (
                    <Badge variant="secondary" className="gap-1">
                      <HugeiconsIcon icon={CheckmarkBadge01Icon} strokeWidth={2} className="size-3.5" />
                      Microphone ready
                    </Badge>
                  )}
                  {micState === "denied" && (
                    <div className="flex flex-col gap-2 w-full">
                      <Badge variant="destructive" className="gap-1 mx-auto">
                        <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-3.5" />
                        Permission denied
                      </Badge>
                      <p className="text-xs text-muted-foreground">
                        You can enable this later in System Settings &gt; Privacy &amp; Security &gt; Microphone
                      </p>
                    </div>
                  )}
                  {micState === "error" && (
                    <Badge variant="destructive" className="gap-1 mx-auto">
                      <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-3.5" />
                      An error occurred
                    </Badge>
                  )}

                  {micState !== "granted" && (
                    <Button
                      variant="default"
                      onClick={handleRequestMic}
                      disabled={micState === "requesting"}
                      className="mt-2"
                    >
                      {micState === "requesting" ? (
                        <>
                          <div className="size-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />
                          Requesting...
                        </>
                      ) : (
                        <>
                          <HugeiconsIcon icon={ShieldIcon} strokeWidth={2} data-icon="inline-start" />
                          Request Access
                        </>
                      )}
                    </Button>
                  )}
                </div>
              )}

              {step === 2 && (
                <div className="flex flex-col items-center text-center gap-4 py-2">
                  <div className={`inline-flex size-16 items-center justify-center rounded-[2rem] ${
                    fluidStatus === "loaded" ? "bg-green-500/10" : fluidStatus === "not-installed" ? "bg-destructive/10" : "bg-primary/10"
                  }`}>
                    <HugeiconsIcon icon={AiVoiceIcon} strokeWidth={2} className={`size-8 ${
                      fluidStatus === "loaded" ? "text-green-500" : fluidStatus === "not-installed" ? "text-destructive" : "text-primary"
                    }`} />
                  </div>
                  <DialogDescription className="text-pretty">
                    Fluid ASR runs on-device via the Apple Neural Engine. Capture your mic, system audio
                    (the other side of a call on macOS 14.4+), or both — nothing leaves this Mac.
                  </DialogDescription>

                  <div className="w-full flex flex-col items-center gap-2">
                    {fluidStatus === "checking" && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <div className="size-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                        Checking engine status...
                      </div>
                    )}
                    {fluidStatus === "loaded" && (
                      <Badge variant="default" className="gap-1">
                        <HugeiconsIcon icon={CheckmarkBadge01Icon} strokeWidth={2} className="size-3.5" />
                        Ready
                      </Badge>
                    )}
                    {fluidStatus === "ready" && (
                      <div className="w-full flex flex-col gap-3">
                        <Badge variant="outline" className="gap-1 mx-auto">
                          {modelProgress
                            ? `${formatProgressPhase(modelProgress.phase)} · ${modelProgress.percent}%`
                            : "Download required"}
                        </Badge>
                        <div className="h-2 overflow-hidden rounded-full bg-muted ring-1 ring-border/70">
                          <div
                            className="h-full rounded-full bg-primary transition-all duration-300"
                            style={{ width: `${modelProgress?.percent ?? 0}%` }}
                          />
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={setupModel}
                          disabled={settingUpModel}
                          className="mx-auto gap-1"
                        >
                          {settingUpModel ? "Setting up..." : "Download model"}
                        </Button>
                        {setupError && (
                          <p className="text-xs text-destructive">{setupError}</p>
                        )}
                      </div>
                    )}
                    {fluidStatus === "not-installed" && (
                      <div className="w-full flex flex-col gap-3">
                        <Badge variant="destructive" className="gap-1 mx-auto">
                          <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-3.5" />
                          Not installed
                        </Badge>
                        <div className="rounded-2xl bg-muted p-4 text-sm text-left ring-1 ring-border/70">
                          <p className="font-medium mb-2">Build the engine from source:</p>
                          <div className="app-code-block">
                            cd fluid-sidecar<br />
                            swift build -c release<br />
                            cp .build/release/fluidasr ../src-tauri/binaries/fluidasr-aarch64-apple-darwin
                          </div>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={checkFluid}
                          className="gap-1"
                        >
                          <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} className="size-3.5" />
                          Retry
                        </Button>
                      </div>
                    )}
                    {fluidStatus === "error" && (
                      <div className="flex flex-col gap-2 items-center">
                        <Badge variant="destructive" className="gap-1">
                          <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-3.5" />
                          Status unavailable
                        </Badge>
                        {setupError && (
                          <p className="text-xs text-destructive">{setupError}</p>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={setupError ? setupModel : checkFluid}
                          className="gap-1"
                        >
                          <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} className="size-3.5" />
                          Retry
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {step === 3 && (
                <div className="flex flex-col items-center text-center gap-4 py-2">
                  <div className="bg-primary/10 inline-flex size-16 items-center justify-center rounded-[2rem]">
                    <HugeiconsIcon icon={AiMagicIcon} strokeWidth={2} className="size-8 text-primary" />
                  </div>
                  <DialogDescription className="text-pretty">
                    Optional: connect DeepSeek to enhance notes, auto-tag by concept, and chat about
                    meetings. Skip for now — recording and local transcription work without a key.
                  </DialogDescription>

                  <div className="w-full flex flex-col gap-3">
                    <div className="flex flex-col gap-1.5 text-left">
                      <label className="text-xs font-medium">API Key</label>
                      <Input
                        type="password"
                        value={aiSettings.apiKey}
                        onChange={(e) => {
                          updateAI({ apiKey: e.target.value })
                          setApiKeyError(null)
                        }}
                        onBlur={() => {
                          if (aiSettings.apiKey) setApiKeyError(validateApiKey(aiSettings.apiKey))
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

                    <div className="flex flex-col gap-1.5 text-left">
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

                    <div className="flex items-center gap-3">
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
                  </div>
                </div>
              )}

              {step === 4 && (
                <div className="flex flex-col items-center text-center gap-4 py-2">
                  <div className="bg-green-500/10 inline-flex size-16 items-center justify-center rounded-[2rem]">
                    <HugeiconsIcon icon={CheckmarkBadge01Icon} strokeWidth={2} className="size-8 text-green-500" />
                  </div>
                  <DialogDescription className="text-base text-pretty">
                    You&apos;re ready. Start a note, record, then Enhance when you want structured notes and tags.
                  </DialogDescription>

                  <div className="w-full flex flex-col gap-2 text-left">
                    <div className="flex items-center justify-between rounded-xl bg-muted/60 p-3 text-sm">
                      <div className="flex items-center gap-2">
                        <HugeiconsIcon icon={Mic01Icon} strokeWidth={2} className="size-4 text-muted-foreground" />
                        Microphone
                      </div>
                      <Badge variant={micState === "granted" ? "secondary" : "outline"}>
                        {micState === "granted" ? "Granted" : "Skipped"}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between rounded-xl bg-muted/60 p-3 text-sm">
                      <div className="flex items-center gap-2">
                        <HugeiconsIcon icon={AiVoiceIcon} strokeWidth={2} className="size-4 text-muted-foreground" />
                        On-device ASR
                      </div>
                      <Badge variant={fluidStatus === "loaded" ? "secondary" : "outline"}>
                        {fluidStatus === "loaded" ? "Ready" : fluidStatus === "checking" ? "Checking..." : "Needs setup"}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between rounded-xl bg-muted/60 p-3 text-sm">
                      <div className="flex items-center gap-2">
                        <HugeiconsIcon icon={AiMagicIcon} strokeWidth={2} className="size-4 text-muted-foreground" />
                        AI Enhancement
                      </div>
                      <Badge variant={aiSettings.apiKey ? "secondary" : "outline"}>
                        {aiSettings.apiKey ? "Configured" : "Skipped"}
                      </Badge>
                    </div>
                  </div>

                  <p className="mt-1 text-xs text-pretty text-muted-foreground">
                    Tip: use <span className="font-medium text-foreground">Tags</span> on the home screen
                    to group notes by concept (Hiring, Product, 1:1s). AI can auto-tag after Enhance.
                  </p>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        <DialogFooter>
          <div className="flex w-full items-center justify-between">
            {step > 0 ? (
              <Button variant="ghost" size="sm" onClick={handleBack}>
                <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} data-icon="inline-start" />
                Back
              </Button>
            ) : (
              <div />
            )}
            <div className="flex items-center gap-2">
              {step === 1 && micState !== "granted" && (
                <Button variant="ghost" size="sm" onClick={handleSkipMic}>
                  Skip for now
                </Button>
              )}
              {step === 2 && (
                <Button variant="ghost" size="sm" onClick={handleNext}>
                  Skip
                </Button>
              )}
              {step === 3 && (
                <Button variant="ghost" size="sm" onClick={handleNext}>
                  Skip for now
                </Button>
              )}
              {step === 4 ? (
                <Button variant="default" onClick={handleComplete}>
                  <HugeiconsIcon icon={Mic01Icon} strokeWidth={2} data-icon="inline-start" />
                  Start Recording
                </Button>
              ) : step === 1 && micState === "granted" ? (
                <Button variant="default" onClick={handleNext}>
                  Next
                  <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} data-icon="inline-end" />
                </Button>
              ) : step !== 0 ? (
                <Button variant="default" onClick={handleNext}>
                  Next
                  <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} data-icon="inline-end" />
                </Button>
              ) : (
                <Button variant="default" onClick={handleNext}>
                  Get Started
                  <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} data-icon="inline-end" />
                </Button>
              )}
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
