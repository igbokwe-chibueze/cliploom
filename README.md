
# Cliploom

A working local, single-user prototype for turning spoken videos into reviewed,
captioned clips. Next.js App Router + TypeScript + Tailwind + shadcn/ui primitives;
Prisma 7 / SQLite; local filesystem storage; a separate TypeScript worker; Groq
transcription and Gemini transcript-based selection. No account or authentication
is implemented. Keep the app on loopback. Authentication and authorization are
required before any public deployment.

## Windows setup (PowerShell / VS Code)

Prerequisites: Node.js **22.12+** (Node 24 LTS recommended), npm, and a modern
browser. Run commands from the project root, including when using VS Code tasks.
Use `npm.cmd` / `npx.cmd` if PowerShell blocks the `.ps1` wrappers.

```powershell
npm.cmd install
# Only create .env if you do not already have one:
if (!(Test-Path .env)) { Copy-Item .env.example .env }
npm.cmd run db:setup
npm.cmd run doctor
npm.cmd run dev
```

Open **http://localhost:3000**. `dev` starts web and worker together; Ctrl+C stops
both. The checked-in example defaults to **AI_MODE=fixture**, which makes no AI
calls. The local .env is ignored by Git. Existing .env files are never overwritten.

FFmpeg and ffprobe development binaries are installed as dev dependencies and
selected automatically when paths are blank. `doctor` verifies H.264, AAC, and
libass subtitle support. To use a current system build instead, install FFmpeg:

```powershell
winget install --id Gyan.FFmpeg --exact
# Restart your VS Code terminal so PATH refreshes, then configure:
# FFMPEG_PATH=ffmpeg
# FFPROBE_PATH=ffprobe
npm.cmd run doctor
```

Or set full absolute paths in `.env`, e.g.
`FFMPEG_PATH="C:/Tools/FFmpeg/bin/ffmpeg.exe"` and the corresponding ffprobe path.
Paths with spaces are supported. The bundled binaries are for local development;
maintain a current FFmpeg build when processing real untrusted footage.

If native dependency setup was skipped, run
`npm.cmd rebuild better-sqlite3 esbuild @prisma/engines ffmpeg-static`.
The `allowScripts` list in package.json explicitly permits required native setup.

## First upload

1. Leave `AI_MODE=fixture` to test without keys. The persistent Fixture indicator
   explains that transcripts and suggestions are synthetic, not analysis of speech.
2. Run `npm.cmd run fixture:create` to create a 12-second colour-pattern video
   with a tone at `tests/fixtures/source video.mp4`, or use your own spoken video.
3. Select the file, choose up to ten suggestions (default five), then upload.
   Transfer progress measures uploaded bytes. Validation and all heavy processing
   run in the worker. Keep it running; projects and jobs survive browser restarts.
4. Review suggested intervals, replay and seek the low-resolution MP4 preview,
   adjust start/end seconds, original/portrait framing, horizontal crop, caption
   preset, size, colour, position, text, and cue timings.
5. Save edits, then export the chosen clip. Export also saves unsaved changes.
   Download appears only when the worker verifies and completes the MP4.
6. Delete a project to remove source, preview, cached transcript, suggestions, and
   exports. Active work is cancelled first; cleanup completes in the worker.

Fixture mode intentionally produces one synthetic suggestion. Fixture captions
will not match your uploaded video's speech. No API keys are needed for the actual
FFmpeg preview/render/export workflow in this mode.

## Enable live providers

Set these **server-side** values in `.env` and restart both processes:

```dotenv
AI_MODE=live
GROQ_API_KEY=your_groq_key
GEMINI_API_KEY=your_gemini_key
TRANSCRIPTION_MODEL=whisper-large-v3-turbo
CLIP_SELECTION_MODEL=gemini-2.5-flash-lite
```

Never use `NEXT_PUBLIC_` for keys or paste keys into chat. The worker transmits
extracted audio to Groq and compact timestamped transcript text to Gemini. Videos
and final renders stay local. Consult provider policies for your account's data
handling. Fixture projects remain fixture projects after changing AI_MODE; create
a new project for live processing.

Official documentation checked during implementation:

- [Groq speech-to-text](https://console.groq.com/docs/speech-to-text):
  `whisper-large-v3-turbo`, verbose JSON, word + segment timestamps, 25 MB direct
  attachment limit. Extracted mono 16 kHz WAV chunks use a conservative 24 MB cap.
- [Google model availability](https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-lite):
  Gemini 2.5 Flash-Lite remains listed, but access is restricted to prior users of
  the 2.5 models. New accounts may be denied. The app never silently substitutes
  another model. Choose a different model only explicitly in your environment,
  after checking its availability and pricing.
- [Google structured output](https://ai.google.dev/gemini-api/docs/structured-output):
  current `@google/genai` SDK, JSON schema output plus application validation.
- [Prisma SQLite](https://www.prisma.io/docs/orm/v7/core-concepts/supported-databases/sqlite):
  generated client with the better-sqlite3 adapter.

No live provider call was used to validate this prototype. Model access and
transcription quality must be checked with your own credentials and a bounded
spoken sample. Missing keys fail clearly; they never activate fixture output.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Web + watching worker, coordinated shutdown |
| `npm run dev:web` | Next.js only, bound to localhost |
| `npm run dev:worker` | Watching worker only |
| `npm run worker` | Worker without file watching |
| `npm run db:setup` | Apply committed migrations and generate Prisma client |
| `npm run db:migrate -- --name change_name` | Create a development migration |
| `npm run doctor` | Check FFmpeg/ffprobe capabilities and local paths |
| `npm run lint` | ESLint |
| `npm run typecheck` | Generate Next.js types and check all TypeScript |
| `npm test` | Focused domain and isolated SQLite queue tests |
| `npm run fixture:create` | Generate a synthetic video, without AI calls |
| `npm run test:e2e` | Fixture upload-to-download test; web + worker must run |
| `npm run build` | Generate Prisma client and build Next.js |
| `npm start` | Serve built web app on localhost; run worker separately |

For E2E testing, run `npm run dev` in one terminal and `npm run test:e2e` in
another, with AI_MODE=fixture in both. It generates a synthetic video with a path
containing spaces, uploads it through HTTP, waits for the worker, corrects captions,
requests the same render twice, verifies one render ID, downloads the export,
probes dimensions/duration/audio, decodes every frame, checks byte-range delivery,
checks cross-origin mutation rejection, verifies the original transcript remained
unchanged, and deletes its project. Test artifacts remain at `data/e2e/` for manual
playback, including `caption preview.png`. Tests do not reset your database.

## Data and configuration

Both processes load `.env.local` then `.env` without overriding explicit process
variables. Relative paths resolve from the project root. Do not launch the worker
from another working directory.

| Setting | Default / meaning |
| --- | --- |
| `DATABASE_URL` | `file:./data/cliploom.db`; SQLite file |
| `MEDIA_STORAGE_DIR` | `./data/media`; outside public/ |
| `LOCAL_ORIGIN` | `http://localhost:3000`; mutation origin and port check |
| `MAX_UPLOAD_MB` | 1024; enforced while streaming, even without Content-Length |
| `MAX_DURATION_MINUTES` | 120; enforced by ffprobe |
| `CLIP_COUNT` | 5; per-upload override 1–10 |
| `AUDIO_CHUNK_SECONDS` | 300; one-second overlap; configurable 15–600 |
| `PROVIDER_MAX_FILE_MB` | 24; never above the 25 MB direct attachment cap |
| `JOB_MAX_ATTEMPTS` | 3; bounded transient retry/recovery |
| `JOB_LEASE_SECONDS` | 90; heartbeat every two seconds |
| `FFMPEG_PATH`, `FFPROBE_PATH` | Blank: bundled dev binaries, otherwise PATH |

Uploads are stored as internal IDs under `data/media/<project-id>/`, never using
a supplied filename as a path. `source.*` is the original; `preview.mp4` is a
low-resolution source preview; `transcript/chunk-*.json` caches completed chunks;
`selection-*.json` caches selections, provenance, and available usage;
`renders/*.mp4` contains chosen exports. Temporary audio/subtitles/partial renders
are removed after work completes or fails. Interrupted upload files are swept
after 24 hours by the worker. All data, DB files/sidecars, and generated clients
are ignored. If changing storage to another folder inside the repository, add
that location to .gitignore too. Back up the DB and media directory together.

## Reliability and editing behavior

- SQLite jobs are claimed with compare-and-set updates; a single-worker lease
  prevents a second active worker. A restart recovers expired running jobs after
  the lease period, using saved transcript chunks and selections. Persistent
  idempotency keys deduplicate processing and clip/revision exports.
- Original transcript JSON is immutable. Caption edits live in clip settings and
  a separate edited transcript. Editing never calls Groq. Export specifications
  capture a clip revision; old jobs cannot replace newer revisions.
- Selection uses compact sentence/segment units, structured segment IDs, source
  bounds and overlap validation, and one bounded repair attempt. Long transcripts
  are analyzed in bounded windows. Purely visual highlights can be missed.
- Retry buttons reuse durable stages. Temporary provider failures get bounded
  exponential backoff/jitter and Retry-After support. Auth, model access, and quota
  failures require intervention. Explicit regeneration reuses transcription but
  calls selection again and replaces current clip edits.
- Browser preview and ASS export share crop geometry, colour, relative font size,
  safe margins and cue rebasing. Arial is used on Windows; another OS may need an
  Arial-compatible font. Browser/libass line wrapping and outlines can differ
  slightly. Corrected or retimed cues use phrase captions, rather than inventing
  word alignment. Word-highlight colour is yellow. Output is capped at 720px wide
  / 1280px high without upscaling. 9:16 geometry is rounded to even encoder pixels.
- Source rotation is normalized by FFmpeg and reflected in probe dimensions.
  Export is H.264/AAC, yuv420p, fast-start MP4. Audio is required. Manual crop is
  implemented; face tracking is not. Source preview can take time on long videos.
- A deleted active project remains tombstoned until the worker has aborted its
  work and removed files. If the worker is stopped, restart it to finish cleanup.
  Cancellation aborts provider requests and terminates FFmpeg.

This is explicitly a single-user local prototype. SQLite, filesystem storage,
and a persistent local worker cannot be moved unchanged to a static or
serverless-only deployment. No billing, social publishing, URL ingestion, advanced
tracking, or authentication is included.

## Troubleshooting

- **Queued indefinitely:** run the worker in a separate terminal to see startup
  errors, then `npm run doctor`. A crashed worker lease expires automatically.
- **Database unavailable:** run `npm run db:setup` from this directory. Setup
  safely creates a missing SQLite file and applies migrations without resetting
  existing data; this also avoids a Windows Prisma missing-file engine error.
- **Provider denied / model unavailable:** verify keys locally and your account's
  model permissions. Gemini 2.5 may be unavailable to a new account. No paid model
  fallback occurs. Retry after fixing configuration.
- **Timing edit rejected:** cue times must be ordered, non-overlapping, and within
  source duration. Clip intervals must be positive and no longer than 180 seconds.
- **Media failure:** check FFmpeg capabilities, try a shorter valid video with an
  audio track, and use Retry. Render failures do not transcribe the source again.
- **Port change:** set LOCAL_ORIGIN to the same loopback port and use
  `npm run dev:web -- --port 3001`; run the worker separately. Do not bind publicly.

Dependency audit at implementation time: npm reports nine high-severity entries
in Prisma CLI / Next.js ESLint development-tool dependency chains. Its proposed
fixes downgrade major versions; these are unresolved. No forced downgrade or
untested dependency override was applied.

Caption overlap handling: inherited transcription overlaps are normalized in the
editable caption copy by ending the earlier cue at the next cue's start. The
original transcript is untouched. Retimed cues use phrase captions. Ordering is
validated for the selected clip; unrelated overlaps outside it do not block saving.
Manual timing mistakes in the selected interval still require correction.
