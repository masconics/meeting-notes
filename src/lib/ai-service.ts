import type { MeetingSection, ChatMessage, QuickAction, Meeting } from "@/types"
import { loadAISettings, loadApiKey } from "@/lib/storage"
import { findRelatedMeetings, buildMemoryContextBlock } from "@/lib/context-memory"

const DEEPSEEK_BASE = "https://api.deepseek.com"

async function getApiKey(): Promise<string> {
  const key = await loadApiKey()
  if (!key) throw new Error("DeepSeek API key not configured. Set it in Settings.")
  return key
}

export async function callDeepSeek(
  messages: { role: string; content: string }[],
  opts: { stream?: boolean; thinking?: boolean } = {}
): Promise<string> {
  const { stream = false, thinking = false } = opts
  const settings = loadAISettings()
  const apiKey = await getApiKey()

  const body: Record<string, unknown> = {
    model: settings.model || "deepseek-v4-pro",
    messages,
    stream,
    max_tokens: 4096,
  }

  if (thinking) {
    body.thinking = { type: "enabled" }
    body.reasoning_effort = "high"
  } else {
    body.temperature = stream ? 0.7 : 0.3
  }

  const res = await fetch(`${DEEPSEEK_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const body = await res.text()
    if (res.status === 401) throw new Error("Invalid API key. Check your DeepSeek API key in Settings.")
    throw new Error(`DeepSeek API error (${res.status}): ${body}`)
  }

  if (!stream) {
    const data = await res.json()
    return data.choices?.[0]?.message?.content ?? ""
  }

  const reader = res.body?.getReader()
  if (!reader) throw new Error("No response stream")

  const decoder = new TextDecoder()
  let result = ""
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const chunk = decoder.decode(value, { stream: true })
    const lines = chunk.split("\n").filter((l) => l.startsWith("data: "))
    for (const line of lines) {
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
}

// True only when AI is enabled. API key presence is checked async on API calls.
export function isAIConfigured(): boolean {
  const s = loadAISettings()
  return s.enabled
}

export async function generateTitle(
  transcript: string,
  notes: string
): Promise<string> {
  const content = [transcript, notes].filter(Boolean).join("\n\n")
  if (!content.trim()) return ""

  const prompt = `Generate a short, descriptive title (max 8 words) for this meeting based on the content below. Return ONLY the title, no quotes, no extra text, no punctuation at the end.

CONTENT:
${content.slice(0, 3000)}`

  const response = await callDeepSeek([
    { role: "system", content: "You generate short meeting titles. Respond with only the title text." },
    { role: "user", content: prompt },
  ], { thinking: false })

  return response.trim().replace(/^["']|["']$/g, "").replace(/[.!?,;:]$/, "")
}

export async function testConnection(): Promise<boolean> {
  try {
    await callDeepSeek([{ role: "user", content: "hi" }], { thinking: false })
    return true
  } catch {
    return false
  }
}

export async function generateNotes(
  rawNotes: string,
  transcript: string,
  templateSections?: string[]
): Promise<string> {
  const hasTemplate = templateSections && templateSections.length > 0
  const prompt = hasTemplate
    ? `You are a professional meeting assistant. Create clean, organized meeting notes from the raw notes and transcript below. Use structured markdown formatting — headings (##), bullet points (-), bold (**) for key terms, tables for comparisons or multi-column data, and clear section structure.

SECTIONS:
${templateSections!.map((s) => `## ${s}`).join("\n")}

TRANSCRIPT:
${transcript || "(none)"}

RAW NOTES:
${rawNotes || "(none)"}`
    : `You are a professional meeting assistant. Create clean, organized meeting notes from the raw notes and transcript below. Use structured markdown formatting — headings (##), bullet points (-), bold (**) for key terms, tables for comparisons or multi-column data, and clear section structure.

TRANSCRIPT:
${transcript || "(none)"}

RAW NOTES:
${rawNotes || "(none)"}`

  const response = await callDeepSeek([
    { role: "system", content: "You are a professional meeting notes organizer. Output clean, well-structured markdown with headings, bullet points, tables, and bold for emphasis." },
    { role: "user", content: prompt },
  ], { thinking: true })

  return response.trim().replace(/^```(?:markdown)?\s*\n?/i, "").replace(/\n?```\s*$/, "")
}

export async function* streamGenerateNotes(
  rawNotes: string,
  transcript: string,
  templateSections?: string[]
): AsyncGenerator<string> {
  const settings = loadAISettings()
  const apiKey = await getApiKey()

  const hasTemplate = templateSections && templateSections.length > 0
  const prompt = hasTemplate
    ? `You are a professional meeting assistant. Take the raw notes and transcript below, and create clean, organized meeting notes. Use structured markdown formatting — headings (##), bullet points (-), bold (**) for key terms, tables for comparisons or multi-column data, and clear section structure.

SECTIONS:
${templateSections!.map((s) => `## ${s}`).join("\n")}

TRANSCRIPT:
${transcript || "(none)"}

RAW NOTES:
${rawNotes || "(none)"}`
    : `You are a professional meeting assistant. Create clean, organized meeting notes from the raw notes and transcript below. Use structured markdown formatting — headings (##), bullet points (-), bold (**) for key terms, tables for comparisons or multi-column data, and clear section structure.

TRANSCRIPT:
${transcript || "(none)"}

RAW NOTES:
${rawNotes || "(none)"}`

  const res = await fetch(`${DEEPSEEK_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model || "deepseek-v4-pro",
      messages: [
        { role: "system", content: "You are a professional meeting notes organizer. Output clean, well-structured markdown with headings, bullet points, tables, and bold for emphasis." },
        { role: "user", content: prompt },
      ],
      stream: true,
      temperature: 0.3,
      max_tokens: 4096,
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    if (res.status === 401) throw new Error("Invalid API key.")
    throw new Error(`DeepSeek API error (${res.status}): ${body}`)
  }

  const reader = res.body?.getReader()
  if (!reader) throw new Error("No response stream")

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
        if (delta) yield delta
      } catch {
        continue
      }
    }
  }
}

export async function* streamRewriteSelection(
  selectedText: string,
  action: "rewrite" | "summarize" | "expand" | "shorten",
  context: string,
  signal?: AbortSignal
): AsyncGenerator<string> {
  const settings = loadAISettings()
  const apiKey = await getApiKey()

  const instruction = {
    rewrite: "Rewrite the selected text to be clearer and more polished while preserving the meaning.",
    summarize: "Summarize the selected text into a concise, useful version.",
    expand: "Expand the selected text with helpful detail while staying faithful to the surrounding notes.",
    shorten: "Make the selected text shorter and sharper while preserving the important meaning.",
  }[action]

  const prompt = `${instruction}

Return only the replacement text. Use markdown when it improves readability. Do not wrap the answer in code fences.

SELECTED TEXT:
${selectedText}

FULL NOTE CONTEXT:
${context.slice(0, 12000)}`

  const res = await fetch(`${DEEPSEEK_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model || "deepseek-v4-pro",
      messages: [
        { role: "system", content: "You are an expert meeting-notes editor. Replace selected text directly and concisely." },
        { role: "user", content: prompt },
      ],
      stream: true,
      temperature: 0.35,
      max_tokens: 1024,
    }),
    signal,
  })

  if (!res.ok) {
    const body = await res.text()
    if (res.status === 401) throw new Error("Invalid API key.")
    throw new Error(`DeepSeek API error (${res.status}): ${body}`)
  }

  const reader = res.body?.getReader()
  if (!reader) throw new Error("No response stream")

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
        if (delta) yield delta
      } catch {
        continue
      }
    }
  }
}

export async function enhanceNotes(
  rawNotes: string,
  transcript: string,
  sections: string[]
): Promise<MeetingSection[]> {
  const sectionList = sections.map((s) => `- ${s}`).join("\n")

  const prompt = `You are a professional meeting assistant. Take the raw notes and transcript below, and organize the information into clean, structured meeting notes.

Return ONLY valid JSON — a JSON array of objects with "title" and "content" fields, one for each section below. No markdown, no code fences, no extra text.

SECTIONS:
${sectionList}

RAW NOTES:
${rawNotes || "(none)"}

TRANSCRIPT:
${transcript || "(none)"}

Rules:
- Fill every section listed above
- Use markdown formatting in each section's content (bullet points with -, bold with **, tables with | for comparisons, etc.)
- Be concise. Extract key facts, decisions, numbers, and action items
- If a section has no relevant info from the notes/transcript, write "No information captured"
- Do NOT invent or hallucinate information not present in the notes or transcript`

  const response = await callDeepSeek([
    { role: "system", content: "You are a meeting notes organizer. You only respond with valid JSON arrays." },
    { role: "user", content: prompt },
  ], { thinking: true })

  try {
    const cleaned = response.trim()
      .replace(/^```(?:json)?\s*\n?/i, "")
      .replace(/\n?```\s*$/, "")
    return JSON.parse(cleaned)
  } catch {
    return sections.map((title) => ({ title, content: response }))
  }
}

export async function generateBrief(
  meeting: Meeting,
  pastMeetings: Meeting[]
): Promise<string> {
  const templateSections = meeting.templateId
    ? (() => {
        try {
          const raw = localStorage.getItem("meeting-notes-templates")
          if (!raw) return []
          const templates = JSON.parse(raw) as { id: string; sections: string[] }[]
          return templates.find((t) => t.id === meeting.templateId)?.sections ?? []
        } catch {
          return []
        }
      })()
    : []

  const sectionList = templateSections.length > 0
    ? templateSections.map((s) => `- ${s}`).join("\n")
    : "(no template sections)"

  const related = findRelatedMeetings(meeting, pastMeetings, 5)
  const pastContext = buildMemoryContextBlock(related, pastMeetings)

  const prompt = `You are a professional meeting preparation assistant. Generate a concise pre-meeting brief.

MEETING TITLE: ${meeting.title || "(not yet specified)"}

TEMPLATE SECTIONS:
${sectionList}

RELATED PAST MEETINGS:
${pastContext || "(no related past meetings found)"}

Generate a pre-meeting brief with these sections. Use markdown formatting — headings (###), bullet points (-), bold (**) for names and key terms, tables for comparisons or multi-column data:

1. **Context from Past Meetings** — What was discussed before that relates to this meeting?
2. **Key People & Terms** — Names, roles, and terminology that have come up
3. **Open Questions** — Unresolved items from previous discussions
4. **Suggested Topics** — Based on the template sections, what should be covered?
5. **Preparation Tips** — Advice for running this meeting effectively

Be concise and actionable. If there's limited past data, note that helpfully.`

  return await callDeepSeek([
    { role: "system", content: "You are a professional meeting preparation assistant. Generate crisp, actionable pre-meeting briefs." },
    { role: "user", content: prompt },
  ], { thinking: true })
}

export async function executeQuickAction(
  transcript: string,
  notes: string,
  structuredNotes: MeetingSection[] | undefined,
  action: QuickAction,
  meeting?: Meeting,
  allMeetings?: Meeting[]
): Promise<string> {
  const sectionsContext = structuredNotes
    ? structuredNotes.map((s) => `${s.title}:\n${s.content}`).join("\n\n")
    : ""

  let memoryContext = ""
  if (meeting && allMeetings) {
    const related = findRelatedMeetings(meeting, allMeetings, 3)
    memoryContext = buildMemoryContextBlock(related, allMeetings, 1500)
  }

  const system = `You are a professional meeting assistant. Answer concisely with actionable, specific information based only on the meeting data provided. Use markdown formatting in your response — headings, bullet points, tables, and bold for emphasis where appropriate.`

  const user = `${action.prompt}

MEETING TRANSCRIPT:
${transcript || "(none)"}

MEETING NOTES:
${notes || "(none)"}

STRUCTURED NOTES:
${sectionsContext || "(none)"}
${memoryContext ? `\nRELATED PAST MEETING CONTEXT:\n${memoryContext}` : ""}`

  return await callDeepSeek([
    { role: "system", content: system },
    { role: "user", content: user },
  ], { thinking: true })
}

export async function* streamChatResponse(
  messages: ChatMessage[],
  meeting: Meeting,
  allMeetings?: Meeting[],
  signal?: AbortSignal
): AsyncGenerator<string> {
  const settings = loadAISettings()
  const apiKey = await getApiKey()

  const transcript = meeting.transcript
  const notes = meeting.notes
  const structuredNotes = meeting.structuredNotes

  const sectionsContext = structuredNotes
    ? structuredNotes.map((s) => `${s.title}:\n${s.content}`).join("\n\n")
    : ""

  let memoryContext = ""
  if (allMeetings && allMeetings.length > 0) {
    const related = findRelatedMeetings(meeting, allMeetings, 5)
    memoryContext = buildMemoryContextBlock(related, allMeetings, 2000)
  }

  const systemMsg = `You are a helpful AI meeting assistant. You have access to the full meeting transcript, notes, structured notes, and context from related past meetings. Answer questions based on this context. Be concise and specific. Use markdown formatting in your responses — headings, bullet points, tables, and bold for emphasis where appropriate.

CURRENT MEETING CONTEXT:
Transcript: ${transcript || "(none)"}
Notes: ${notes || "(none)"}
${sectionsContext ? `Structured Notes:\n${sectionsContext}` : ""}
${memoryContext ? `\nRELATED PAST MEETINGS:\n${memoryContext}` : ""}`

  const apiMessages = [
    { role: "system", content: systemMsg },
    ...messages.map((m) => ({ role: m.role, content: m.content })),
  ]

  const res = await fetch(`${DEEPSEEK_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model || "deepseek-v4-pro",
      messages: apiMessages,
      stream: true,
      temperature: 0.7,
      max_tokens: 2048,
    }),
    signal,
  })

  if (!res.ok) {
    const body = await res.text()
    if (res.status === 401) throw new Error("Invalid API key.")
    throw new Error(`DeepSeek API error (${res.status}): ${body}`)
  }

  const reader = res.body?.getReader()
  if (!reader) throw new Error("No response stream")

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
        if (delta) yield delta
      } catch {
        continue
      }
    }
  }
}

export async function detectSpeakers(transcript: string): Promise<string[]> {
  if (!transcript.trim()) return []

  const prompt = `Analyze this meeting transcript and extract the names of all speakers/participants. Return ONLY a JSON array of strings. Skip generic labels like "Speaker 1", "Interviewer", "Moderator" — only real person names. If no names are found, return [].

TRANSCRIPT:
${transcript.slice(0, 4000)}`

  try {
    const response = await callDeepSeek([
      { role: "system", content: "Extract speaker names from transcripts. Respond only with a JSON array of strings." },
      { role: "user", content: prompt },
    ], { thinking: false })

    const cleaned = response.trim()
      .replace(/^```(?:json)?\s*\n?/i, "")
      .replace(/\n?```\s*$/, "")
    const names: string[] = JSON.parse(cleaned)
    return Array.isArray(names) ? names.filter((n) => typeof n === "string" && n.trim()) : []
  } catch {
    return []
  }
}

function buildMeetingContent(meeting: Meeting): string {
  const parts = [meeting.title]
  if (meeting.notes) parts.push(meeting.notes)
  if (meeting.transcript) parts.push(meeting.transcript.slice(0, 2000))
  if (meeting.structuredNotes) {
    for (const section of meeting.structuredNotes) {
      parts.push(section.title, section.content)
    }
  }
  if (meeting.enhancedNotes) parts.push(meeting.enhancedNotes)
  if (meeting.brief) parts.push(meeting.brief)
  return parts.join(" ")
}

export async function generateMeetingDigest(meeting: Meeting): Promise<string> {
  const content = buildMeetingContent(meeting)
  if (!content.trim()) return meeting.title || "Untitled meeting"

  const prompt = `Generate a concise semantic digest of this meeting (3-5 sentences). Capture: key topics discussed, decisions made, action items assigned, people mentioned, and the overall purpose. This digest will be used for semantic similarity search against other meetings.

MEETING:
Title: ${meeting.title}
${content.slice(0, 6000)}`

  try {
    const response = await callDeepSeek([
      { role: "system", content: "You generate concise meeting digests for semantic search. Be factual and specific. Include key terms, names, and concepts that would help match related meetings." },
      { role: "user", content: prompt },
    ], { thinking: false })
    return response.trim()
  } catch {
    return content.slice(0, 500)
  }
}

export async function indexMeetingInMemory(meeting: Meeting): Promise<string> {
  const digest = await generateMeetingDigest(meeting)
  const { indexMeeting } = await import("@/lib/context-memory")
  indexMeeting(meeting, digest)
  return digest
}

export async function* streamGlobalChat(
  query: string,
  chatHistory: ChatMessage[],
  allMeetings: Meeting[],
  signal?: AbortSignal
): AsyncGenerator<string> {
  const settings = loadAISettings()
  const apiKey = await getApiKey()

  const { findRelatedMeetings, buildMemoryContextBlock } = await import("@/lib/context-memory")

  const queryMeeting: Meeting = {
    id: "__global__",
    title: query.slice(0, 100),
    date: new Date().toISOString(),
    duration: 0,
    transcript: query,
    notes: query,
  }

  const related = findRelatedMeetings(queryMeeting, allMeetings, 10)
  const context = buildMemoryContextBlock(related, allMeetings, 6000)

  const systemMsg = `You are a helpful assistant with access to context from the user's past meetings. Answer questions based on this context. If the answer cannot be found in the meeting context, say so honestly. Be concise and specific. Use markdown formatting — headings, bullet points, tables, and bold for emphasis where appropriate.

AVAILABLE MEETING CONTEXT (${allMeetings.length} total, showing most relevant):
${context || "(no relevant meetings found)"}

The user's question: ${query}`

  const apiMessages = [
    { role: "system", content: systemMsg },
    ...chatHistory.map((m) => ({ role: m.role, content: m.content })),
  ]

  const res = await fetch(`${DEEPSEEK_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model || "deepseek-v4-pro",
      messages: apiMessages,
      stream: true,
      temperature: 0.7,
      max_tokens: 4096,
    }),
    signal,
  })

  if (!res.ok) {
    const body = await res.text()
    if (res.status === 401) throw new Error("Invalid API key.")
    throw new Error(`DeepSeek API error (${res.status}): ${body}`)
  }

  const reader = res.body?.getReader()
  if (!reader) throw new Error("No response stream")

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
        if (delta) yield delta
      } catch {
        continue
      }
    }
  }
}
