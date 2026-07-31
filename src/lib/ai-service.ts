import type { MeetingSection, ChatMessage, QuickAction, Meeting, WritingStyle } from "@/types"
import { loadAISettings, loadSettings, loadTemplates } from "@/lib/storage"
import { withVocabulary } from "@/lib/dictionary"
import { findRelatedMeetings, buildMemoryContextBlock } from "@/lib/context-memory"
import { buildMeetingContent } from "@/lib/meeting-content"
import { parseSSEStream } from "@/lib/sse-parser"
import { callDeepSeek, fetchDeepSeekStream } from "@/lib/deepseek-client"

export function isAIConfigured(): boolean {
  const s = loadAISettings()
  return s.enabled
}

// Persona directive for generation calls ("styles" — formal in one context,
// casual in another). A template's own style wins over the global setting;
// returns "" when no styling applies, so prompts stay untouched.
function styleDirective(templateId?: string): string {
  const settings = loadSettings()
  let style: WritingStyle = settings.writingStyle
  if (templateId) {
    const tpl = loadTemplates().find((t) => t.id === templateId)
    if (tpl?.style && tpl.style !== "default") style = tpl.style
  }
  switch (style) {
    case "formal":
      return "WRITING STYLE: Formal and professional register — polished, precise, no contractions or slang."
    case "casual":
      return "WRITING STYLE: Casual and conversational — warm, plain-spoken, contractions welcome."
    case "crisp":
      return "WRITING STYLE: Crisp and terse — short sentences, no filler, maximum signal per word."
    case "custom": {
      const custom = settings.customStylePrompt.trim()
      return custom ? `WRITING STYLE: ${custom}` : ""
    }
    default:
      return ""
  }
}

function cleanJsonResponse(text: string): string {
  return text.trim()
    .replace(/^```(?:json)?\s*\n?/i, "")
    .replace(/\n?```\s*$/, "")
}

export async function generateTitle(
  transcript: string,
  notes: string,
): Promise<string> {
  const content = [transcript, notes].filter(Boolean).join("\n\n")
  if (!content.trim()) return ""

  const prompt = `Generate a short, descriptive title (max 8 words) for this meeting based on the content below. Return ONLY the title, no quotes, no extra text, no punctuation at the end.

CONTENT:
${content.slice(0, 3000)}`

  const response = await callDeepSeek([
    { role: "system", content: withVocabulary("You generate short meeting titles. Respond with only the title text.") },
    { role: "user", content: prompt },
  ])

  return response.trim().replace(/^["']|["']$/g, "").replace(/[.!?,;:]$/, "")
}

/**
 * Plain-text 1–2 sentence summary for dashboard list cards.
 * No markdown — intentionally separate from the enhanced note body.
 */
export async function generateMeetingDescription(
  notes: string,
  transcript: string,
  title?: string,
): Promise<string> {
  const content = [title, notes, transcript].filter(Boolean).join("\n\n").trim()
  if (!content) return ""

  const prompt = `Write a brief plain-text description of this meeting for a list card (1–2 sentences, max ~200 characters).
Cover what the meeting was about and the main outcome or topics — not a transcript.
Rules:
- Plain prose only (no markdown, no bullets, no headings, no quotes around the whole answer)
- No title line
- Do not invent facts not present below

MEETING:
${content.slice(0, 6000)}`

  const response = await callDeepSeek([
    {
      role: "system",
      content: withVocabulary(
        "You write short meeting descriptions for a notes app list. Respond with only the description text.",
      ),
    },
    { role: "user", content: prompt },
  ], { temperature: 0.3, maxTokens: 180 })

  return response
    .trim()
    .replace(/^["']|["']$/g, "")
    // Strip any accidental markdown the model still emits
    .replace(/^#+\s+/gm, "")
    .replace(/\*\*?|__?/g, "")
    .replace(/\n+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 280)
}

export async function testConnection(): Promise<boolean> {
  try {
    await callDeepSeek([{ role: "user", content: "hi" }])
    return true
  } catch {
    return false
  }
}

function buildNotesPrompt(rawNotes: string, transcript: string, templateSections?: string[]): string {
  const hasTemplate = templateSections && templateSections.length > 0
  const priority = `The user's handwritten / shorthand notes are the PRIMARY signal — treat them as intentional structure and emphasis. Use the transcript to fill gaps, recover exact quotes, names, numbers, and decisions the shorthand omitted. Prefer the user's wording when both cover the same point. Do not invent content absent from both sources.`

  if (hasTemplate) {
    return `You are a professional meeting assistant. Create clean, organized meeting notes by merging the user's notes with the transcript.

${priority}

SECTIONS:
${templateSections!.map((s) => `## ${s}`).join("\n")}

USER NOTES (primary):
${rawNotes || "(none)"}

TRANSCRIPT (supporting):
${transcript || "(none)"}`
  }
  return `You are a professional meeting assistant. Create clean, organized meeting notes by merging the user's notes with the transcript. Use structured markdown formatting — headings (##), bullet points (-), bold (**) for key terms, tables for comparisons or multi-column data, and clear section structure.

${priority}

USER NOTES (primary):
${rawNotes || "(none)"}

TRANSCRIPT (supporting):
${transcript || "(none)"}`
}

export async function* streamGenerateNotes(
  rawNotes: string,
  transcript: string,
  templateSections?: string[],
  templateId?: string,
): AsyncGenerator<string> {
  const prompt = buildNotesPrompt(rawNotes, transcript, templateSections)
  const style = styleDirective(templateId)

  const { reader } = await fetchDeepSeekStream([
    { role: "system", content: withVocabulary(`You are a professional meeting notes organizer. Output clean, well-structured markdown with headings, bullet points, tables, and bold for emphasis.${style ? `\n\n${style}` : ""}`) },
    { role: "user", content: prompt },
  ], { temperature: 0.3 })

  try {
    yield* parseSSEStream(reader)
  } finally {
    reader.releaseLock()
  }
}

async function* streamSelectionEdit(
  instruction: string,
  selectedText: string,
  context: string,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const prompt = `${instruction}

Return only the replacement text. Use markdown when it improves readability. Do not wrap the answer in code fences.

SELECTED TEXT:
${selectedText}

FULL NOTE CONTEXT:
${context.slice(0, 12000)}`

  const { reader } = await fetchDeepSeekStream([
    { role: "system", content: withVocabulary("You are an expert meeting-notes editor. Replace selected text directly and concisely.") },
    { role: "user", content: prompt },
  ], { temperature: 0.35, maxTokens: 1024, signal })

  try {
    yield* parseSSEStream(reader, signal)
  } finally {
    reader.releaseLock()
  }
}

export async function* streamRewriteSelection(
  selectedText: string,
  action: "rewrite" | "summarize" | "expand" | "shorten",
  context: string,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const instruction: Record<string, string> = {
    rewrite: "Rewrite the selected text to be clearer and more polished while preserving the meaning.",
    summarize: "Summarize the selected text into a concise, useful version.",
    expand: "Expand the selected text with helpful detail while staying faithful to the surrounding notes.",
    shorten: "Make the selected text shorter and sharper while preserving the important meaning.",
  }
  yield* streamSelectionEdit(instruction[action], selectedText, context, signal)
}

/** Freeform "ask on selection" — the user's own instruction applied to the
 *  selected text (e.g. "make it sound apologetic", "say it simply"). */
export async function* streamCustomEdit(
  selectedText: string,
  instruction: string,
  context: string,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const trimmed = instruction.trim()
  const directive = `Apply this instruction to the selected text: "${trimmed}". Preserve facts and meaning not affected by the instruction.`
  yield* streamSelectionEdit(directive, selectedText, context, signal)
}

export async function enhanceNotes(
  rawNotes: string,
  transcript: string,
  sections: string[],
): Promise<MeetingSection[]> {
  const sectionList = sections.map((s) => `- ${s}`).join("\n")

  const prompt = `You are a professional meeting assistant. Take the user's notes and transcript below, and organize the information into clean, structured meeting notes.

The user's handwritten / shorthand notes are the PRIMARY signal. Use the transcript to fill gaps and recover details. Prefer the user's wording when both cover the same point.

Return ONLY valid JSON — a JSON array of objects with "title" and "content" fields, one for each section below. No markdown, no code fences, no extra text.

SECTIONS:
${sectionList}

USER NOTES (primary):
${rawNotes || "(none)"}

TRANSCRIPT (supporting):
${transcript || "(none)"}

Rules:
- Fill every section listed above
- Use markdown formatting in each section's content (bullet points with -, bold with **, tables with | for comparisons, etc.)
- Be concise. Extract key facts, decisions, numbers, and action items
- If a section has no relevant info from the notes/transcript, write "No information captured"
- Do NOT invent or hallucinate information not present in the notes or transcript`

  const style = styleDirective()
  const response = await callDeepSeek([
    { role: "system", content: withVocabulary(`You are a meeting notes organizer. You only respond with valid JSON arrays.${style ? ` ${style}` : ""}`) },
    { role: "user", content: prompt },
  ], { thinking: true })

  try {
    return JSON.parse(cleanJsonResponse(response))
  } catch {
    return sections.map((title) => ({ title, content: "" }))
  }
}

export async function generateBrief(
  meeting: Meeting,
  pastMeetings: Meeting[],
): Promise<string> {
  const templateSections = meeting.templateId
    ? (() => {
        try {
          const templates = loadTemplates()
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
    { role: "system", content: withVocabulary("You are a professional meeting preparation assistant. Generate crisp, actionable pre-meeting briefs.") },
    { role: "user", content: prompt },
  ], { thinking: true })
}

export async function executeQuickAction(
  transcript: string,
  notes: string,
  structuredNotes: MeetingSection[] | undefined,
  action: QuickAction,
  meeting?: Meeting,
  allMeetings?: Meeting[],
): Promise<string> {
  const sectionsContext = structuredNotes
    ? structuredNotes.map((s) => `${s.title}:\n${s.content}`).join("\n\n")
    : ""

  let memoryContext = ""
  if (meeting && allMeetings) {
    const related = findRelatedMeetings(meeting, allMeetings, 3)
    memoryContext = buildMemoryContextBlock(related, allMeetings, 1500)
  }

  const system = withVocabulary("You are a professional meeting assistant. Answer concisely with actionable, specific information based only on the meeting data provided. Use markdown formatting in your response — headings, bullet points, tables, and bold for emphasis where appropriate.")

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
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const transcript = meeting.transcript
  const notes = meeting.notes
  const structuredNotes = meeting.structuredNotes

  const sectionsContext = structuredNotes
    ? structuredNotes.map((s) => `${s.title}:\n${s.content}`).join("\n\n")
    : ""

  let memoryContext = ""
  let knowledgeContext = ""
  if (allMeetings && allMeetings.length > 0) {
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user")?.content || ""
    if (lastUserMsg) {
      try {
        const { searchKnowledge, buildKnowledgeContextBlock } = await import("@/lib/knowledge-search")
        const results = await searchKnowledge(lastUserMsg, allMeetings, {
          excludeMeetingId: meeting.id,
          limit: 15,
        })
        knowledgeContext = buildKnowledgeContextBlock(results, 2000)
      } catch { /* knowledge search is optional */ }
    }
    if (!knowledgeContext) {
      const related = findRelatedMeetings(meeting, allMeetings, 5)
      memoryContext = buildMemoryContextBlock(related, allMeetings, 2000)
    }
  }

  const crossMeetingContext = knowledgeContext || memoryContext

  const systemMsg = withVocabulary(`You are a helpful AI meeting assistant. You have access to the full meeting transcript, notes, structured notes, and context from related past meetings. Answer questions based on this context. Be concise and specific. Use markdown formatting in your responses — headings, bullet points, tables, and bold for emphasis where appropriate.

CURRENT MEETING CONTEXT:
Transcript: ${transcript || "(none)"}
Notes: ${notes || "(none)"}
${sectionsContext ? `Structured Notes:\n${sectionsContext}` : ""}
${crossMeetingContext ? `\n${knowledgeContext ? "KNOWLEDGE FROM PAST MEETINGS" : "RELATED PAST MEETINGS"}:\n${crossMeetingContext}` : ""}`)

  const apiMessages = [
    { role: "system", content: systemMsg },
    ...messages.map((m) => ({ role: m.role, content: m.content })),
  ]

  const { reader } = await fetchDeepSeekStream(apiMessages, { temperature: 0.7, maxTokens: 2048, signal })

  try {
    yield* parseSSEStream(reader, signal)
  } finally {
    reader.releaseLock()
  }
}

/** Suggest chat questions grounded in this meeting's actual content. Returns
 *  [] on any failure — suggestions are decoration, never worth an error. */
export async function suggestQuestions(transcript: string, notes: string): Promise<string[]> {
  if (!`${transcript}${notes}`.trim()) return []

  const prompt = `Based on this meeting's content, suggest 4-6 short questions the user is most likely to ask about THIS specific meeting. Reference the actual topics, people, decisions, numbers, and open threads — no generic questions that could apply to any meeting. Keep each question under 60 characters. Return ONLY a JSON array of strings.

NOTES:
${notes.slice(0, 4000)}

TRANSCRIPT:
${transcript.slice(0, 4000)}`

  try {
    const response = await callDeepSeek([
      { role: "system", content: "You suggest concise, content-specific questions about a meeting. Respond only with a JSON array of strings." },
      { role: "user", content: prompt },
    ])
    const questions: string[] = JSON.parse(cleanJsonResponse(response))
    return Array.isArray(questions)
      ? questions.filter((q) => typeof q === "string" && q.trim()).slice(0, 6)
      : []
  } catch {
    return []
  }
}

export async function detectSpeakers(transcript: string): Promise<string[]> {
  if (!transcript.trim()) return []

  const prompt = `Analyze this meeting transcript and extract the names of all speakers/participants. Return ONLY a JSON array of strings. Skip generic labels like "Speaker 1", "Interviewer", "Moderator" — only real person names. If no names are found, return [].

TRANSCRIPT:
${transcript.slice(0, 4000)}`

  try {
    const response = await callDeepSeek([
      { role: "system", content: withVocabulary("Extract speaker names from transcripts. Respond only with a JSON array of strings.") },
      { role: "user", content: prompt },
    ])

    const names: string[] = JSON.parse(cleanJsonResponse(response))
    return Array.isArray(names) ? names.filter((n) => typeof n === "string" && n.trim()) : []
  } catch {
    return []
  }
}

/**
 * Suggest concept tags for a meeting. Prefers reusing existing tag names
 * so related meetings cluster; invents short new tags only when needed.
 * Returns 1–5 display names (not ids).
 */
export async function suggestMeetingTags(input: {
  title: string
  notes: string
  transcript: string
  existingTags: string[]
}): Promise<string[]> {
  const body = [input.notes, input.transcript].filter((s) => s.trim()).join("\n\n").trim()
  if (!body && !input.title.trim()) return []

  const existing = input.existingTags.map((t) => t.trim()).filter(Boolean)
  const existingBlock =
    existing.length > 0
      ? `EXISTING TAGS (prefer reusing these exact names when they fit):\n${existing.map((t) => `- ${t}`).join("\n")}`
      : "EXISTING TAGS: (none yet — invent short concept tags)"

  const prompt = `You tag meeting notes by concept so similar meetings can be found later.

Rules:
- Return ONLY a JSON array of 1 to 5 short tag strings (1–3 words each)
- Prefer reusing EXISTING TAGS when the meeting is about that concept (match meaning, not just keywords)
- Only invent a new tag when no existing tag fits
- Tags are topics/concepts (e.g. "Hiring", "Q3 roadmap", "Billing", "1:1s") — not person names, dates, or "meeting"
- No duplicates; Title Case preferred

${existingBlock}

MEETING TITLE: ${input.title || "(untitled)"}

MEETING CONTENT:
${body.slice(0, 6000) || "(empty)"}`

  try {
    const response = await callDeepSeek([
      {
        role: "system",
        content: withVocabulary(
          "You assign concept tags to meetings. Respond only with a JSON array of short tag name strings.",
        ),
      },
      { role: "user", content: prompt },
    ], { temperature: 0.3, maxTokens: 256 })

    const raw: unknown = JSON.parse(cleanJsonResponse(response))
    if (!Array.isArray(raw)) return []
    const seen = new Set<string>()
    const tags: string[] = []
    for (const item of raw) {
      if (typeof item !== "string") continue
      const name = item.trim().replace(/\s+/g, " ")
      if (!name || name.length > 40) continue
      const key = name.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      tags.push(name)
      if (tags.length >= 5) break
    }
    return tags
  } catch {
    return []
  }
}

async function generateMeetingDigest(meeting: Meeting): Promise<string> {
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
    ])
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

/** Light AI polish of a locally assembled pre-meeting brief. */
export async function polishBrief(localMarkdown: string, title: string): Promise<string> {
  const prompt = `Polish this pre-meeting brief for "${title}". Keep all facts; tighten wording; keep Markdown structure. Do not invent attendees, actions, or meetings.

BRIEF:
${localMarkdown}`

  const response = await callDeepSeek([
    { role: "system", content: withVocabulary("You polish meeting briefs. Output Markdown only.") },
    { role: "user", content: prompt },
  ], { temperature: 0.3, maxTokens: 2048 })
  return response.trim()
}

/** Run a post-meeting recipe prompt against notes + transcript. */
export async function runRecipe(
  recipePrompt: string,
  notes: string,
  transcript: string,
  title?: string,
): Promise<string> {
  const prompt = `${recipePrompt}

MEETING TITLE: ${title || "(untitled)"}

NOTES:
${notes || "(none)"}

TRANSCRIPT:
${(transcript || "").slice(0, 20000) || "(none)"}`

  const response = await callDeepSeek([
    { role: "system", content: withVocabulary("You produce meeting follow-up artifacts. Follow the recipe exactly. Output only the artifact.") },
    { role: "user", content: prompt },
  ], { temperature: 0.4, maxTokens: 4096 })
  return response.trim()
}

export async function* streamGlobalChat(
  query: string,
  chatHistory: ChatMessage[],
  allMeetings: Meeting[],
  signal?: AbortSignal,
  opts?: { folderId?: string },
): AsyncGenerator<string> {
  let meetings = allMeetings
  if (opts?.folderId) {
    meetings = allMeetings.filter((m) => m.folderIds?.includes(opts.folderId!))
  }

  let knowledgeContext = ""
  let meetingContext = ""

  try {
    const { searchKnowledge, buildKnowledgeContextBlock } = await import("@/lib/knowledge-search")
    const results = await searchKnowledge(query, meetings, { limit: 25 })
    knowledgeContext = buildKnowledgeContextBlock(results, 4000)
  } catch { /* knowledge search optional */ }

  if (!knowledgeContext) {
    const { findRelatedMeetings, buildMemoryContextBlock } = await import("@/lib/context-memory")
    const queryMeeting: Meeting = {
      id: "__global__",
      title: query.slice(0, 100),
      date: new Date().toISOString(),
      duration: 0,
      transcript: query,
      notes: query,
    }
    const related = findRelatedMeetings(queryMeeting, meetings, 10)
    meetingContext = buildMemoryContextBlock(related, meetings, 6000)
  }

  const context = knowledgeContext || meetingContext
  const folderHint = opts?.folderId ? " Scope answers to the selected folder's meetings only." : ""

  const systemMsg = withVocabulary(`You are a helpful assistant with access to context from the user's past meetings.${folderHint} Answer questions based on this context. If the answer cannot be found in the meeting context, say so honestly. Be concise and specific. Use markdown formatting — headings, bullet points, tables, and bold for emphasis where appropriate.

${context || "(no relevant meetings found)"}

ACTIONS: When the user asks you to *change* something (not just answer), propose actions. Emit each action as its own fenced code block with the language tag "action", containing one JSON object:

Available actions:
- {"type":"update_knowledge_status","itemId":"<id>","status":"resolved"} — mark an action item or open question. itemId is the (id: …) shown next to items in the knowledge context; status is one of "open", "resolved", "superseded".
- {"type":"add_dictionary_entry","term":"<Correct Spelling>","aliases":["<common mis-hearing>"]} — teach the app a name or term so transcription always spells it right.

Rules: only propose an action when the user clearly asked for the change; never propose actions unprompted. Briefly describe each proposed action in prose right before its block. Use exact itemId values from the context — never invent ids. If the requested item isn't in the context, say you can't find it instead of guessing.

The user's question: ${query}`)

  const apiMessages = [
    { role: "system", content: systemMsg },
    ...chatHistory.map((m) => ({ role: m.role, content: m.content })),
  ]

  const { reader } = await fetchDeepSeekStream(apiMessages, { temperature: 0.7, maxTokens: 4096, signal })

  try {
    yield* parseSSEStream(reader, signal)
  } finally {
    reader.releaseLock()
  }
}
