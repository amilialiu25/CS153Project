# AI Resume Copilot Agents

This project is a lightweight AI resume copilot inspired by the "LLM wiki" idea:
raw user work samples are collected first, then transformed into a structured
personal wiki, and later used to co-create resumes with the user.

## Core Flow

1. User uploads or adds sample work into `raw/`.
2. A raw-to-wiki agent reads the new material.
3. The agent extracts facts, skills, projects, impact, and evidence.
4. The agent updates the person's wiki in `wiki/`.
5. Resume generation later uses `wiki/` as the trusted source.
6. If new raw material is added, update the wiki first, then refresh resume drafts.

## Folder Roles

- `raw/`: Unprocessed source material from the user.
- `wiki/`: Structured, cleaned, user-specific knowledge base.
- `ai-resume/`: Future resume generation workspace.

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

The resume generation agent will be added later. For now, it should eventually:

- Read from `wiki/`, not directly from `raw/`
- Ask the user about target role, company, and resume style
- Generate resume drafts in `ai-resume/drafts/`
- Keep templates in `ai-resume/templates/`
- Put exported resumes in `ai-resume/exports/`

