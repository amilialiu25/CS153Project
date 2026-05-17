# AI Resume Copilot

Minimal project scaffold for an AI resume copilot.

## Idea

Users add sample work into `raw/`, and the project turns that raw material into
a structured personal wiki in `wiki/`. The resume generation component then
uses the wiki as its source of truth to create targeted resume drafts.

When a user wants to update their resume, they can add new raw files that
represent their latest work. The system updates the wiki first, then refreshes
the resume so the new version stays grounded in the most recent evidence.

## Flow

```text
raw/ -> wiki/ -> ai-resume/
```

## Current Status

- Basic folder structure created
- Raw-to-wiki agent instructions added in `Agents.md`
- Resume generation folder reserved for future implementation
