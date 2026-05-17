# AI Resume Copilot

Minimal project scaffold for a local-first AI resume copilot with a Web UI.

## Idea

Users add sample work into `raw/`, and the project turns that raw material into
a structured personal wiki in `wiki/`. The resume generation component then
uses the wiki as its source of truth to create targeted resume drafts.

When a user wants to update their resume, they can add new raw files that
represent their latest work. The system updates the wiki first, then refreshes
the resume so the new version stays grounded in the most recent evidence.

The intended product is a local desktop app: the user opens a packaged binary,
uploads files through a Web UI, watches the personal wiki update, then previews
the generated resume in the same interface.

## Flow

```text
Web UI upload -> raw/ -> wiki/ -> ai-resume/ -> resume preview
```

## App Direction

This repo is moving toward an Electron-based local app. Electron gives the
project a browser-style interface while still allowing safe local file writes to
folders like `raw/`, `wiki/`, and `ai-resume/`.

The current Web UI is an MVP scaffold:

- Upload files into `raw/`
- Show uploaded raw files
- Generate a placeholder wiki snapshot
- Generate a placeholder resume draft
- Preview wiki and resume markdown in the app

## Structure

- `app/`: Electron main process, preload bridge, and renderer Web UI
- `docs/project-description.md`: product description for future agents
- `raw/`: uploaded source evidence
- `wiki/`: structured personal knowledge base
- `ai-resume/`: resume drafts, templates, and exports

## Current Status

- Basic folder structure created
- Raw-to-wiki agent instructions added in `Agents.md`
- Project description added in `docs/project-description.md`
- Electron Web UI scaffold added
- Resume and wiki generation currently use placeholder logic

## Local Development

Node.js is required for the Electron app.

```bash
npm install
npm run dev
```

To create a packaged app later:

```bash
npm run package:mac
```
