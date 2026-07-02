import { Stronghold, Client, Store } from "@tauri-apps/plugin-stronghold"
import { appDataDir } from "@tauri-apps/api/path"

const CLIENT_NAME = "meeting-notes"
const VAULT_PASSWORD_KEY = "vault-password"

let store: Store | null = null
let stronghold: Stronghold | null = null
let initPromise: Promise<void> | null = null

function generatePassword(): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*"
  let result = ""
  const buf = new Uint32Array(64)
  crypto.getRandomValues(buf)
  for (let i = 0; i < 64; i++) {
    result += chars[buf[i] % chars.length]
  }
  return result
}

async function getOrCreatePassword(): Promise<string> {
  try {
    const { load } = await import("@tauri-apps/plugin-store")
    const secureStore = await load("meeting-notes-secure.json", { defaults: {}, autoSave: true })
    const existing = await secureStore.get<string>(VAULT_PASSWORD_KEY)
    if (existing) return existing
    const newPass = generatePassword()
    await secureStore.set(VAULT_PASSWORD_KEY, newPass)
    return newPass
  } catch {
    return generatePassword()
  }
}

export async function initDatabase(): Promise<void> {
  if (store) return
  if (initPromise) {
    try { await initPromise } catch { initPromise = null }
    if (store) return
  }
  if (initPromise) return initPromise

  initPromise = (async () => {
    const vaultPath = `${await appDataDir()}vault.hold`
    const password = await getOrCreatePassword()

    stronghold = await Stronghold.load(vaultPath, password)

    let client: Client
    try {
      client = await stronghold.loadClient(CLIENT_NAME)
    } catch {
      client = await stronghold.createClient(CLIENT_NAME)
    }

    store = client.getStore()
  })()

  return initPromise
}

export async function dbGet(key: string): Promise<string | null> {
  await initDatabase()
  if (!store) return null
  try {
    const data = await store.get(key)
    if (!data) return null
    return new TextDecoder().decode(data)
  } catch {
    return null
  }
}

export async function dbSet(key: string, value: string): Promise<void> {
  await initDatabase()
  if (!store) return
  const data = Array.from(new TextEncoder().encode(value))
  await store.insert(key, data)
  await stronghold!.save()
}

export async function dbRemove(key: string): Promise<void> {
  await initDatabase()
  if (!store) return
  await store.remove(key)
  await stronghold!.save()
}
