# AI Resume Copilot

A local-first AI copilot that turns your scattered work samples into a polished,
single-page resume — and keeps every line grounded in evidence you actually
provide.

## Project overview

Instead of writing a resume directly, you give AI Resume Copilot your source
material (project notes, work samples, an existing resume). It distills that
material into a structured, interlinked **personal wiki**, then generates a
resume from the wiki so each claim traces back to a source.

It follows the **LLM Wiki pattern**: a human curates the sources and asks
questions, while the AI maintains an interlinked knowledge base in `wiki/` that
compounds over time. Resume generation reads from the wiki, never directly from
the raw files.

**Key capabilities**

- **Two workflows** — *build from scratch* (start from raw evidence) and
  *improve existing* (upload a resume, add new evidence, regenerate).
- **Format preservation** — output matches an uploaded template, or preserves
  your original resume's formatting (fonts, headings, bullets, margins).
  Resolution order: uploaded template → original resume (improve mode) →
  built-in ATS default.
- **Grounded content** — the resume is built from wiki facts; gaps are flagged
  `Needs clarification` instead of being invented.
- **One-page curation** — content is trimmed and condensed to fit a single page.
- **Change diff** — in improve mode, a "Show Changes" view diffs the new resume
  against your original.
- **Live previews** — preview raw evidence, uploaded resumes/templates, wiki
  pages (with a graph view), and the generated resume.
- **AI-backed when available** — uses your local Claude CLI for generation, with
  a deterministic heuristic fallback when it isn't installed.

## Tech stack

- **Backend:** Node.js standard-library HTTP server (`app/server.js`) — no web
  framework.
- **Frontend:** vanilla HTML/CSS/JS (`app/renderer/`).
- **DOCX:** [`docx`](https://github.com/dolanmiu/docx) for generation,
  [`jszip`](https://github.com/Stuk/jszip) for reading/parsing `.docx`.
- **AI (optional):** the Claude CLI (`claude`) for agent-backed generation.
- **PDF (optional):** LibreOffice (`soffice`) or Microsoft Word (Windows COM
  automation).

## Setup

### Prerequisites

- **Node.js 18+** (developed and tested on Node 24).
- *(Optional)* **Claude CLI** — enables AI-backed generation; without it, the app
  uses a heuristic fallback.
- *(Optional)* **LibreOffice** or **Microsoft Word** — enables PDF export;
  without one, DOCX export still works.

### Install and run

```bash
npm install
npm run dev        # starts the web UI at http://localhost:3000
```

### Other scripts

```bash
npm test           # run the unit tests (node --test)
npm run clean      # reset the workspace (clears raw/, wiki/, uploads, exports)
```

## Usage

Open <http://localhost:3000>. The sidebar holds uploads and actions, the center
shows the wiki/resume, and the right shows the wiki graph. Click any uploaded
file or wiki page to preview it.

### Build from scratch

1. Set **Workflow → Build from scratch**.
2. **Upload raw evidence** (text / Markdown / `.docx`). Optionally **Upload
   template** (`.docx`) to control the output format.
3. Click **Generate Wiki** — the app builds `wiki/` pages (profile, experience,
   skills, impact metrics, resume bullets, …) with source citations.
4. Click **Generate Resume** (DOCX or PDF). The result uses your template's
   format if provided, otherwise the built-in ATS layout.

### Improve an existing resume

1. Set **Workflow → Improve existing**.
2. **Upload resume (.docx)** into `ai-resume/original/`, then **Upload raw
   evidence** describing new work.
3. **Generate Wiki**, then **Generate Resume** — the output keeps your original
   resume's formatting (unless a template is uploaded) and folds in the new
   experience.
4. Click **Show Changes** to diff the new resume against your original.

A ready-made set of sample inputs lives in [`test/`](test/) (see
[`test/README.md`](test/README.md)).

### Folder layout

```
raw/                  source evidence you upload (immutable inputs)
wiki/                 AI-maintained knowledge base (wiki/index.md, wiki/log.md, …)
ai-resume/original/   your existing resume (.docx) for "improve" runs
ai-resume/templates/  DOCX format templates (default-ats.docx is built in)
ai-resume/exports/    generated resumes (.docx / .pdf)
app/                  server, core logic, agent integration, web UI
test/                 mock fixtures for end-to-end testing
```

> Contents of `raw/`, `wiki/`, `ai-resume/original/`, and `ai-resume/exports/`
> are gitignored — they hold personal/generated data and stay on your machine.

## Evaluation

The project's correctness-critical claims are validated mechanically, and its
limits are documented honestly. Highlights:

- **9 passing unit tests** (`npm test`) covering format fidelity (a style profile
  survives a build → extract round trip), the *template → original → default*
  precedence, and `.docx` resume parsing.
- **Grounding is enforced in code**, not just prompted: missing facts become
  `Needs clarification` and the AI path falls back to deterministic heuristics if it
  returns incomplete output — so the app is fully demonstrable with no AI installed.
- **A documented end-to-end scenario matrix** (`test/`) with distinct fixtures that
  make the resolved format obvious, plus a built-in **diff view** that lets users
  audit exactly what changed between resume versions.

Full methodology, results, comparisons, and known failure modes are in
**[docs/EVALUATION.md](docs/EVALUATION.md)**.

## AI usage disclosure

This project was built with substantial AI assistance, and the application
itself uses AI at runtime:

- **Development.** The application code, tests, and documentation were written
  collaboratively with **Anthropic's Claude** (via Claude Code). Many commits are
  co-authored by Claude (see the `Co-Authored-By:` trailers in the git history).
- **Runtime.** When the **Claude CLI** is installed, the app passes your evidence
  and wiki to it to generate the wiki pages and resume content. When it is not
  installed, generation falls back to deterministic, non-AI heuristics in
  `app/main.js`.
- **Grounding and review.** AI-generated resume content is constrained to your
  uploaded evidence and marks missing facts as `Needs clarification`. AI output
  can still be wrong — **review every generated resume before using it.**
- **Privacy.** Uploads and generated files are written only to local folders.
  Nothing leaves your machine except what you send to your own local Claude CLI.

## Citations and acknowledgements

- **LLM Wiki pattern** — the interlinked, AI-maintained knowledge-base approach
  is inspired by Andrej Karpathy's writing on using LLMs as personal knowledge
  tools.
- **Anthropic Claude / Claude Code** — used for development and optional runtime
  generation.
- **Open-source libraries** — [`docx`](https://github.com/dolanmiu/docx) and
  [`jszip`](https://github.com/Stuk/jszip).
- **PDF conversion** — [LibreOffice](https://www.libreoffice.org/) or Microsoft
  Word.

## Links and external resources

- Node.js — <https://nodejs.org/>
- Claude Code (CLI) — <https://docs.claude.com/en/docs/claude-code>
- `docx` library — <https://github.com/dolanmiu/docx>
- `jszip` library — <https://github.com/Stuk/jszip>
- LibreOffice — <https://www.libreoffice.org/>
- Andrej Karpathy — <https://karpathy.ai/>

## Demo

<!-- TODO: paste the demo video link before submission -->
**Demo video:** _add link before submission_

A quick walkthrough of uploading evidence, generating the wiki, and producing a
formatted one-page resume (scenarios A–D in [`test/README.md`](test/README.md)).

## Project submission (course rubric)

Where each rubric category is addressed, for graders:

| Rubric category | Where it's addressed |
| --- | --- |
| **Problem & Insight** | [Project overview](#project-overview) — the evidence-grounded "wiki-first" approach to resume generation, inspired by the LLM Wiki pattern. |
| **Execution & Technical Work** | [Key capabilities](#project-overview), [Tech stack](#tech-stack), [Usage](#usage) — a working local app with two workflows, format preservation, grounding, one-page curation, diffing, and live previews. |
| **Evaluation & Evidence** | [Evaluation](#evaluation) summary + **[docs/EVALUATION.md](docs/EVALUATION.md)** — 9 passing tests, format-fidelity round-trip, grounding guarantees, E2E scenario matrix, and a limitations/failure analysis. |
| **Communication & Presentation** | This README, the [demo video](#demo), and supporting docs ([docs/project-description.md](docs/project-description.md), [test/README.md](test/README.md)). |
| **Process, Integrity & Disclosure** | [AI usage disclosure](#ai-usage-disclosure), [Citations and acknowledgements](#citations-and-acknowledgements), and the public commit history below. |

**Development process & effort over time.** The project was built incrementally
over ~3 weeks (initial scaffold on 2026-05-17 through submission on 2026-06-04)
across a public commit history with visible iteration — UI redesign, the one-page
constraint fix, format preservation, the diff view, and test fixtures each landed as
separate, reviewable commits (several via pull request). Run `git log --oneline` to
see the full progression.
