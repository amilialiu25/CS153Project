# AI Resume Copilot — Agent Instructions

This project is a local-first AI resume copilot. Users upload work samples into
`raw/`, an agent converts them into a structured personal wiki in `wiki/`, and
then uses that wiki to generate or update resume exports in `ai-resume/exports/`.

## Quick start

```bash
npm install
npm run dev        # starts the web UI at http://localhost:3000
```

## Folder structure

```
raw/                       -- source documents: work samples, project descriptions,
                              class assignments, notes (immutable — never modify)
wiki/                      -- markdown pages maintained by Claude
wiki/index.md              -- table of contents for the entire wiki
wiki/log.md                -- append-only record of all operations
ai-resume/original/        -- user's existing resume (.docx) for "improve" workflows
ai-resume/templates/       -- DOCX formatting templates
ai-resume/exports/         -- generated resume files (DOCX/PDF)
app/                       -- Node.js web server and UI
docs/                      -- project documentation
```

Both `raw/` and `ai-resume/original/` are scanned as source evidence for wiki
generation. Put work samples and project evidence in `raw/`. Put the user's
current resume in `ai-resume/original/`.

## LLM Wiki

This project uses the LLM Wiki pattern (inspired by Andrej Karpathy). The wiki
is a structured, interlinked knowledge base for building resumes. Claude
maintains the wiki. The human curates sources, asks questions, and guides the
analysis.

### Ingest workflow

When the user adds a new source to `raw/` and asks you to ingest it:

1. Read the full source document.
2. Discuss key takeaways with the user before writing anything.
3. Create a summary page in `wiki/` named after the source.
4. Create or update concept pages for each major idea or entity.
5. Add wiki-links (`[[page-name]]`) to connect related pages.
6. Update `wiki/index.md` with new pages and one-line descriptions.
7. Append an entry to `wiki/log.md` with the date, source name, and what changed.

A single source may touch 10–15 wiki pages. That is normal.

### Page format

Every wiki page must follow this structure:

```markdown
# Page Title

**Summary**: One to two sentences describing this page.

**Sources**: List of raw source files this page draws from.

**Last updated**: Date of most recent update.

---

Main content goes here. Use clear headings and short paragraphs.

Link to related concepts using [[wiki-links]] throughout the text.

## Related pages

- [[related-concept-1]]
- [[related-concept-2]]
```

### Citation rules

- Every factual claim should reference its source file.
- Use the format `(source: filename.ext)` after the claim.
- If two sources disagree, note the contradiction explicitly.
- If a claim has no source, mark it as needing verification.

### Question answering

When the user asks a question:

1. Read `wiki/index.md` first to find relevant pages.
2. Read those pages and synthesize an answer.
3. Cite specific wiki pages in your response.
4. If the answer is not in the wiki, say so clearly.
5. If the answer is valuable, offer to save it as a new wiki page.

Good answers should be filed back into the wiki so they compound over time.

### Lint

When the user asks you to lint or audit the wiki:

- Check for contradictions between pages.
- Find orphan pages (no inbound links from other pages).
- Identify concepts mentioned in pages that lack their own page.
- Flag claims that may be outdated based on newer sources.
- Check that all pages follow the page format above.
- Report findings as a numbered list with suggested fixes.

### Rules

- Never modify anything in the `raw/` folder.
- Always update `wiki/index.md` and `wiki/log.md` after changes.
- Keep page names lowercase with hyphens (e.g., `machine-learning.md`).
- Write in clear, plain language.
- When uncertain about how to categorize something, ask the user.

## Resume generation

The resume generation pipeline reads from `wiki/`, not directly from `raw/`.

### Workflow modes

**Mode A — Build from scratch**: Upload raw evidence into `raw/`, generate wiki
facts, then build a new resume draft.

**Mode B — Improve existing resume**: Upload the current resume into
`ai-resume/original/`, extract facts into `wiki/`, then polish or update with
new evidence.

### Resume rules

- Only state facts grounded in the wiki. Never invent claims.
- Use action-verb bullets with metrics when available.
- Default to a conservative ATS-friendly single-column layout.
- Templates live in `ai-resume/templates/`.
- Exports go to `ai-resume/exports/`.
- Prefer DOCX export; PDF via LibreOffice or Word when available.

## Web UI

The app runs at `http://localhost:3000` and provides:

- File upload into `raw/` and `ai-resume/original/`
- DOCX template upload into `ai-resume/templates/`
- Wiki generation trigger and live preview
- Resume generation with DOCX/PDF format toggle
- Status badges for wiki freshness and resume freshness

## Source file handling

The app can extract text from:

- `.md`, `.txt`, `.json`, `.csv`, `.tsv`, `.log` — read directly
- `.docx` — extracted via JSZip XML parsing

Both `raw/` and `ai-resume/original/` are scanned for source material.

## Architecture notes

- `app/server.js` — HTTP server with API routes
- `app/main.js` — core logic: evidence reading, wiki building, resume export
- `app/agent.js` — Claude CLI integration for agent-backed generation
- `app/renderer/` — frontend HTML, CSS, JS
- `.resume-copilot-state.json` — tracks workflow mode and generation timestamps
