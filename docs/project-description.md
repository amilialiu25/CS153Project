# Project Description

## Vision

AI Resume Copilot is a local-first resume assistant. The user should be able to
open a desktop app, upload examples of their work, build a structured personal
wiki from those raw materials, and generate or update a resume from that wiki.

The project is inspired by the idea of an LLM wiki: instead of asking the model
to write a resume directly from scattered context, the system first turns raw
evidence into a durable knowledge base. Resume generation then uses that wiki as
the source of truth.

## Product Flow

1. The user opens a local desktop app with a Web UI.
2. The user uploads sample work through the UI.
3. Uploaded files are copied into `raw/`.
4. The raw-to-wiki agent reads new raw files and updates `wiki/`.
5. The UI shows a visual preview of the wiki.
6. The user clicks generate or update resume.
7. The resume agent reads from `wiki/` and writes drafts into `ai-resume/drafts/`.
8. The UI shows a resume preview and eventually supports export.

When the user has new work, they repeat the same loop: add new raw files,
update the wiki, then refresh the resume. The resume should stay grounded in
the latest available evidence.

## Local App Direction

The preferred implementation direction is an Electron app:

- It can be packaged as a local binary.
- It can open a browser-like Web UI.
- It can read and write local project folders such as `raw/`, `wiki/`, and
  `ai-resume/`.
- It keeps the MVP simple without needing a hosted backend.

The first UI does not need full AI behavior. It should make the workflow visible
and create clear places where the actual agents can be connected later.

## MVP Screens

- Upload: choose files and save them into `raw/`.
- Wiki: show generated wiki pages and update status.
- Resume: generate or update a draft and preview it.

## Data Folders

- `raw/`: uploaded source evidence from the user.
- `wiki/`: structured personal knowledge base derived from raw evidence.
- `ai-resume/drafts/`: generated resume drafts.
- `ai-resume/templates/`: resume template files.
- `ai-resume/exports/`: final exported resumes.

## Agent Responsibilities

The raw-to-wiki agent should extract grounded facts, skills, project details,
impact, and open questions. It should not invent unsupported claims.

The resume agent should read from `wiki/`, ask for target-role context when
needed, and create targeted resume drafts in `ai-resume/drafts/`.

The UI layer should orchestrate the workflow and visualize state. It should not
be treated as the source of truth; the filesystem folders remain the durable
project state.

