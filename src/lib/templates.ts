import type { MeetingTemplate } from "@/types"
import { loadTemplates, saveTemplates } from "@/lib/storage"

export const DEFAULT_TEMPLATES: MeetingTemplate[] = [
  {
    id: "customer-discovery",
    name: "Customer Discovery",
    icon: "UserSearchIcon",
    sections: [
      "About Them",
      "Current Situation",
      "Pain Points",
      "Budget & Timeline",
      "Decision Criteria",
      "Key Takeaways",
      "Next Steps",
    ],
    quickActions: [
      { label: "What's their budget?", icon: "DollarCircleIcon", prompt: "What is their budget and timeline?" },
      { label: "List objections", icon: "AlertCircleIcon", prompt: "What objections or concerns did they raise?" },
      { label: "Write follow-up email", icon: "Mail01Icon", prompt: "Write a concise follow-up email summarizing our call and suggesting next steps." },
      { label: "List action items", icon: "Task01Icon", prompt: "List all action items from the meeting with owners if mentioned." },
    ],
  },
  {
    id: "one-on-one",
    name: "1-on-1",
    icon: "UserIcon",
    sections: [
      "Personal Check-in",
      "Wins & Highlights",
      "Challenges & Blockers",
      "Goals & Progress",
      "Growth & Development",
      "Action Items",
    ],
    quickActions: [
      { label: "List action items", icon: "Task01Icon", prompt: "List all action items and to-dos from this 1-on-1." },
      { label: "Summarize decisions", icon: "NoteIcon", prompt: "Summarize key decisions made during this conversation." },
      { label: "Growth areas", icon: "StarIcon", prompt: "What growth areas or development opportunities were discussed?" },
    ],
  },
  {
    id: "user-interview",
    name: "User Interview",
    icon: "Comment01Icon",
    sections: [
      "Participant Background",
      "Current Workflow",
      "Pain Points",
      "Feature Requests",
      "Quotes & Soundbites",
      "Key Insights",
      "Follow-up Questions",
    ],
    quickActions: [
      { label: "Key quotes", icon: "QuotesIcon", prompt: "Extract the most revealing direct quotes from the participant." },
      { label: "Feature requests", icon: "IdeaIcon", prompt: "List all feature requests and enhancement ideas mentioned." },
      { label: "Pain points summary", icon: "AlertCircleIcon", prompt: "Summarize the participant's main pain points." },
    ],
  },
  {
    id: "pitch",
    name: "Pitch / Sales",
    icon: "PresentationIcon",
    sections: [
      "Company Overview",
      "Current Needs",
      "Budget & Authority",
      "Timeline",
      "Competition",
      "Objections Raised",
      "Next Steps",
    ],
    quickActions: [
      { label: "Write follow-up email", icon: "Mail01Icon", prompt: "Write a compelling follow-up email that addresses their needs and suggests next steps." },
      { label: "List objections", icon: "AlertCircleIcon", prompt: "What objections or concerns were raised during the pitch?" },
      { label: "What's their budget?", icon: "DollarCircleIcon", prompt: "What budget information and purchasing authority was discussed?" },
    ],
  },
  {
    id: "standup",
    name: "Standup",
    icon: "DashboardCircleIcon",
    sections: [
      "Yesterday's Progress",
      "Today's Plan",
      "Blockers",
      "Announcements",
      "Action Items",
    ],
    quickActions: [
      { label: "List action items", icon: "Task01Icon", prompt: "List all action items mentioned in this standup." },
      { label: "List blockers", icon: "AlertCircleIcon", prompt: "What blockers were raised and who is working on resolving them?" },
      { label: "Today's summary", icon: "NoteIcon", prompt: "Summarize what everyone is working on today." },
    ],
  },
]

export function getDefaultTemplates(): MeetingTemplate[] {
  return DEFAULT_TEMPLATES
}

export function getTemplates(): MeetingTemplate[] {
  const saved = loadTemplates()
  if (saved.length > 0) return saved
  return DEFAULT_TEMPLATES
}

export function saveTemplate(template: MeetingTemplate): void {
  const templates = getTemplates()
  const idx = templates.findIndex((t) => t.id === template.id)
  if (idx >= 0) {
    templates[idx] = template
  } else {
    templates.push(template)
  }
  saveTemplates(templates)
}

export function deleteTemplate(id: string): void {
  const templates = getTemplates().filter((t) => t.id !== id)
  saveTemplates(templates)
}

export function getTemplateById(id: string): MeetingTemplate | undefined {
  return getTemplates().find((t) => t.id === id)
}
