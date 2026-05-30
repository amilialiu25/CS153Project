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
| 1. Open local app | Done | `app/server.js`, `app/renderer/index.html` | Web server runs at `http://localhost:3000`. |
| 2. Upload raw files into `raw/` | Done | `app/main.js`, `app/renderer/renderer.js` | Uploaded files are persisted to the filesystem, with system README files hidden from the UI. |
| 2b. Upload original resume into `ai-resume/original/` | Done | `app/main.js`, `app/renderer/index.html`, `app/renderer/renderer.js` | UI and filesystem support exist; `.docx` import is now included in wiki generation. |
| 3. Read new raw material | In progress | `app/main.js` | Basic file reading exists. No file-change tracking or ingestion queue yet. |
| 3b. Read original resume into wiki facts | In progress | `app/main.js`, `wiki/original-resume.md` | `.docx` original resumes are parsed into wiki facts; PDF import is still future work. |
| 4. Extract facts, skills, projects, impact, evidence | In progress | `app/main.js` | Heuristic extraction only. No model-backed parsing yet. |
| 5. Update structured wiki pages in `wiki/` | In progress | `wiki/index.md`, `wiki/log.md`, `wiki/*.md`, `app/main.js` | Wiki generation now follows the LLM Wiki structure with source pages, concept pages, wiki-links, citations, index, and append-only log. Merging and conflict handling are still minimal. |
| 6. Visualize wiki in the UI | Done | `app/renderer/renderer.js`, `app/renderer/styles.css` | Wiki pages are rendered and collapsible instead of shown as raw text blocks. |
| 7. Generate resume from `wiki/` | In progress | `app/main.js`, `ai-resume/exports/` | Resume generation writes DOCX/PDF exports from DOCX templates; content remains placeholder-level until model-backed extraction exists. |
| 7b. Use original resume as a reference input | Not started | `Agents.md`, `docs/resume-workflow-plan.md` | Planned for polish and update workflows. |
| 8. Export generated resume | In progress | `app/main.js`, `app/renderer/index.html`, `ai-resume/exports/` | UI lists generated DOCX/PDF exports after the explicit wiki-generation step. |
| 9. Refresh wiki before resume when new raw arrives | In progress | `app/main.js`, `app/renderer/renderer.js` | UI now warns when wiki is stale and disables resume generation until wiki has been generated. Full auto-refresh is still not built. |

## Current Architecture Snapshot

| Area | Status | Evidence |
| --- | --- | --- |
| Web server | Working MVP | `app/server.js` (port 3000) |
| Upload UX | Working MVP | `app/renderer/index.html`, `app/renderer/renderer.js` |
| Original resume upload | Working MVP | `app/main.js`, `app/renderer/renderer.js` |
| Original resume import | DOCX support | `app/main.js`, `wiki/original-resume.md` |
| Raw-to-wiki pipeline | LLM Wiki MVP | `app/main.js`, `wiki/index.md`, `wiki/log.md` |
| Resume generation | Connected to wiki | `app/main.js`, `ai-resume/exports/` |
| Template system | DOCX template filling | `ai-resume/templates/default-ats.docx`, `app/main.js` |
| Export flow | DOCX/PDF option | `app/main.js`, `app/renderer/index.html`, `ai-resume/exports/` |
| Agent orchestration | Claude CLI integration added | `app/agent.js` — optional agent-backed wiki/resume generation |
| CLAUDE.md | Added | LLM Wiki instructions for any Claude Code session |

## What Changed Most Recently

- Added an agent-readable progress tracker in `docs/`.
- Upgraded wiki generation from a single snapshot file toward structured
  section pages backed by raw-file evidence.
- Updated resume generation so it reads structured wiki pages and writes
  formatted DOCX/PDF exports.
- Hid project README files from raw/wiki/resume views and made wiki pages
  collapsible.
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
- Added DOCX-oriented generation: resume generation now writes `resume-draft.docx`
  into `ai-resume/exports/`, and the UI lets users choose DOCX or PDF output.
  PDF export tries LibreOffice/soffice first, then Microsoft Word automation on
  Windows.
- Added a DOCX template upload area that stores user-provided Word templates in
  `ai-resume/templates/`.
- Replaced the real uploaded resume copy with a sanitized DOCX template that
  preserves the layout structure using placeholders only.
- Updated DOCX export to fill the default DOCX template placeholders first, so
  formatting comes from the Word template. The programmatic DOCX builder is now
  a fallback when the template is missing or invalid.
- Removed the old Markdown resume-draft path, including generated Markdown draft
  files and the Markdown fallback template.
- Added initial original-resume import: `.docx` files in `ai-resume/original/`
  are parsed during wiki generation and written into `wiki/original-resume.md`,
  including imported contact, detected sections, and resume bullets.
- Resume export now uses imported name/contact fields from `wiki/original-resume.md`
  when available.
- When an original `.docx` resume exists, resume export now preserves that DOCX
  as the output baseline instead of forcing sparse wiki facts into the default
  template. This avoids placeholder-heavy or lossy exports before a real polish
  agent exists.
- Rebuilt wiki generation around the LLM Wiki pattern:
  - source summary pages named after uploaded sources
  - concept pages such as `profile`, `education`, `work-experience`, `skills`,
    `resume-bullets`, `impact-metrics`, and `projects`
  - `wiki/index.md` table of contents
  - append-only `wiki/log.md`
  - `[[wiki-links]]` and `(source: filename)` citations throughout pages

## Next Build Focus

1. Improve original-resume import beyond first-pass `.docx` parsing, including
   richer education/experience field extraction and PDF support.
2. Split resume actions into:
   - build from scratch
   - polish existing resume
   - update existing resume with new evidence
3. Make wiki generation incremental so it does not blindly replace useful
   human edits in `wiki/`.
4. Expand template filling from the default DOCX template to user-selected DOCX
   templates.
5. Add file-type handling for PDFs, DOCX, and other non-plain-text evidence.

## Guardrails For Future Agents

- Treat `raw/` as evidence, not truth.
- Prefer writing grounded excerpts and explicit `Needs clarification` markers.
- Do not claim metrics, roles, or outcomes unless the source text supports them.
- Keep the filesystem folders as the durable state; UI is only a view layer.
