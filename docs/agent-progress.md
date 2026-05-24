# Agent Progress Tracker

This file is the canonical handoff note for future agents working in this
repository. Update it whenever the workflow meaningfully changes.

## Reading Mode

Use this document as the first checkpoint before changing code:

1. Read the status table.
2. Confirm the evidence paths still match the codebase.
3. Continue the highest-priority item in `Next Build Focus`.
4. Update this file after shipping work.

## Workflow Status

| Core Step | Status | Current Evidence | Notes |
| --- | --- | --- | --- |
| 1. Open local app | Done | `app/main.js`, `app/renderer/index.html` | Electron window loads the renderer. |
| 2. Upload raw files into `raw/` | Done | `app/main.js`, `app/renderer/renderer.js` | Uploaded files are persisted to the filesystem, with system README files hidden from the UI. |
| 2b. Upload original resume into `ai-resume/original/` | Done | `app/main.js`, `app/preload.js`, `app/renderer/index.html`, `app/renderer/renderer.js` | UI and filesystem support now exist, but import/parsing has not been built yet. |
| 3. Read new raw material | In progress | `app/main.js` | Basic file reading exists. No file-change tracking or ingestion queue yet. |
| 3b. Read original resume into wiki facts | Not started | `Agents.md`, `docs/resume-workflow-plan.md` | Planned import path for existing resume workflows. |
| 4. Extract facts, skills, projects, impact, evidence | In progress | `app/main.js` | Heuristic extraction only. No model-backed parsing yet. |
| 5. Update structured wiki pages in `wiki/` | In progress | `wiki/*.md`, `app/main.js` | Structured pages are generated, but merging and conflict handling are still minimal. |
| 6. Visualize wiki in the UI | Done | `app/renderer/renderer.js`, `app/renderer/styles.css` | Wiki pages are rendered and collapsible instead of shown as raw text blocks. |
| 7. Generate resume from `wiki/` | In progress | `app/main.js`, `ai-resume/drafts/` | Resume draft generation exists, but remains placeholder-level. |
| 7b. Use original resume as a reference input | Not started | `Agents.md`, `docs/resume-workflow-plan.md` | Planned for polish and update workflows. |
| 8. Preview generated resume | Done | `app/renderer/renderer.js`, `app/renderer/styles.css` | Resume preview is rendered as the primary output, but only after the explicit wiki-generation step. |
| 9. Refresh wiki before resume when new raw arrives | In progress | `app/main.js`, `app/renderer/renderer.js` | UI now warns when wiki is stale and disables resume generation until wiki has been generated. Full auto-refresh is still not built. |

## Current Architecture Snapshot

| Area | Status | Evidence |
| --- | --- | --- |
| Electron shell | Working MVP | `app/main.js`, `app/preload.js` |
| Upload UX | Working MVP | `app/renderer/index.html`, `app/renderer/renderer.js` |
| Original resume upload | Working MVP | `app/main.js`, `app/renderer/index.html`, `app/renderer/renderer.js` |
| Original resume import | Planned | `docs/resume-workflow-plan.md`, `Agents.md` |
| Raw-to-wiki pipeline | Partial | `app/main.js`, `wiki/` |
| Resume generation | Placeholder but connected to wiki | `app/main.js`, `ai-resume/drafts/` |
| Template system | Planned | `ai-resume/templates/`, `docs/resume-workflow-plan.md` |
| Export flow | Not started | `ai-resume/exports/README.md` |
| Agent orchestration | Not started | No job queue, no model integration, no incremental sync |

## What Changed Most Recently

- Added an agent-readable progress tracker in `docs/`.
- Upgraded wiki generation from a single snapshot file toward structured
  section pages backed by raw-file evidence.
- Updated resume draft generation so it now reads structured wiki pages instead
  of only listing source filenames.
- Hid project README files from raw/wiki/resume views and upgraded preview
  rendering so resume stays primary and wiki pages are collapsible.
- Defined the two target workflow modes:
  - build from scratch
  - improve an existing resume
- Added a repo-level rule that structural changes must also update this file.
- Added workflow mode selection to the UI and persisted it in a local project
  state file.
- Added original resume upload support backed by `ai-resume/original/`.
- Reworked the step flow so the app now guides users through:
  - choose mode and upload sources
  - generate wiki
  - generate final resume
- Added lightweight generation status tracking so resume generation is gated by
  wiki readiness.

## Next Build Focus

1. Build a resume-import path that converts an uploaded original resume into wiki facts.
2. Split resume actions into:
   - build from scratch
   - polish existing resume
   - update existing resume with new evidence
3. Add one explicit ATS-friendly default template in `ai-resume/templates/`.
4. Make wiki generation incremental so it does not blindly replace useful
   human edits in `wiki/`.
5. Add file-type handling for PDFs, DOCX, and other non-plain-text evidence.

## Guardrails For Future Agents

- Treat `raw/` as evidence, not truth.
- Prefer writing grounded excerpts and explicit `Needs clarification` markers.
- Do not claim metrics, roles, or outcomes unless the source text supports them.
- Keep the filesystem folders as the durable state; UI is only a view layer.
