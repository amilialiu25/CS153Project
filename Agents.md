# AI Resume Copilot Agents

See `CLAUDE.md` for the full LLM Wiki instructions, folder structure, and
project overview. This file covers agent-specific workflow details.

This project is a lightweight AI resume copilot inspired by the "LLM wiki" idea:
raw user work samples are collected first, then transformed into a structured
personal wiki, and later used to co-create resumes with the user.

The product direction is a local desktop app with a Web UI. The UI should make
the workflow visible: upload raw evidence, inspect the wiki, generate or update
the resume, and preview the result.

## Core Flow

1. User opens the local app.
2. User chooses a workflow mode:
   - Build from scratch
   - Improve an existing resume
3. User uploads source material:
   - Raw evidence into `raw/`
   - Optional original resume into `ai-resume/original/`
4. A resume-to-wiki or raw-to-wiki agent reads the available material.
5. The agent extracts facts, skills, projects, impact, and evidence.
6. The agent updates the person's wiki in `wiki/`.
7. Resume generation uses `wiki/` as the trusted source and may also use the
   original resume as a style/reference input.
8. The UI lists generated or updated DOCX/PDF resume exports.
9. If new raw material is added, update the wiki first, then refresh resume exports.

## Folder Roles

- `app/`: Local Electron app and Web UI.
- `docs/`: Product and architecture notes for future agents.
- `raw/`: Unprocessed source material from the user.
- `wiki/`: Structured, cleaned, user-specific knowledge base.
- `ai-resume/original/`: User-provided original resume files used for import,
  polishing, comparison, or update workflows.
- `ai-resume/`: Resume templates and exports.

## Workflow Modes

### Mode A: Build From Scratch

Use this when the user does not already have a resume or wants a fresh version.

Expected path:

- Upload raw evidence into `raw/`
- Generate or update `wiki/`
- Generate a DOCX/PDF resume export from `wiki/`
- Optionally select a default template or user-chosen template

### Mode B: Improve Existing Resume

Use this when the user already has a resume and wants polishing or updates.

Expected path:

- Upload the original resume into `ai-resume/original/`
- Extract facts from the original resume into `wiki/`
- If the user also uploads new raw evidence, merge that evidence into `wiki/`
- Generate either:
  - a polished rewrite using only the original resume and wiki, or
  - an updated resume using the original resume, wiki, and new raw evidence

Rules:

- Uploading an original resume should never force a build-from-scratch flow.
- Even without new raw evidence, the original resume should still be converted
  into wiki facts so later updates have structured state.
- Resume polishing may work without new raw evidence.
- Resume updating should prefer fresh wiki facts when new evidence exists.

## UI Agent

### Goal

Provide a local Web UI that helps users move through the project workflow
without manually editing folders.

### Responsibilities

- Let users upload files and save them into `raw/`.
- Let users upload an original resume into `ai-resume/original/`.
- Let users choose between build-from-scratch and improve-existing-resume modes.
- Show the current raw file list.
- Show the current original resume file, if one exists.
- Show wiki pages from `wiki/`.
- Trigger wiki generation or update.
- Trigger resume generation or update.
- Show generated resume export files from `ai-resume/exports/`.

### Rules

- Treat the filesystem folders as the durable source of project state.
- Keep UI logic separate from agent logic.
- Do not make the UI invent resume content; generation should happen through
  the wiki and resume agents.
- Make placeholder states obvious until real model-backed logic exists.
- Put resume export status ahead of wiki detail in the visual hierarchy.
- Keep large wiki output collapsible so resume review stays primary.

## Raw-To-Wiki Agent

### Goal

Turn messy user-provided work samples and uploaded original resumes into a
structured LLM Wiki without inventing unsupported facts.

### Inputs

- Files in `raw/`
- Existing wiki pages in `wiki/`
- Optional user notes or clarifications

### Outputs

- Updated wiki pages in `wiki/`
- `wiki/index.md` as the table of contents
- `wiki/log.md` as the append-only operation log
- Short list of questions when important details are missing
- Source summary pages named after source files
- Concept pages for major resume ideas and entities

### Rules

- Treat `raw/` as evidence, not final truth.
- Treat `ai-resume/original/` as evidence for improve-existing-resume workflows.
- Do not overwrite existing wiki facts unless the new raw material clearly
  updates or corrects them.
- Keep uncertain claims marked as `Needs clarification`.
- Preserve links or filenames back to the original raw source when possible.
- Prefer concise, resume-useful facts: role, action, tools, outcome, impact.
- Keep wiki page names lowercase with hyphens.
- Link related pages with `[[wiki-links]]`.
- Cite factual claims with `(source: filename.ext)`.
- Always update `wiki/index.md` and append to `wiki/log.md` after generation.

### Page Format

Every generated wiki page should follow this structure:

```markdown
# Page Title

**Summary**: One to two sentences describing this page.

**Sources**:
- source-file.ext

**Last updated**: ISO timestamp.

---

Main content with citations and [[wiki-links]].

## Related pages

- [[related-page]]
```

### Suggested Wiki Sections

- Profile summary
- Skills
- Projects
- Work samples
- Achievements
- Metrics and impact
- Resume-ready bullets
- Open questions

## Resume Agent Placeholder

The resume generation agent will be added later. It should eventually:

- Read from `wiki/`, not directly from `raw/`
- Read from `ai-resume/original/` when the user is improving an existing resume
- Ask the user about target role, company, and resume style
- Keep templates in `ai-resume/templates/`
- Put exported resumes in `ai-resume/exports/`
- Update an existing resume when new wiki facts are added

## Template Direction

- Default to a conservative ATS-friendly template until user-specific templates
  are supported.
- Prefer single-column layout, simple headings, standard fonts, and no tables
  or decorative text boxes in the default export path.
- Treat templates as explicit assets in `ai-resume/templates/`, not hidden
  prompt behavior.

## Agent Handoff Rule

Any agent making a structural product, workflow, folder, or architecture change
must update `docs/agent-progress.md` in the same work session.

Structural changes include:

- adding or changing workflow modes
- changing folder responsibilities
- changing UI flow or user-visible steps
- changing generation dependencies between raw, wiki, original resume, and exports
- changing template strategy or export assumptions

Do not leave structural decisions only in code or chat history.

## Current Implementation Notes

- `app/main.js` contains placeholder Electron IPC handlers.
- Upload already writes selected files into `raw/`.
- Wiki generation currently writes structured pages in `wiki/`.
- Resume generation currently writes DOCX/PDF files in `ai-resume/exports/`.
- Future agents should replace placeholder generation with model-backed logic
  while preserving the same folder-level workflow.
