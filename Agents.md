# AI Resume Copilot Agents

This project is a lightweight AI resume copilot inspired by the "LLM wiki" idea:
raw user work samples are collected first, then transformed into a structured
personal wiki, and later used to co-create resumes with the user.

The product direction is a local desktop app with a Web UI. The UI should make
the workflow visible: upload raw evidence, inspect the wiki, generate or update
the resume, and preview the result.

## Core Flow

1. User opens the local app.
2. User uploads or adds sample work into `raw/`.
3. A raw-to-wiki agent reads the new material.
4. The agent extracts facts, skills, projects, impact, and evidence.
5. The agent updates the person's wiki in `wiki/`.
6. The UI visualizes the updated wiki.
7. Resume generation uses `wiki/` as the trusted source.
8. The UI previews the generated or updated resume.
9. If new raw material is added, update the wiki first, then refresh resume drafts.

## Folder Roles

- `app/`: Local Electron app and Web UI.
- `docs/`: Product and architecture notes for future agents.
- `raw/`: Unprocessed source material from the user.
- `wiki/`: Structured, cleaned, user-specific knowledge base.
- `ai-resume/`: Resume drafts, templates, and exports.

## UI Agent

### Goal

Provide a local Web UI that helps users move through the project workflow
without manually editing folders.

### Responsibilities

- Let users upload files and save them into `raw/`.
- Show the current raw file list.
- Show wiki pages from `wiki/`.
- Trigger wiki generation or update.
- Trigger resume generation or update.
- Show resume drafts from `ai-resume/drafts/`.

### Rules

- Treat the filesystem folders as the durable source of project state.
- Keep UI logic separate from agent logic.
- Do not make the UI invent resume content; generation should happen through
  the wiki and resume agents.
- Make placeholder states obvious until real model-backed logic exists.

## Raw-To-Wiki Agent

### Goal

Turn messy user-provided work samples into a structured personal wiki without
inventing unsupported facts.

### Inputs

- Files in `raw/`
- Existing wiki pages in `wiki/`
- Optional user notes or clarifications

### Outputs

- Updated wiki pages in `wiki/`
- Short list of questions when important details are missing
- Change notes describing what was added or updated

### Rules

- Treat `raw/` as evidence, not final truth.
- Do not overwrite existing wiki facts unless the new raw material clearly
  updates or corrects them.
- Keep uncertain claims marked as `Needs clarification`.
- Preserve links or filenames back to the original raw source when possible.
- Prefer concise, resume-useful facts: role, action, tools, outcome, impact.

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
- Ask the user about target role, company, and resume style
- Generate resume drafts in `ai-resume/drafts/`
- Keep templates in `ai-resume/templates/`
- Put exported resumes in `ai-resume/exports/`
- Update an existing resume when new wiki facts are added

## Current Implementation Notes

- `app/main.js` contains placeholder Electron IPC handlers.
- Upload already writes selected files into `raw/`.
- Wiki generation currently writes `wiki/generated-snapshot.md`.
- Resume generation currently writes `ai-resume/drafts/resume-draft.md`.
- Future agents should replace placeholder generation with model-backed logic
  while preserving the same folder-level workflow.
