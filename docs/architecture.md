# Myna Notes — Architecture

## System Overview

```mermaid
graph TB
    subgraph "macOS Desktop App"
        subgraph "WebView (React + TypeScript)"
            APP[App.tsx<br/>State + Hash Router]
            DASH[MeetingDashboard]
            EDITOR[NoteEditor<br/>ProseMirror/Milkdown]
            SETTINGS[SettingsPage]
            ONBOARD[OnboardingWizard]
            CHAT[GlobalChat / AIChatPanel]
            RECORDER[MeetingRecorder]
            WHISPER[WhisperModal]
        end

        subgraph "Tauri Rust Backend"
            LIB[lib.rs<br/>App Builder + Plugins]
            CAPTURE[capture.rs<br/>Audio Capture cpal]
            FLUID[fluid.rs<br/>Sidecar Manager]
        end

        subgraph "Native Sidecar"
            SIDECAR[fluidasr<br/>Swift + FluidAudio<br/>Parakeet v3 CoreML]
        end

        subgraph "External APIs"
            DEEPSEEK[DeepSeek API<br/>Chat Completions]
        end
    end

    subgraph "Local Storage"
        LS[localStorage]
        VAULT[Tauri Stronghold<br/>Encrypted Vault]
        SECURE[Tauri Plugin Store<br/>Secure API Key Store]
    end

    WEBVIEW["`WebView
    React 19 + TypeScript
    Vite + Tailwind v4
    shadcn/ui + Milkdown`"]

    APP --> DASH & EDITOR & SETTINGS & ONBOARD
    APP --> LS & VAULT & SECURE

    RECORDER --> CAPTURE
    WHISPER --> FLUID
    CHAT --> DEEPSEEK

    CAPTURE --> SIDECAR
    FLUID --> SIDECAR

    EDITOR --> RECORDER
    EDITOR --> WHISPER
    DASH --> CHAT

    style WEBVIEW fill:#e5f3ff
```

## Frontend Component Architecture

```mermaid
graph TB
    subgraph "App Shell"
        APP2[App.tsx<br/>State: meetings, settings, view, editorNote]
    end

    subgraph "Views"
        DASH2[MeetingDashboard]
        EDITOR2[NoteEditor]
        SETTINGS2[SettingsPage]
        ONBOARD2[OnboardingWizard]
    end

    subgraph "Editor Sub-components"
        PME[ProseMirrorEditor<br/>Milkdown Kit]
        MR[MeetingRecorder<br/>Live Transcription]
        ACP[AIChatPanel<br/>Per-Meeting AI Chat]
        NE[NoteEnhancer<br/>AI Note Generation]
        SLA[StructuredNoteView<br/>Section-based View]
        SCM[SelectionContextMenu<br/>AI Rewrite/Summarize]
        MTS[MeetingTemplateSelector]
        WM[WhisperModal<br/>Batch Transcription]
    end

    subgraph "Dashboard Sub-components"
        GC[GlobalChat<br/>Cross-Meeting AI]
        QA[QuickActions<br/>Template Actions]
    end

    subgraph "Shared UI (shadcn/ui)"
        B[Button]
        DIALOG[Dialog]
        SELECT[Select]
        BADGE[Badge]
        DROPDOWN[DropdownMenu]
        TOOLTIP[Tooltip]
        CARD[Card]
        ALERT[AlertDialog]
    end

    APP2 --> DASH2 & EDITOR2 & SETTINGS2 & ONBOARD2
    EDITOR2 --> PME & MR & ACP & NE & SLA & SCM & MTS & WM
    DASH2 --> GC & QA
    PME & MR & ACP & NE & SCM & MTS & WM & GC & QA --> B & DIALOG & SELECT & BADGE & DROPDOWN & TOOLTIP & CARD & ALERT
```

## Recording & Transcription Pipeline

```mermaid
sequenceDiagram
    participant UI as React (useRecording)
    participant Rust as Tauri Backend
    participant Mic as cpal (Microphone)
    participant Sidecar as fluidasr Sidecar
    participant Sys as ScreenCaptureKit (System Audio)

    UI->>Rust: invoke("start_continuous", { language, source })
    Rust->>Mic: Build input stream (cpal)
    Rust->>Sidecar: Spawn --stream --source
    Sidecar-->>Rust: READY
    Rust->>Sidecar: Config frame (rate, lang)

    loop Every 100ms
        Mic-->>Rust: Push mono f32 samples
        Sys-->>Sidecar: System audio frames
        Rust->>Sidecar: write_frame(f32 samples)
    end

    loop Streaming
        Sidecar-->>Rust: { confirmed, volatile }
        Rust-->>UI: event "transcript-stream"
        Sidecar-->>Rust: { rms, source }
        Rust-->>UI: event "audio-level"
    end

    UI->>Rust: invoke("stop_continuous")
    Rust->>Sidecar: Close stdin (EOF)
    Sidecar-->>Rust: Final flush + DONE
    Rust->>Mic: Drop stream
```

## AI Service Architecture

```mermaid
graph TB
    subgraph "AI Capabilities"
        TITLE[generateTitle<br/>Meeting title from content]
        NOTES[generateNotes<br/>Clean markdown notes]
        STREAM[streamGenerateNotes<br/>Streaming notes generation]
        ENHANCE[enhanceNotes<br/>Section-by-section JSON]
        BRIEF[generateBrief<br/>Pre-meeting brief w/ past context]
        QA2[executeQuickAction<br/>Template action answers]
        CHAT2[streamChatResponse<br/>Per-meeting AI chat]
        GLOBAL[streamGlobalChat<br/>Cross-meeting search]
        SPEAKER[detectSpeakers<br/>Extract participant names]
        DIGEST[generateMeetingDigest<br/>Semantic digest for indexing]
    end

    subgraph "Context Memory"
        INDEX[indexMeeting<br/>TF-IDF tokenize + store]
        FIND[findRelatedMeetings<br/>Cosine similarity ranking]
        BUILD[buildMemoryContextBlock<br/>Format context for prompts]
    end

    subgraph "Transport"
        DS[callDeepSeek<br/>fetch → api.deepseek.com]
        STORE2[Secure API Key Store]
    end

    TITLE --> DS
    NOTES --> DS
    STREAM --> DS
    ENHANCE --> DS
    BRIEF --> DS & FIND & BUILD
    QA2 --> DS & FIND & BUILD
    CHAT2 --> DS & FIND & BUILD
    GLOBAL --> DS & FIND & BUILD
    SPEAKER --> DS
    DIGEST --> DS --> INDEX
    DS --> STORE2
```

## Storage Architecture

```mermaid
graph LR
    subgraph "Write Path"
        W1[saveMeetings] --> L1[localStorage.setItem]
        W1 --> P1[Stronghold dbSet]
        W2[saveSettings] --> L2[localStorage.setItem]
        W2 --> P2[Stronghold dbSet]
        W3[saveAISettings] --> L3[localStorage.setItem]
        W3 --> P3[Stronghold dbSet]
        W4[saveApiKey] --> P4[Tauri Plugin Store]
        W5[saveTemplates] --> L5[localStorage.setItem]
        W5 --> P5[Stronghold dbSet]
        W6[saveMemory] --> L6[localStorage.setItem]
        W6 --> P6[Stronghold dbSet]
    end

    subgraph "Read Path (Startup)"
        V[Stronghold Vault] -->|dbGet all keys| L7[localStorage.setItem]
        L7 --> R1[loadMeetings]
        L7 --> R2[loadSettings]
        L7 --> R3[loadAISettings]
        L7 --> R4[loadTemplates]
        L7 --> R5[loadMemory]
    end

    subgraph "Read Path (Runtime)"
        R1B[loadMeetings] --> LS2[localStorage.getItem]
        R2B[loadSettings] --> LS2
        R3B[loadAISettings] --> LS2
        R4B[loadApiKey] --> PS2[Tauri Plugin Store]
        R5B[loadTemplates] --> LS2
    end

    style V fill:#fff3cd
    style PS2 fill:#fff3cd
    style P4 fill:#fff3cd
```

## Backend Invoke Commands

```mermaid
graph LR
    subgraph "Tauri Commands (invoke_handler)"
        C1[start_continuous<br/>language, source]
        C2[stop_continuous]
        C3[transcribe_audio_fluid<br/>audioData, language]
        C4[check_fluid_ready]
        C5[setup_fluid]
        C6[unload_fluid]
        C7[fluid_loaded]
        C8[check_screen_permission]
        C9[request_screen_permission]
    end

    subgraph "Tauri Plugins"
        P_OPENER[opener]
        P_STORE[store]
        P_DIALOG[dialog]
        P_FS[fs]
        P_LOG[log]
        P_STRONGHOLD[stronghold]
        P_SINGLE[single-instance]
        P_WINDOW[window-state]
    end

    C1 --> capture.rs
    C2 --> capture.rs
    C3 --> fluid.rs
    C4 --> fluid.rs
    C5 --> fluid.rs
    C6 --> fluid.rs
    C7 --> fluid.rs
    C8 --> fluid.rs
    C9 --> fluid.rs
```

## Data Model

```mermaid
erDiagram
    Meeting {
        string id PK
        string title
        string date
        number duration
        string transcript
        string notes
        string templateId FK
        MeetingSection[] structuredNotes
        string enhancedNotes
        ChatMessage[] chatHistory
        SpeakerLabel[] speakerLabels
        TranscriptSegment[] transcriptSegments
        string brief
        string memoryDigest
        string memoryIndexedAt
    }

    MeetingTemplate {
        string id PK
        string name
        string icon
        string[] sections
        QuickAction[] quickActions
    }

    MemoryEntry {
        string meetingId FK
        string digest
        Record~string,number~ tf
        string indexedAt
    }

    AppSettings {
        string audioSource
        string preferredDeviceId
        string speechLang
        string titlePrefix
        string theme
    }

    AISettings {
        string apiKey
        string model
        boolean enabled
    }

    Meeting ||--o| MeetingTemplate : uses
    Meeting ||--o| MemoryEntry : indexed-as
```

## File Map

```
meeting-notes/
├── src/                          # React frontend
│   ├── App.tsx                   # Root state, hash routing, view switching
│   ├── main.tsx                  # React DOM entry point
│   ├── types.ts                  # All TypeScript interfaces & constants
│   ├── index.css                 # Tailwind v4 imports
│   ├── components/
│   │   ├── meeting-dashboard.tsx # Meeting list, search, sort, global chat
│   │   ├── note-editor.tsx       # Editor shell (recorder + prose + chat)
│   │   ├── ProseMirrorEditor.tsx # Milkdown/ProseMirror markdown editor
│   │   ├── meeting-recorder.tsx  # Live recording UI + controls
│   │   ├── ai-chat-panel.tsx     # Per-meeting AI chat sidebar
│   │   ├── global-chat.tsx       # Cross-meeting AI search
│   │   ├── note-enhancer.tsx     # AI note generation dialog
│   │   ├── structured-note-view.tsx # Section-based note display
│   │   ├── selection-context-menu.tsx # AI rewrite/summarize selection
│   │   ├── whisper-modal.tsx     # Batch audio transcription
│   │   ├── settings-page.tsx     # Settings UI
│   │   ├── onboarding-wizard.tsx # First-run setup
│   │   ├── meeting-detail-page.tsx # Detailed meeting view
│   │   ├── meeting-template-selector.tsx # Template picker
│   │   ├── template-editor.tsx   # Template creation/editing
│   │   ├── confirm-dialog.tsx    # Reusable confirmation dialog
│   │   ├── quick-actions.tsx     # Template-defined AI prompts
│   │   ├── Waveform.tsx          # Audio level visualization
│   │   ├── note-renderer.tsx     # Markdown renderer
│   │   ├── markdown-view.tsx     # Raw markdown viewer
│   │   ├── chat-page.tsx         # Chat interface wrapper
│   │   ├── template-icon.tsx     # Template icon component
│   │   └── ui/                   # shadcn/ui primitives
│   ├── lib/
│   │   ├── storage.ts            # CRUD for meetings, settings, memory (localStorage + Stronghold)
│   │   ├── ai-service.ts         # DeepSeek API calls (generate, enhance, chat, brief, etc.)
│   │   ├── context-memory.ts     # TF-IDF + cosine similarity meeting search
│   │   ├── use-recording.ts      # Live recording hook (Tauri events + stream merge)
│   │   ├── use-whisper.ts        # Batch transcription hook (MediaRecorder + fluid)
│   │   ├── use-chat.ts           # AI chat state management
│   │   ├── use-theme.ts          # Light/dark/system theme hook
│   │   ├── use-audio-devices.ts  # Audio device detection
│   │   ├── use-permissions.ts    # Screen/mic permission check
│   │   ├── stream-transcript.ts  # Stream merge/consume helpers for dual-source
│   │   ├── stronghold.ts         # Tauri Stronghold wrapper (dbGet/dbSet/dbRemove)
│   │   ├── export.ts             # Meeting export utilities
│   │   ├── templates.ts          # Template CRUD helpers
│   │   ├── onboarding.ts         # Onboarding state
│   │   └── utils.ts              # General utilities (cn, etc.)
│   └── assets/                   # Static assets
├── src-tauri/                    # Rust backend
│   ├── Cargo.toml                # Dependencies (tauri, cpal, tokio, etc.)
│   ├── tauri.conf.json           # App config, bundle, CSP, external binary
│   ├── src/
│   │   ├── main.rs               # Rust entry point
│   │   ├── lib.rs                # Tauri builder, plugins, tray, command registration
│   │   ├── capture.rs            # Audio capture (cpal mic) + stream processing
│   │   └── fluid.rs              # fluidasr sidecar lifecycle + batch transcription
│   ├── binaries/fluidasr         # Compiled Swift sidecar (bundled)
│   ├── capabilities/default.json # Tauri permission capabilities
│   └── icons/                    # App icons
├── fluid-sidecar/                # Swift sidecar source
│   ├── Package.swift             # Swift package (FluidAudio dependency)
│   └── Sources/fluidasr/         # Sidecar source code
├── scripts/process.ts            # Build/utility scripts
├── vite.config.ts                # Vite config (React + Tailwind)
├── tsconfig.json                 # TypeScript config
└── package.json                  # Node dependencies & scripts
```
