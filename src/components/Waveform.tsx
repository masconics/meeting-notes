import { useRef, useEffect } from "react"

interface WaveformProps {
  active: boolean
  level: number
  className?: string
  color?: string
  width?: number
  height?: number
}

const POINT_COUNT = 72
const ATTACK = 0.22
const RELEASE = 0.08

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function resolveCanvasColor(canvas: HTMLCanvasElement, color: string): string {
  const trimmed = color.trim()
  if (trimmed === "currentColor") return getComputedStyle(canvas).color
  const varMatch = trimmed.match(/^var\((--[^),\s]+)(?:,\s*([^)]+))?\)$/)
  if (!varMatch) return toCanvasSafeColor(trimmed)
  const computed = getComputedStyle(canvas).getPropertyValue(varMatch[1]).trim()
  return toCanvasSafeColor(computed || varMatch[2]?.trim() || getComputedStyle(canvas).color)
}

function toCanvasSafeColor(color: string): string {
  const trimmed = color.trim()
  const oklchMatch = trimmed.match(/^oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+[\d.]+(?:\s*\/\s*([\d.]+%?))?\s*\)$/)
  if (oklchMatch) {
    const lightness = oklchMatch[1].endsWith("%")
      ? Number(oklchMatch[1].slice(0, -1)) / 100
      : Number(oklchMatch[1])
    const chroma = Number(oklchMatch[2])
    const alphaRaw = oklchMatch[3]
    const alpha = alphaRaw
      ? alphaRaw.endsWith("%")
        ? Number(alphaRaw.slice(0, -1)) / 100
        : Number(alphaRaw)
      : 1

    if (Number.isFinite(lightness) && Number.isFinite(chroma) && chroma === 0) {
      const channel = Math.max(0, Math.min(255, Math.round(lightness * 255)))
      return `rgba(${channel}, ${channel}, ${channel}, ${Math.max(0, Math.min(1, alpha))})`
    }
  }

  if (/^(oklch|oklab|lab|lch|color)\(/i.test(trimmed)) return "#4f46e5"
  return trimmed || "#4f46e5"
}

export function Waveform({ active, level, className = "", color = "var(--primary)", width = 160, height = 32 }: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const frameRef = useRef(0)
  const levelRef = useRef(level)
  const activeRef = useRef(active)
  const amplitudeRef = useRef(0)
  const phaseRef = useRef(0)

  useEffect(() => {
    levelRef.current = level
  }, [level])

  useEffect(() => {
    activeRef.current = active
  }, [active])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = width * dpr
    canvas.height = height * dpr
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`

    const midY = height / 2
    const stepX = width / (POINT_COUNT - 1)
    const strokeColor = resolveCanvasColor(canvas, color)

    const render = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, width, height)

      const active = activeRef.current
      const raw = active ? Math.min(1, Math.pow(Math.max(0, levelRef.current) * 18, 0.72)) : 0
      const target = active ? Math.max(0.06, raw) : 0
      const smoothing = target > amplitudeRef.current ? ATTACK : RELEASE
      amplitudeRef.current = lerp(amplitudeRef.current, target, smoothing)
      phaseRef.current += 0.075 + amplitudeRef.current * 0.06

      const amp = amplitudeRef.current * height * 0.36

      const gradient = ctx.createLinearGradient(0, 0, 0, height)
      gradient.addColorStop(0, strokeColor)
      gradient.addColorStop(0.5, strokeColor)
      gradient.addColorStop(1, strokeColor)

      ctx.strokeStyle = gradient
      ctx.globalAlpha = active ? 0.95 : 0.28
      ctx.lineWidth = active ? 2 : 1.5
      ctx.lineCap = "round"
      ctx.lineJoin = "round"
      ctx.beginPath()

      ctx.moveTo(0, midY)
      for (let i = 1; i < POINT_COUNT; i++) {
        const t = i / (POINT_COUNT - 1)
        const x = i * stepX
        const envelope = Math.sin(Math.PI * t)
        const wave =
          Math.sin(t * Math.PI * 4.2 + phaseRef.current) * 0.72 +
          Math.sin(t * Math.PI * 8.4 + phaseRef.current * 0.78) * 0.28
        const y = midY + wave * envelope * amp
        const prevX = (i - 1) * stepX
        const prevT = (i - 1) / (POINT_COUNT - 1)
        const prevEnvelope = Math.sin(Math.PI * prevT)
        const prevWave =
          Math.sin(prevT * Math.PI * 4.2 + phaseRef.current) * 0.72 +
          Math.sin(prevT * Math.PI * 8.4 + phaseRef.current * 0.78) * 0.28
        const prevY = midY + prevWave * prevEnvelope * amp
        const cpX = (prevX + x) / 2
        const cpY = (prevY + y) / 2
        ctx.quadraticCurveTo(prevX, prevY, cpX, cpY)
      }

      ctx.stroke()
      ctx.globalAlpha = 1
    }

    const loop = () => {
      render()
      frameRef.current = requestAnimationFrame(loop)
    }

    loop()

    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current)
    }
  }, [width, height, color])

  return (
    <canvas
      ref={canvasRef}
      className={`flex-shrink-0 ${className}`}
      width={width}
      height={height}
      aria-hidden="true"
    />
  )
}
