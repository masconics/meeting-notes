import { loadAISettings, loadApiKey } from "@/lib/storage"

const DEEPSEEK_BASE = "https://api.deepseek.com"
const REQUEST_TIMEOUT_MS = 120000
const MAX_RETRIES = 2
const INITIAL_BACKOFF_MS = 1000

export class DeepSeekError extends Error {
  status: number
  constructor(message: string, status = 0) {
    super(message)
    this.name = "DeepSeekError"
    this.status = status
  }
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

interface DeepSeekOptions {
  stream?: boolean
  temperature?: number
  maxTokens?: number
  thinking?: boolean
  signal?: AbortSignal
  timeoutMs?: number
}

export async function callDeepSeek(
  messages: { role: string; content: string }[],
  opts: DeepSeekOptions = {},
): Promise<string> {
  const {
    stream = false,
    temperature,
    maxTokens = 4096,
    thinking = false,
    timeoutMs = REQUEST_TIMEOUT_MS,
  } = opts

  const settings = loadAISettings()
  const apiKey = await loadApiKey()
  if (!apiKey) throw new DeepSeekError("DeepSeek API key not configured. Set it in Settings.")

  const body: Record<string, unknown> = {
    model: settings.model || "deepseek-v4-pro",
    messages,
    stream,
    max_tokens: maxTokens,
  }

  if (thinking) {
    body.thinking = { type: "enabled" }
    body.reasoning_effort = "high"
  } else if (temperature !== undefined) {
    body.temperature = temperature
  } else {
    body.temperature = stream ? 0.7 : 0.3
  }

  let lastError: Error | null = null

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController()
    let timedOut = false
    const timeout = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)
    const signal = opts.signal

    const combinedSignal = signal
      ? anySignal([controller.signal, signal])
      : controller.signal

    try {
      const res = await fetch(`${DEEPSEEK_BASE}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: combinedSignal,
      })

      if (!res.ok) {
        await res.text()
        if (res.status === 401) throw new DeepSeekError("Invalid API key. Check your DeepSeek API key in Settings.", 401)
        if (res.status === 429) {
          lastError = new DeepSeekError("Rate limited. Retrying...", 429)
          await sleep(INITIAL_BACKOFF_MS * Math.pow(2, attempt))
          continue
        }
        if (res.status >= 500) {
          lastError = new DeepSeekError(`Server error (${res.status}). Retrying...`, res.status)
          await sleep(INITIAL_BACKOFF_MS * Math.pow(2, attempt))
          continue
        }
        throw new DeepSeekError(`API error (${res.status})`, res.status)
      }

      if (!stream) {
        const data = await res.json()
        return data.choices?.[0]?.message?.content ?? ""
      }

      const reader = res.body?.getReader()
      if (!reader) throw new DeepSeekError("No response stream")

      let result = ""
      const decoder = new TextDecoder()
      let buffer = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() || ""

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue
          const data = line.slice(6)
          if (data === "[DONE]") continue
          try {
            const parsed = JSON.parse(data)
            const delta = parsed.choices?.[0]?.delta?.content
            if (delta) result += delta
          } catch {
            continue
          }
        }
      }
      return result
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new DeepSeekError(timedOut ? "Request timed out" : "Request cancelled")
      }
      if (err instanceof DeepSeekError) {
        if (err.status === 429 || err.status >= 500) {
          lastError = err
          if (attempt < MAX_RETRIES) continue
        }
        throw err
      }
      lastError = err instanceof Error ? err : new Error(String(err))
      if (attempt < MAX_RETRIES) {
        await sleep(INITIAL_BACKOFF_MS * Math.pow(2, attempt))
        continue
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  throw lastError ?? new DeepSeekError("Request failed after retries")
}

export async function fetchDeepSeekStream(
  messages: { role: string; content: string }[],
  opts: DeepSeekOptions = {},
): Promise<{ reader: ReadableStreamDefaultReader<Uint8Array>; abort: () => void }> {
  const {
    temperature,
    maxTokens = 4096,
    timeoutMs = REQUEST_TIMEOUT_MS,
    signal,
  } = opts

  const settings = loadAISettings()
  const apiKey = await loadApiKey()
  if (!apiKey) throw new DeepSeekError("DeepSeek API key not configured. Set it in Settings.")

  let lastError: Error | null = null

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController()
    let timedOut = false
    const timeout = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)

    const combinedSignal = signal
      ? anySignal([controller.signal, signal])
      : controller.signal

    try {
      const res = await fetch(`${DEEPSEEK_BASE}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: settings.model || "deepseek-v4-pro",
          messages,
          stream: true,
          temperature: temperature ?? 0.3,
          max_tokens: maxTokens,
        }),
        signal: combinedSignal,
      })

      if (!res.ok) {
        await res.text()
        if (res.status === 401) throw new DeepSeekError("Invalid API key.", 401)
        if (res.status === 429 || res.status >= 500) {
          lastError = new DeepSeekError(`Server error (${res.status}). Retrying...`, res.status)
          await sleep(INITIAL_BACKOFF_MS * Math.pow(2, attempt))
          continue
        }
        throw new DeepSeekError(`API error (${res.status})`, res.status)
      }

      const reader = res.body?.getReader()
      if (!reader) throw new DeepSeekError("No response stream")

      return { reader, abort: () => controller.abort() }
    } catch (err: unknown) {
      clearTimeout(timeout)
      if (err instanceof Error && err.name === "AbortError") {
        throw new DeepSeekError(timedOut ? "Request timed out" : "Request cancelled")
      }
      if (err instanceof DeepSeekError) {
        if (err.status === 429 || err.status >= 500) {
          lastError = err
          if (attempt < MAX_RETRIES) continue
        }
        throw err
      }
      lastError = err instanceof Error ? err : new Error(String(err))
      if (attempt < MAX_RETRIES) {
        await sleep(INITIAL_BACKOFF_MS * Math.pow(2, attempt))
        continue
      }
    }
  }

  throw lastError ?? new DeepSeekError("Stream request failed after retries")
}

function anySignal(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController()
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason)
      return controller.signal
    }
    signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true })
  }
  return controller.signal
}
