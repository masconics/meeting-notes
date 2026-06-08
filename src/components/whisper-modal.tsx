import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  AiVoiceIcon,
  StopIcon,
  Cancel01Icon,
  ShieldIcon,
  Settings02Icon,
} from "@hugeicons/core-free-icons"
import { useWhisper } from "@/lib/use-whisper"
import { useCallback } from "react"

interface WhisperModalProps {
  onTranscription: (text: string) => void
  onOpenSettings: () => void
}

export function WhisperModal({ onTranscription, onOpenSettings }: WhisperModalProps) {
  const whisper = useWhisper()

  const handleOpen = useCallback((open: boolean) => {
    if (open) {
      whisper.checkEngine()
    } else {
      whisper.reset()
    }
  }, [whisper])

  return (
    <Dialog onOpenChange={handleOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <HugeiconsIcon icon={AiVoiceIcon} strokeWidth={2} data-icon="inline-start" />
          Vibe Voice
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Vibe Voice</DialogTitle>
          <DialogDescription>
            {whisper.engine.status === "checking" && "Checking transcription engine..."}
            {whisper.engine.status === "unavailable" && "On-device transcription is not ready"}
            {whisper.engine.status === "ready" && whisper.state === "idle" && "Record a voice memo and transcribe it locally."}
            {whisper.state === "recording" && "Listening..."}
            {whisper.state === "transcribing" && "Transcribing..."}
            {whisper.state === "done" && "Transcription complete."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4">
          {whisper.engine.status === "checking" && (
            <div className="flex flex-col items-center gap-3 py-4">
              <div className="size-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <p className="text-xs text-muted-foreground">Checking engine...</p>
            </div>
          )}

          {whisper.engine.status === "unavailable" && (
            <div className="flex flex-col items-center gap-4 py-4 text-center">
              <div className="bg-destructive/10 inline-flex size-12 items-center justify-center rounded-full">
                <HugeiconsIcon icon={ShieldIcon} strokeWidth={2} className="size-6 text-destructive" />
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium">Transcription not available</p>
                <p className="text-xs text-muted-foreground">
                  {whisper.engine.error || "The on-device transcription engine needs to be installed first."}
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={whisper.setupEngine}>
                  <HugeiconsIcon icon={AiVoiceIcon} strokeWidth={2} data-icon="inline-start" />
                  Install Now
                </Button>
                <Button variant="default" size="sm" onClick={onOpenSettings}>
                  <HugeiconsIcon icon={Settings02Icon} strokeWidth={2} data-icon="inline-start" />
                  Settings
                </Button>
              </div>
            </div>
          )}

          {whisper.engine.status === "ready" && whisper.state === "idle" && (
            <div className="flex justify-center py-4">
              <Button size="lg" onClick={whisper.startRecording}>
                <HugeiconsIcon icon={AiVoiceIcon} strokeWidth={2} data-icon="inline-start" />
                Record
              </Button>
            </div>
          )}

          {whisper.state === "recording" && (
            <div className="flex flex-col items-center gap-4 py-4">
              <Badge variant="destructive" className="animate-pulse">Recording</Badge>
              <Button size="lg" variant="destructive" onClick={whisper.stopRecording}>
                <HugeiconsIcon icon={StopIcon} strokeWidth={2} data-icon="inline-start" />
                Stop
              </Button>
            </div>
          )}

          {whisper.state === "transcribing" && (
            <div className="flex flex-col items-center gap-3 py-4">
              <div className="size-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <p className="text-xs text-muted-foreground">Processing audio locally...</p>
            </div>
          )}

          {whisper.error && (
            <div className="text-destructive text-sm font-medium text-center" role="alert">
              {whisper.error}
            </div>
          )}

          {whisper.result && (
            <div className="w-full bg-muted rounded-2xl p-3 text-sm whitespace-pre-wrap max-h-48 overflow-y-auto">
              {whisper.result}
            </div>
          )}
        </div>

        <DialogFooter showCloseButton={false}>
          {whisper.state === "done" && (
            <>
              <Button variant="outline" size="sm" onClick={whisper.reset}>
                <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} data-icon="inline-start" />
                Discard
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  onTranscription(whisper.result)
                  whisper.reset()
                }}
              >
                Insert into Notes
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
