# Evaluation & Evidence

This document records how AI Resume Copilot is validated, what evidence backs its
claims, and where it falls short. It is the detailed companion to the
[Evaluation](../README.md#evaluation) summary in the README.

## How do you evaluate a tool like this?

AI Resume Copilot is not a model with a single accuracy number — it is a pipeline
(`raw evidence → wiki → resume`) with a few hard correctness guarantees layered on
top of an optional language model. So "does it work?" decomposes into questions
that *can* be checked deterministically:

| Claim the project makes | How it is evaluated | Evidence |
| --- | --- | --- |
| Output preserves an uploaded template / original resume's format | Automated round-trip test: build a DOCX from a known style profile, re-extract it, assert the profile survived | [`app/main.test.js`](../app/main.test.js) — 3 style tests |
| Format precedence is *template → original → default* | Automated test exercising all four mode/upload combinations | `resolveResumeStyleProfile` test |
| An existing `.docx` resume is parsed into structured, diffable data | Automated test against a real fixture resume | `parseResumeDocx` tests |
| Content is grounded in evidence and never invented | Code-level guarantee: missing fields become `Needs clarification` | `app/agent.js`, `app/main.js` (see below) |
| The resume fits one page | Deterministic line-budget trimming algorithm | `trimResumeValues` (see below) |
| The app degrades gracefully without the Claude CLI | Dual code path with explicit fallback + incomplete-output detection | `app/agent.js` |
| End-to-end workflows actually produce the expected output | Manual E2E scenario matrix with prepared fixtures | [`test/README.md`](../test/README.md) |

The rest of this document expands each row.

## 1. Automated test suite

Nine unit tests run via the Node.js built-in test runner. They focus on the parts
of the pipeline that *must* be exactly right: format fidelity, format precedence,
and resume parsing.

```bash
npm test
```

Latest run — **9 passing, 0 failing** (~1.2s):

```
✔ getDefaultStyleProfile has the expected baseline shape
✔ extractDocxStyleProfile reads the default ATS template's fonts and margins
✔ a custom style profile survives a build → extract round trip
✔ resolveResumeStyleProfile follows the template > original > default precedence
✔ parseResumeDocx extracts structured sections, entries, and bullets
✔ parseResumeDocx handles a template with a Projects section
✔ resumeValuesFromParsedResume maps a parsed resume into diff-baseline shape
✔ resumeValuesFromParsedResume returns null for null input
✔ custom section ordering is honored by the builder
ℹ tests 9
ℹ pass 9
ℹ fail 0
```

What each group verifies:

- **Style profile baseline** — the built-in ATS default is well-formed (Times New
  Roman, 10pt body, 0.5in margins, `education → experience → leadership → skills`).
- **Round-trip fidelity** — a *custom* profile (Arial, 11pt body, 0.5in→0.7in
  margins, `-` bullets, non-caps name) is written into a DOCX and then re-extracted;
  the test asserts fonts, sizes, margins, name casing, **and section order** all
  survive. This is the core "format preservation" claim, tested mechanically rather
  than by eyeballing a document.
- **Precedence** — with an original resume and/or an uploaded template present, the
  resolved profile follows the documented order in all four combinations
  (build-from-scratch vs. improve mode × template present/absent).
- **Parsing** — a real fixture resume ([`alex-carter-resume.docx`](../test/original-resume/alex-carter-resume.docx))
  is parsed into named sections, dated entries, and bullets; a second fixture with a
  *Projects* section confirms the parser is not hard-coded to one layout.

## 2. Grounding: no invented content

The central integrity claim — *"only state facts grounded in the wiki; never invent
claims"* — is enforced in code, not just in the prompt:

- The agent prompt instructs the model to use `"Needs clarification"` for missing
  data and forbids invented facts ([`app/agent.js`](../app/agent.js), `buildResumePrompt`).
- After generation, the result is **normalized defensively**: a missing
  `candidateName`, `skills`, or `interests` is forced to `Needs clarification`, and
  missing list sections become empty arrays rather than fabricated entries
  (`generateResumeValues` in `app/agent.js`).
- The heuristic (non-AI) path applies the same discipline: wiki pages emit
  `Needs clarification` / `Needs verification` markers where evidence is thin
  (`buildProjectsPage`, `buildProfilePage`, `buildOriginalResumePage` in `app/main.js`).

The effect: a gap in the source material surfaces as a visible `Needs clarification`
placeholder the user must resolve, instead of a confident-but-false bullet.

## 3. Format fidelity — methodology and honest limits

Format preservation works by extracting a **style profile** (fonts, sizes, section
order/labels, bullet glyph, margins, name styling) from a source DOCX and
re-rendering the wiki content through it. The round-trip test in §1 is the evidence
that the extract→build→extract loop is lossless for the attributes it claims.

**Known limitations (failure analysis).** Profiles deliberately do **not** reproduce:

- multi-column layouts,
- tables,
- logos or images,
- text boxes / shapes.

A source resume that relies on a two-column layout will come back single-column.
This is documented in the README's *fidelity note* and is a scope decision, not a
bug — but it is the most likely surprise for a user, so it is called out explicitly.

## 4. One-page constraint — deterministic trimming

A one-page resume is enforced by `trimResumeValues` in [`app/main.js`](../app/main.js),
independent of the model. It estimates rendered line count (`estimateResumeLines`,
~100 chars/line) against a budget (`maxLines = 62`) and, only if over budget, applies
an **escalating, priority-ordered** trim:

1. Cap leadership at 3 entries, 1 bullet each.
2. Reduce experience bullets (3 for the two most recent roles, 2 for older).
3. Cap leadership at 2 entries.
4. Further reduce experience (3 for the most recent, 1 for the rest).
5. As a last resort, trim education to 1 bullet each.

It stops at the first step that brings the resume under budget, so it removes the
*least* content necessary. Education and contact info are protected longest;
low-signal leadership and metric-less bullets are dropped first — matching how a
human editor would cut for space.

## 5. Robustness — graceful degradation without AI

The app has two fully independent generation paths:

- **AI path** — when the Claude CLI is detected, evidence/wiki is sent to it
  (`generateWikiPages`, `generateResumeValues` in `app/agent.js`).
- **Heuristic path** — when the CLI is absent, deterministic builders in
  `app/main.js` produce a structured wiki and resume from the same evidence.

The AI path is also defended against partial output: if the model returns JSON that
is missing any of the ten required wiki pages, the code logs the missing pages and
**falls back to the heuristic path** rather than writing a broken wiki
(`generateWikiPages`). JSON extraction itself is tolerant of fenced/embedded output
(`parseAgentJson`). This means the project is demonstrable and testable on a machine
with no AI installed at all — which is also how the automated suite runs in CI-like
conditions.

## 6. End-to-end scenario matrix

[`test/`](../test/) ships a deliberately-formatted persona (Alex Carter, UC Berkeley)
with two visually distinct DOCX fixtures and four new raw-evidence files, so the
resolved format is *obvious* in the output. The documented runs
([`test/README.md`](../test/README.md)):

| Scenario | Inputs | Expected outcome |
| --- | --- | --- |
| **A. Build from scratch (default)** | 4 raw `.md` files | Built-in ATS layout (Times New Roman) |
| **B. Build + template** | A + `modern-template.docx` | Arial, borderless navy headings, 0.5in margins |
| **C. Improve existing** | Original resume + 4 raw files | Keeps original's Cambria / all-caps bordered headings / 0.75in margins, folds in new experience |
| **D. Improve + template override** | C + template | Template wins → Arial format |

Scenario C also demonstrates the **diff view**: the regenerated resume can be
toggled against the original to show exactly which lines were added, changed, or
removed.

## 7. Built-in comparison — the diff view as self-evaluation

For "improve existing resume" runs, the app diffs the new resume against the user's
original (`computeDiffBaseline` in [`app/server.js`](../app/server.js);
rendering in [`app/renderer/renderer.js`](../app/renderer/renderer.js)). New entries,
changed fields, added bullets, and removed bullets are color-coded. This is a form of
evaluation surfaced *to the user*: it makes every change the system made auditable,
so the user can confirm nothing was silently dropped or fabricated before exporting.

## 8. Reproducing these results

```bash
npm install
npm test            # runs the 9 unit tests shown in §1

npm run dev         # http://localhost:3000 — then walk scenarios A–D from test/README.md
```

No API keys or network access are required for the tests or the heuristic path. The
AI path additionally requires a local Claude CLI on `PATH`.

## 9. Summary of limitations

- **Format fidelity** is limited to fonts, sizes, headings/order, bullets, and
  margins — not multi-column layouts, tables, or images (§3).
- **Line estimation** is a heuristic (chars-per-line), not a true text-layout
  measurement, so the one-page guarantee is a close approximation rather than a
  pixel-exact promise (§4).
- **AI output quality** depends on the local model and the richness of the uploaded
  evidence; thin evidence yields more `Needs clarification` placeholders by design.
- The automated suite covers the deterministic core (formatting, parsing,
  precedence); the AI generation path is validated manually via the E2E matrix rather
  than with mocked model responses.
