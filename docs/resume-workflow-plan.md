# Resume Workflow Plan

This document defines the intended product modes for the local app and should be
kept aligned with `Agents.md` and `docs/agent-progress.md`.

## Product Goal

Support both users who need a first resume and users who already have a resume
they want to polish or update.

## Mode 1: Build From Scratch

Best for:

- users with no usable resume
- users changing career direction and wanting a fresh draft

Primary flow:

1. Upload raw evidence into `raw/`.
2. Generate or update `wiki/`.
3. Generate a resume draft from `wiki/`.
4. Let the user review and refine.

Expected wiki role:

- central source of truth
- stores extracted facts, impact, skills, and open questions

Template policy:

- start with one default ATS-friendly template
- use a simple single-column layout first
- add more templates later as explicit choices

## Mode 2: Improve Existing Resume

Best for:

- users who already have a resume and want better writing
- users who want their current resume updated with fresh work

Primary flow:

1. Upload the original resume into `ai-resume/original/`.
2. Parse the original resume and convert it into `wiki/`.
3. Optionally upload fresh raw evidence into `raw/`.
4. Merge original resume facts and raw evidence into `wiki/`.
5. Generate either:
   - a polished version of the original resume, or
   - an updated version with new experience incorporated

Important behavior:

- polishing should work even if the user only uploads the original resume
- updating should work best when the user uploads both the original resume and
  new raw evidence
- the original resume should always create or enrich wiki state

## File Format Guidance

Preferred original resume input:

- `.docx` first choice for structured extraction
- text-based `.pdf` acceptable and should be supported

Rationale:

- `.docx` is usually easier to parse into structured sections reliably
- text-based `.pdf` is common in the real world and must be supported for user
  convenience
- scanned-image PDFs are lower quality inputs and may require OCR later

Short rule:

- if the user can choose, recommend `.docx`
- if the user already has a `.pdf`, accept it

## Default Template Direction

The initial default template should be:

- ATS-friendly
- single-column
- chronological or hybrid
- low-decoration
- safe for both PDF export and Word export

Current recommendation:

- use `ai-resume/templates/default-ats.docx` as the initial conservative default
  DOCX template
- keep `ai-resume/templates/default-ats.docx` as the Word formatting reference
- keep the initial template aligned with the provided Word resume style:
  centered name/contact line, section labels with horizontal rules, compact
  single-column sections, and metric-forward bullets
- do not block workflow on a large template library
- add user-selectable templates after the update flow works

Export policy:

- generate DOCX as the source-of-truth formatted artifact first
- when an original `.docx` resume exists, preserve that document as the export
  baseline until a model-backed polish/update step can safely rewrite it
- convert DOCX to PDF when LibreOffice/soffice or Microsoft Word automation is
  available locally
- do not generate Markdown resume drafts; Markdown remains limited to the wiki
  knowledge base
- fill DOCX placeholder templates before using any programmatic fallback builder

Notes from current web research:

- Jobscan recommends a clean single-column format and says text-based PDF or
  Word documents are both ATS-friendly.
- Jobscan also warns against tables, text boxes, and multi-column layouts for
  consistent parsing across ATS systems.
- Harvard career guidance emphasizes tailoring the resume to the target role and
  ensuring formatting translates properly when exported to PDF.

Sources:

- [Jobscan ATS format guide](https://www.jobscan.co/blog/20-ats-friendly-resume-templates/)
- [Jobscan columns warning](https://www.jobscan.co/blog/resume-tables-columns-ats/)
- [Harvard resume guidance](https://careerservices.fas.harvard.edu/resources/hes-create-an-impactful-resume/)

## Planned Implementation Order

1. Add original resume upload support in the UI and filesystem.
2. Add `ai-resume/original/` folder handling in the app state.
3. Create a resume-import step that parses original resume content into wiki pages.
   Initial `.docx` support writes imported facts to `wiki/original-resume.md`;
   PDF support remains future work.
   Wiki generation now also creates source summary pages, concept pages,
   `wiki/index.md`, and `wiki/log.md`.
4. Split resume actions into:
   - Polish existing resume
   - Update resume with new evidence
   - Build resume from scratch
5. Expand DOCX template filling to user-selected templates.
6. Later add richer template selection and export variants.

## Non-Goals For The First Pass

- large template gallery
- pixel-perfect PDF design system
- full OCR pipeline for scanned resumes
- automatic job-target tailoring before the basic two-mode workflow works
