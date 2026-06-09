const STORAGE_KEY = "meeting-notes-onboarding-complete"

export function isOnboardingComplete(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "true"
  } catch {
    return false
  }
}

export function markOnboardingComplete(): void {
  try {
    localStorage.setItem(STORAGE_KEY, "true")
  } catch {
    // localStorage may be unavailable
  }
}
