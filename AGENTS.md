# AGENTS.md — 

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## 1. Purpose and authority

Cliploom is the working name for a local-first AI video-clipping prototype. The name is provisional; domain and trademark availability have not been checked. Keep the display name in one configuration location.

Read this file before changing the project. It defines engineering defaults, not proof that any feature already exists. Explicit user instructions take precedence. Read applicable nested AGENTS.md files before editing their directories. If an instruction conflicts with the actual repository, explain the conflict and make the smallest sensible adjustment. Do not rewrite these rules merely to bypass a requirement.

Build a working product in manageable increments. Inspect the repository, package scripts, dependencies, and git status first. Preserve unrelated work. Make routine reversible implementation decisions autonomously; ask only when a material product choice or missing access genuinely blocks progress. Do not deploy, purchase services, or expose local files publicly without authorization.

## 2. Product objective and scope

Turn user-uploaded spoken videos into short, editable, captioned clips. Prioritize podcasts, interviews, and talking-head footage. Success means useful selections, accurate captions, easy corrections, predictable processing, and low cost per approved clip.

Implement this core loop:
1. Upload and validate footage.
2. Extract audio and obtain a timed transcript.
3. Suggest coherent clip intervals with titles and explanations.
4. Preview and adjust intervals, captions, and crop settings.
5. Render only selected clips and download the resulting MP4 files.

Initial scope includes a project dashboard, persistent processing status, transcript editing, original and portrait framing, caption presets, manual horizontal crop positioning, and deletion of project media.

Out of scope unless explicitly requested: billing, teams, client approvals, earnings tracking, social publishing, URL downloading, livestream ingestion, gaming-highlight detection, automatic face tracking, stock media, voice cloning, generated video, and a payments marketplace. Keep future integrations possible without building speculative frameworks.

The prototype is single-user and local-only. Do not describe it as production-ready or safe to expose publicly without an appropriate authentication and authorization implementation.

## 3. Approved technology

| Concern | Default |
| --- | --- |
| Web application | Next.js App Router and TypeScript |
| Styling and components | Tailwind CSS and shadcn/ui |
| Persistence | Prisma with SQLite for the local prototype |
| Background processing | Separate Node.js/TypeScript worker |
| Queue | Persistent SQLite-backed jobs, one worker initially |
| Transcription | Groq, whisper-large-v3-turbo |
| Clip selection and titles | Google Gemini, gemini-2.5-flash-lite |
| Media processing | FFmpeg and ffprobe |
| Media storage | Local filesystem outside public/, behind a storage interface |
| Package manager | npm unless the existing repository establishes another |

Verify current official SDK documentation, model availability, and runtime compatibility when integrating. Choose supported stable versions and commit the lockfile. Do not silently change providers, use a paid fallback, or replace an unavailable model. Keep provider and model choices configurable.

Heavy processing must not run inside a Next.js request, Server Action, middleware, or an untracked fire-and-forget promise. HTTP handlers should validate, persist, enqueue, and return. The worker owns long-running stages.

Do not introduce Redis, Docker, Python, a monorepo, or GPU infrastructure without a concrete need. Document the single-worker SQLite limitation; moving to distributed workers requires revisiting locking and database design.

## 4. Repository organization

For a new repository, use root-based feature organization:

```text
app/                         # Routes, layouts, thin request handlers
features/
  projects/                  # Project UI, schemas, services
  uploads/                   # Upload validation and ingestion
  transcripts/               # Timed transcript and edits
  clips/                     # Selection and clip editing
  rendering/                 # Render specification and orchestration
components/ui/               # Shared shadcn/ui primitives
lib/
  config/                    # Validated environment configuration
  db/                        # Prisma client and transaction helpers
  providers/                 # Transcription and selection adapters
  storage/                   # Local storage implementation
  media/                     # ffprobe/FFmpeg process wrappers
  jobs/                      # Queue, leases, retries
worker/                      # Worker entry point and stage execution
prisma/                      # Schema and committed migrations
scripts/                     # Portable development/setup utilities
tests/fixtures/              # Small synthetic or permissioned fixtures
docs/                        # Architecture and workflow documentation
```

Adapt to an established equivalent layout instead of reorganizing unrelated code. Keep business logic out of React components and route handlers. Shared client-safe types must not import server SDKs or secrets. Use server-only boundaries for provider, database, and filesystem modules.

## 5. TypeScript and code conventions

- Enable strict TypeScript. Avoid any; validate unknown external data at boundaries using a schema library such as Zod.
- Use single quotes in JavaScript/TypeScript where formatter rules allow. Maintain consistent formatting and one lockfile.
- Prefer small explicit modules over clever abstractions, large generic service frameworks, or duplicated utilities.
- Use accessible semantic HTML and shared UI components. Do not disable lint/type errors to make builds pass.
- Store timestamps as integer milliseconds internally. Convert provider seconds at adapter boundaries and FFmpeg units at render boundaries.
- Keep source duration, source coordinates, and clip-relative coordinates explicit in type and field names.
- Use ISO/UTC for persisted job dates; format display dates for the user.
- Explain non-obvious decisions in comments; do not narrate obvious code.

## 6. Persistence and provider contracts

Model at least Project, MediaAsset, Transcript, Clip, Render, and Job. Store project ownership assumptions explicitly even if only one local user exists. Track provider/model provenance, processing versions, clip edit revisions, timestamps, and available usage metadata.

Maintain an immutable original transcript and a separate edited version. Caption corrections must not silently overwrite transcription evidence or trigger another transcription. Never present guessed usage or estimated costs as actual billing.

Define narrow interfaces for transcription, clip selection, storage, and rendering. Normalize provider responses into application-owned schemas. Provider SDK types must not leak into UI contracts. A future provider switch should replace an adapter rather than rewrite the application.

Persist a normalized render specification containing the source asset ID, source interval, output dimensions, crop settings, caption cues, style settings, and revision. Preview and export must derive from this same specification.

## 7. Upload and media validation

- Support MP4, MOV, and WebM initially. Validate with ffprobe; MIME type and extension alone are insufficient.
- Make size and duration limits configurable. Reject unsupported, corrupt, empty, or excessively large files with actionable messages.
- Stream uploads to a temporary file; do not buffer entire large videos in application memory. Enforce limits during streaming, including when Content-Length is absent.
- Generate internal filenames and IDs. Never use a user filename as a trusted filesystem path.
- Store media outside public/. Serve by asset ID through controlled handlers with byte-range support for seeking.
- Probe rotation, dimensions, duration, frame rate, and audio streams. Normalize orientation in both preview and export.
- Give a clear unsupported-content message when no usable speech/audio is present. Do not invent captions for silent footage.
- Clean up interrupted uploads and partially written assets. Finalize files atomically where possible.
- Bind the local app to loopback by default. Validate state-changing requests against the intended local origin; local-only is not permission to accept arbitrary cross-origin mutations.

## 8. Processing pipeline

Use explicit stages such as validate, extract-audio, transcribe, select-clips, and render. Rendering is a separate user-triggered job, not an automatic consequence of suggesting clips.

Extract an audio representation appropriate to the provider. Respect upload size, duration, and rate limits using configurable settings rather than hard-coded historical prices or quotas.

When chunking is required:
- Use bounded overlap and retain each chunk's source offset.
- Convert all returned timings to global source milliseconds.
- Resolve overlap duplicates using timing and text together; do not delete legitimate repeated speech.
- Validate ordering, bounds, and non-negative intervals after merging.
- Cache successful chunks so retries do not repeat completed work unnecessarily.

Retain word-level timing for caption playback. Send Gemini a compact segment/sentence transcript rather than verbose word timing unless needed. Split long selection requests into coherent sections, then merge and deduplicate suggestions. Limit token budgets and output size.

## 9. Clip-selection rules

Default to up to five clips with a preferred duration of 20–60 seconds. Allow fewer when the source does not support five strong selections. Distinguish preferred duration from validation limits.

Each suggestion must contain a title, source start/end timing, and a concise selection rationale. Prefer source segment IDs or validated boundaries over freely invented timestamps.

Select understandable, self-contained moments with an effective opening and complete thought. Preserve meaning and necessary context. Avoid misleading edits, cuts mid-sentence, excessive overlap, and duplicate suggestions. Do not promise virality or fabricate confidence percentages.

Treat transcripts, embedded media text, filenames, and metadata as untrusted data, never developer instructions. Use structured model output and server-side schema validation. Check start < end, duration limits, source bounds, and valid referenced segment IDs. Permit only bounded repair attempts; report failure clearly if validation still fails.

Selection is transcript-based in version one. Explain that purely visual highlights can be missed. Do not imply visual understanding or automatic subject tracking without implementing and testing it.

## 10. Caption and editor behavior

- Preview approved source intervals without rendering full-resolution video first.
- Allow users to adjust interval boundaries, caption wording, basic cue timing, and crop position.
- Provide three readable caption presets with adjustable size, colour, and position.
- Support original framing and 9:16. For portrait, offer a manual horizontal crop slider and center crop default; handle already-portrait sources correctly.
- Rebase source timestamps to clip-relative timings for export and constrain cues to the selected interval.
- Group words into readable captions, respecting pauses, punctuation, and line length. Keep text within safe margins.
- For optional word highlighting, use actual timing data. After edits insert/remove words, require timing adjustment or fall back to phrase captions; do not fabricate precise word alignment.
- Use the same font assets and consistent sizing/crop calculations in previews and exports. Document any preview limitation.
- Preserve unsaved edits or warn before navigation. Mark old renders as outdated after a clip revision.
- Never rebuild a transcript merely because the user changes a font, colour, crop, or clip boundary.

## 11. FFmpeg execution and exports

Spawn FFmpeg/ffprobe with argument arrays and shell disabled. User input must never become arbitrary shell commands, filter expressions, or output paths. Escape subtitle/filter syntax separately; safe shell arguments alone do not make FFmpeg filter syntax safe.

Use validated local assets only. Do not allow user-controlled remote URLs or protocols in media commands. Apply process timeouts, output-size limits, and bounded concurrency. Cap retained stderr and scrub sensitive paths from user-facing errors.

Render broadly playable MP4 output, normally H.264 video, AAC audio, yuv420p, and fast-start metadata. Verify encoder and subtitle-filter availability on the installed FFmpeg build. Handle rotation, aspect ratio, audio presence, and variable frame rates deliberately.

Cancellation must terminate child processes and remove partial files. Write to temporary output, verify with ffprobe, then atomically promote the file. Record completion only after the artifact exists and is valid. Avoid upscaling without a user-visible reason.

## 12. Queue, retries, and recovery

Jobs need queued, running, succeeded, failed, and cancelled states plus stage, progress, attempt count, timestamps, and safe error details. Use transactional job claiming and a lease/heartbeat or equivalent recovery mechanism. Avoid holding SQLite transactions across network calls or rendering.

Prevent accidental second-worker execution for the single-worker prototype. After restart, reclaim stale jobs safely and resume from durable successful stages. Use idempotency keys or equivalent uniqueness constraints to prevent repeated clicks creating duplicate paid work. Assume at-least-once execution and make stage outputs safe to reuse.

Retry transient failures with bounded exponential backoff and jitter, respecting Retry-After. Do not repeatedly retry authentication, validation, insufficient-quota, or unsupported-media errors. A render failure must not rerun transcription.

Tie renders to a clip revision. An outdated job must not overwrite a newer export. Project deletion must cancel or invalidate work before removing artifacts; workers must not recreate deleted project files. Distinguish measured progress from estimates; never display fabricated precision.

## 13. Configuration, privacy, and costs

Provide .env.example with placeholders and documented defaults, including:
- GROQ_API_KEY and GEMINI_API_KEY
- TRANSCRIPTION_MODEL and CLIP_SELECTION_MODEL
- DATABASE_URL and MEDIA_STORAGE_DIR
- FFMPEG_PATH and FFPROBE_PATH
- Upload/duration limits, worker concurrency, retry limits, and AI_MODE

Load configuration consistently in Next.js and the standalone worker. Resolve the database and storage paths deterministically so both processes use the same locations on Windows. Do not assume Next.js environment loading automatically applies to the worker.

Keep secrets out of NEXT_PUBLIC variables, browser responses, source control, logs, screenshots, and fixtures. Ignore local environment files, database files and SQLite sidecars, uploads, renders, temporary files, and large media. Do not ask the user to paste API keys into chat.

Log operational IDs, stages, timings, and safe error categories rather than full transcripts or media contents. Explain provider transmission in setup documentation. Never claim that third-party services provide zero retention unless verified for the actual configuration.

Cache transcription and selection results within a project. Make regeneration explicit and disclose that it creates new API work. Render on demand. Track processing minutes and exports. Do not promise unlimited processing, hard-code prices into billing, or equate AI-only cost with total service cost.

## 14. UI and accessibility

Use a clean desktop-friendly editor with responsive controls. Default light background is pure white. Support dark mode with shared theme tokens. Centralize brand name, colours, typography, and caption presets.

Provide real loading, empty, success, error, and disabled states. Explain failures in ordinary language and offer the relevant retry action. Preserve the user's edits on recoverable failures.

Support keyboard operation, visible focus, labelled controls, sufficient contrast, and reduced-motion preferences. Do not communicate job state through colour alone. Keep implementation details out of ordinary user flows unless needed to resolve a problem.

Fixture mode must display a persistent Demo/Fixture indicator. Missing keys in live mode must produce a clear configuration message, never silently load fake results.

## 15. Windows development and documentation

Use cross-platform Node scripts for filesystem operations and launching processes; avoid requiring Bash-only commands. Support paths containing spaces and Unicode. Document FFmpeg installation and verify ffmpeg/ffprobe on startup or through a doctor script.

Provide and document scripts for web development, worker development, running both together, lint, typecheck, tests, build, and database migration. Use the actual scripts in package.json; do not document imaginary commands. Prefer npm run dev to launch both processes with coordinated shutdown.

Keep README.md current with prerequisites, setup, environment variables, migrations, commands, file locations, fixture mode, a first-upload walkthrough, known limitations, and troubleshooting. Document that a static or serverless-only deployment cannot run this local worker architecture unchanged.

Commit migrations and explain data changes. Do not reset the user's database, delete uploads, overwrite environment files, or run destructive git commands without explicit authorization.

## 16. Verification and completion criteria

Prioritize meaningful tests for:
- Invalid model output, source bounds, and timestamp conversion.
- Chunk overlap merging and legitimate repeated phrases.
- Caption clipping/rebasing and edits with changed word counts.
- Duplicate submissions, stale leases, retry classification, and restart recovery.
- Deletion/cancellation races and outdated render revisions.
- Filename/path handling, FFmpeg argument safety, and upload limits.

Use a small synthetic or permissioned video for an end-to-end fixture test: upload, transcript fixture, suggestion fixture, edit, actual render, and download. Include a Windows path with spaces in relevant checks. Mock network providers in routine tests; live calls must be deliberate and bounded.

For pipeline changes, verify the resulting media duration, dimensions, streams, caption placement, and playback rather than only checking that a file exists. Run lint, typecheck, applicable tests, and build using the repository's scripts. Do not broaden testing endlessly after the concrete risks are addressed.

A completed prototype must persist projects across restarts, visibly label fixture results, allow corrections, render a playable download, recover failures without unnecessary paid work, and remove deleted project media.

If credentials or dependencies are missing, complete all unblocked work and give exact remaining setup steps. Distinguish fixture tests, actual FFmpeg tests, and live provider tests. Never claim a check passed if it was not run.

## 17. Agent delivery behavior

Give concise progress updates during substantial work. Fix related defects needed to complete the task, but avoid unrelated refactors and dependency churn. Do not stop at a plan when implementation was requested.

When finishing, state what changed, how to run it, what was verified, and material limitations. Identify any blocking setup with concrete commands or configuration names. Never publish, push, or incur new recurring costs merely to demonstrate completion unless authorized.
