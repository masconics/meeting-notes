# Myna Notes — Launch checklist (0.1.0)

## Before you build

- [ ] `APP_VERSION` in `src/lib/app-meta.ts` matches `package.json` and `src-tauri/tauri.conf.json` (`0.1.0`)
- [ ] Product name is **Myna Notes** in window title, onboarding, About
- [ ] Icons: `src-tauri/icons/*` and `public/myna-mark.svg`
- [ ] `yarn tsc --noEmit` and `yarn lint` clean
- [ ] Dogfood golden path on your machine (below)

## Golden path (must pass)

1. Fresh launch → onboarding completes (mic optional, ASR ready)  
2. New note → record mic (and optionally system audio) → stop → captions present  
3. Settings → AI key → **Test Connection**  
4. **Enhance** → structured notes, toast for tags, action digest if enabled  
5. Home → **Tags** filter → note appears; **Actions** / **People** non-empty when relevant  
6. Quit and reopen → note, tags, actions still there  
7. Settings → Data → Export JSON/Markdown works  
8. Calendar “Up next” shows Allow access if denied (not a silent blank)

## Build release DMG

```bash
yarn tauri:build
```

Artifact typically under `src-tauri/target/release/bundle/dmg/`.

## Signing & notarization (macOS public install)

Unsigned builds show Gatekeeper warnings. For distribution outside your Mac:

1. Apple Developer Program membership  
2. Developer ID Application certificate in Keychain  
3. Configure Tauri / `codesign` for the `.app` and nested `fluidasr` binary  
4. `xcrun notarytool submit … --wait` then `stapler staple` the DMG  
5. Test: download DMG on a **different** Mac → open without right-click bypass  

Document your exact team ID and entitlements (`src-tauri/Entitlements.plist`) in a private runbook.

## Closed beta

- [ ] Signed + notarized DMG (or TestFlight-style internal only)  
- [ ] 5–10 real meetings of use  
- [ ] Support email or form  
- [ ] Short privacy blurb on landing page (copy from Settings → About)  

## Public launch

- [ ] Landing: 3 screenshots + 30s GIF (record → enhance → tags)  
- [ ] Changelog for 0.1.0  
- [ ] “Apple Silicon / macOS 14+” requirements clear  
- [ ] Plan for updates (manual DMG is fine for 0.1; Tauri updater later)  

## Known non-blockers for 0.1

- Package/crate ids may still say `meeting-notes` (storage keys unchanged on purpose)  
- No automated E2E suite yet  
- No auto-updater yet  
- MCP is power-user only  

## Post-launch

- Minimal unit tests: dictionary protect names, tag assign/filter  
- Intel binary only if you expand support  
- Optional crash reporting (privacy review first)  
