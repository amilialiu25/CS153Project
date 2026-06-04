# E2E Test Fixtures

Mock files for manually exercising the resume copilot end-to-end. Nothing here
is uploaded automatically — upload them through the web UI yourself.

Persona: **Alex Carter**, a UC Berkeley CS student. The original resume holds an
earlier version of their experience; the `raw/` files are *new* experiences to
be merged in during an update.

## Contents

```
test/
  generate-mock-files.js          # regenerates the two .docx files below
  original-resume/
    alex-carter-resume.docx        # classic serif: Cambria, all-caps bordered
                                    # headings, 0.75in margins
  template/
    modern-template.docx           # modern sans: Arial, Title-Case borderless
                                    # headings (navy), 0.5in margins
  raw/
    candidate-profile.md           # name, contact, summary, education
    backend-internship.md          # NEW: Plaid SWE internship (metrics-heavy)
    ml-research-project.md         # NEW: BAIR research assistant
    open-source-contribution.md    # NEW: Apache Arrow contributions
    teaching-assistant.md          # NEW: CS 61B TA (leadership)
```

The original resume and the template are intentionally formatted very
differently so the resolved style profile is obvious in the generated output.

## Suggested E2E runs

Start the app: `npm run dev` → http://localhost:3000

**A. Build from scratch (default format)**
1. Workflow = "Build from scratch".
2. Upload the four `test/raw/*.md` files as raw evidence.
3. Generate Wiki → Generate Resume.
4. Expect the built-in ATS layout (Times New Roman).

**B. Build from scratch with a template**
1. Same as A, but also upload `template/modern-template.docx` as a template.
2. Generated resume should adopt Arial / borderless navy headings / 0.5in margins.

**C. Improve existing — preserve original format**
1. Workflow = "Improve existing".
2. Upload `original-resume/alex-carter-resume.docx` as the resume.
3. Upload the four `test/raw/*.md` files as raw evidence.
4. Generate Wiki → Generate Resume.
5. Generated resume should keep the original's Cambria / all-caps bordered
   headings / 0.75in margins, while now including the new raw experiences.
6. Toggle "Show Changes" to see the diff vs. the previous generation.

**D. Improve existing + template override**
1. Same as C, but also upload `template/modern-template.docx`.
2. The uploaded template wins: output should be in the Arial template format.

## Regenerating the .docx fixtures

```
node test/generate-mock-files.js
```
