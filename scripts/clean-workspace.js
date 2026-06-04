/*
 * Resets the local workspace to a clean slate for testing:
 *   - raw/                 -> only README.md
 *   - wiki/                -> only README.md
 *   - ai-resume/original/  -> emptied (uploaded resumes removed)
 *   - ai-resume/exports/   -> only README.md (generated resumes removed)
 *   - .resume-copilot-state.json removed
 *
 * All of the removed content is gitignored, so this never touches anything under
 * version control. Run it anytime with:
 *
 *     npm run clean
 *
 * Cross-platform (pure Node), so it works the same from PowerShell, bash, etc.
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

const targets = [
  { dir: "raw", keep: ["README.md"] },
  { dir: "wiki", keep: ["README.md"] },
  { dir: "ai-resume/original", keep: ["README.md"] },
  { dir: "ai-resume/exports", keep: ["README.md"] }
];

let removed = 0;

for (const { dir, keep } of targets) {
  const fullDir = path.join(root, dir);
  if (!fs.existsSync(fullDir)) {
    fs.mkdirSync(fullDir, { recursive: true });
    continue;
  }
  for (const entry of fs.readdirSync(fullDir)) {
    if (keep.includes(entry)) continue;
    fs.rmSync(path.join(fullDir, entry), { recursive: true, force: true });
    removed += 1;
  }
}

const statePath = path.join(root, ".resume-copilot-state.json");
if (fs.existsSync(statePath)) {
  fs.rmSync(statePath, { force: true });
  removed += 1;
}

console.log(`Workspace cleaned (${removed} item(s) removed).`);
console.log("raw/, wiki/, ai-resume/original/, ai-resume/exports/ are now reset to their README placeholders.");
