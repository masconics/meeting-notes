import type { Person, SpeakerLabel } from "@/types"

export type SidebarPerson =
  | { kind: "speaker"; index: number; name: string; color: string }
  | { kind: "attendee"; id: string; name: string; email?: string }
  | { kind: "linked"; person: Person }

/** Speakers first, then memory links, then calendar invitees (de-duped by name). */
export function buildSidebarPeople(
  speakers: SpeakerLabel[],
  attendees: { name: string; email?: string }[] | undefined,
  linked: Person[],
): SidebarPerson[] {
  const out: SidebarPerson[] = []
  const seen = new Set<string>()

  for (let i = 0; i < speakers.length; i++) {
    const s = speakers[i]
    const key = s.name.toLowerCase()
    seen.add(key)
    out.push({ kind: "speaker", index: i, name: s.name, color: s.color })
  }
  for (const p of linked) {
    const key = p.name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ kind: "linked", person: p })
  }
  for (const a of attendees ?? []) {
    if (!a.name) continue
    const key = a.name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      kind: "attendee",
      id: `attendee-${a.email ?? a.name}`,
      name: a.name,
      email: a.email,
    })
  }
  return out
}
