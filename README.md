# AI Resume Copilot

Minimal project scaffold for an AI resume copilot.

## Idea

Users add sample work into `raw/`. The project turns that raw material into a
structured personal wiki in `wiki/`. Later, the resume generation part reads
from the wiki and creates targeted resume drafts.

## Flow

```text
raw/ -> wiki/ -> ai-resume/
```

## Current Status

- Basic folder structure created
- Raw-to-wiki agent instructions added in `Agents.md`
- Resume generation folder reserved for future implementation

