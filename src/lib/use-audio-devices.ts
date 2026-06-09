import { useState, useEffect, useCallback, useRef } from "react"

export interface AudioDevice {
  deviceId: string
  label: string
  kind: string
}

export type AudioSource = "mic" | "system"

export function useAudioDevices() {
  const [devices, setDevices] = useState<AudioDevice[]>([])
  const [selectedDevice, setSelectedDevice] = useState<string>("default")
  const [audioSource, setAudioSource] = useState<AudioSource>("mic")
  const streamRef = useRef<MediaStream | null>(null)

  const enumerate = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      setDevices([])
      return
    }
    try {
      const allDevices = await navigator.mediaDevices.enumerateDevices()
      const audioInputs = allDevices
        .filter((d) => d.kind === "audioinput" && d.deviceId)
        .map((d) => ({
          deviceId: d.deviceId,
          label: d.label || `Microphone (${d.deviceId.slice(0, 8)}...)`,
          kind: d.kind,
        }))
      setDevices(audioInputs)
    } catch {
      setDevices([])
    }
  }, [])

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [])

  const requestStream = useCallback(async (deviceId?: string) => {
    if (!navigator.mediaDevices?.getUserMedia) return null
    stopStream()
    try {
      const targetId = deviceId || selectedDevice
      const constraints: MediaStreamConstraints = {
        audio: targetId === "default"
          ? true
          : { deviceId: { exact: targetId } },
      }
      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      streamRef.current = stream
      return stream
    } catch {
      return null
    }
  }, [selectedDevice, stopStream])

  useEffect(() => {
    enumerate()
    if (navigator.mediaDevices) {
      navigator.mediaDevices.addEventListener("devicechange", enumerate)
      return () => {
        navigator.mediaDevices.removeEventListener("devicechange", enumerate)
        stopStream()
      }
    }
  }, [enumerate, stopStream])

  return {
    devices,
    selectedDevice,
    setSelectedDevice,
    audioSource,
    setAudioSource,
    requestStream,
    stopStream,
    enumerate,
    getDeviceLabel: (deviceId: string) => devices.find(d => d.deviceId === deviceId)?.label ?? null,
  }
}
