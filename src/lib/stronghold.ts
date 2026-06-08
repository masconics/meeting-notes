import { Stronghold, Client, Store } from "@tauri-apps/plugin-stronghold"
import { appDataDir } from "@tauri-apps/api/path"

const CLIENT_NAME = "meeting-notes"
const VAULT_PASSWORD = "meeting-notes-vault-key-2026"

let store: Store | null = null
let stronghold: Stronghold | null = null
let initPromise: Promise<void> | null = null

export async function initDatabase(): Promise<void> {
  if (store) return
  if (initPromise) return initPromise

  initPromise = (async () => {
    const vaultPath = `${await appDataDir()}vault.hold`

    stronghold = await Stronghold.load(vaultPath, VAULT_PASSWORD)

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
