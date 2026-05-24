const { app, BrowserWindow, ipcMain } = require("electron");
const fs = require("fs/promises");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const rawDir = path.join(projectRoot, "raw");
const wikiDir = path.join(projectRoot, "wiki");
const draftDir = path.join(projectRoot, "ai-resume", "drafts");
const originalResumeDir = path.join(projectRoot, "ai-resume", "original");
const projectStatePath = path.join(projectRoot, ".resume-copilot-state.json");
const hiddenAppFiles = new Set(["README.md", ".DS_Store"]);
const hiddenWikiPages = new Set(["README.md", "change-notes.md"]);
const hiddenDraftPages = new Set(["README.md"]);
const hiddenOriginalResumeFiles = new Set(["README.md"]);
const workflowModes = {
  buildFromScratch: "build-from-scratch",
  improveExistingResume: "improve-existing-resume"
};
const supportedRawTextExtensions = new Set([
  ".md",
  ".txt",
  ".json",
  ".csv",
  ".tsv",
  ".log"
]);

const skillKeywords = [
  "javascript",
  "typescript",
  "node.js",
  "node",
  "electron",
  "react",
  "vue",
  "angular",
  "html",
  "css",
  "python",
  "java",
  "c++",
  "c#",
  "sql",
  "postgres",
  "mysql",
  "mongodb",
  "aws",
  "azure",
  "gcp",
  "docker",
  "kubernetes",
  "git",
  "figma",
  "excel",
  "power bi",
  "tableau",
  "tensorflow",
  "pytorch",
  "llm",
  "openai",
  "prompt engineering",
  "rest api",
  "graphql",
  "linux"
];

async function ensureProjectDirs() {
  await Promise.all([
    fs.mkdir(rawDir, { recursive: true }),
    fs.mkdir(wikiDir, { recursive: true }),
    fs.mkdir(draftDir, { recursive: true }),
    fs.mkdir(originalResumeDir, { recursive: true })
  ]);
}

async function readMarkdownFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const hiddenNames = dir === wikiDir
    ? hiddenWikiPages
    : dir === draftDir
      ? hiddenDraftPages
      : hiddenAppFiles;
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && !hiddenNames.has(entry.name))
    .map((entry) => entry.name)
    .sort();

  return Promise.all(
    files.map(async (name) => ({
      name,
      content: await fs.readFile(path.join(dir, name), "utf8")
    }))
  );
}

async function listVisibleFiles(dir, hiddenNames = hiddenAppFiles) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && !hiddenNames.has(entry.name))
    .map((entry) => entry.name)
    .sort();
}

async function listRawFiles() {
  return listVisibleFiles(rawDir, hiddenAppFiles);
}

async function listOriginalResumeFiles() {
  return listVisibleFiles(originalResumeDir, hiddenOriginalResumeFiles);
}

async function readProjectState() {
  try {
    const raw = await fs.readFile(projectStatePath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      workflowMode: Object.values(workflowModes).includes(parsed.workflowMode)
        ? parsed.workflowMode
        : workflowModes.buildFromScratch,
      lastSourceUpdateAt: typeof parsed.lastSourceUpdateAt === "string" ? parsed.lastSourceUpdateAt : null,
      lastWikiGeneratedAt: typeof parsed.lastWikiGeneratedAt === "string" ? parsed.lastWikiGeneratedAt : null,
      lastResumeGeneratedAt: typeof parsed.lastResumeGeneratedAt === "string" ? parsed.lastResumeGeneratedAt : null
    };
  } catch {
    return {
      workflowMode: workflowModes.buildFromScratch,
      lastSourceUpdateAt: null,
      lastWikiGeneratedAt: null,
      lastResumeGeneratedAt: null
    };
  }
}

async function writeProjectState(state) {
  await fs.writeFile(projectStatePath, JSON.stringify(state, null, 2), "utf8");
}

async function mergeProjectState(updates) {
  const current = await readProjectState();
  const next = { ...current, ...updates };
  await writeProjectState(next);
  return next;
}

function getIsoNow() {
  return new Date().toISOString();
}

function isStateUpToDate(currentTimestamp, dependencyTimestamp) {
  if (!currentTimestamp) {
    return false;
  }

  if (!dependencyTimestamp) {
    return true;
  }

  return Date.parse(currentTimestamp) >= Date.parse(dependencyTimestamp);
}

async function readRawEvidenceFiles() {
  const fileNames = await listRawFiles();
  const evidenceFiles = [];

  for (const name of fileNames) {
    const extension = path.extname(name).toLowerCase();
    const fullPath = path.join(rawDir, name);
    const evidence = {
      name,
      path: fullPath,
      isText: supportedRawTextExtensions.has(extension),
      text: "",
      excerptLines: []
    };

    if (evidence.isText) {
      try {
        evidence.text = await fs.readFile(fullPath, "utf8");
        evidence.excerptLines = getExcerptLines(evidence.text);
      } catch {
        evidence.isText = false;
      }
    }

    evidenceFiles.push(evidence);
  }

  return evidenceFiles;
}

function getExcerptLines(text, maxLines = 4) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, maxLines);
}

function collectBulletCandidates(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^([-*]|\d+\.)\s+/.test(line))
    .slice(0, 8);
}

function collectSentenceCandidates(text) {
  const compactText = text.replace(/\s+/g, " ").trim();
  if (!compactText) {
    return [];
  }

  return compactText
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 40)
    .slice(0, 5);
}

function inferSkills(evidenceFiles) {
  const foundSkills = new Set();

  for (const evidence of evidenceFiles) {
    const haystack = evidence.text.toLowerCase();
    for (const skill of skillKeywords) {
      if (haystack.includes(skill)) {
        foundSkills.add(skill);
      }
    }
  }

  return Array.from(foundSkills).sort((a, b) => a.localeCompare(b));
}

function hasMetricSignal(text) {
  return /\b\d+(\.\d+)?(%|x|k|m)?\b/i.test(text);
}

function hasRoleSignal(text) {
  return /\b(engineer|developer|designer|manager|analyst|intern|lead|founder|researcher|student)\b/i.test(text);
}

function buildProfilePage(evidenceFiles) {
  const textEvidence = evidenceFiles.filter((evidence) => evidence.isText && evidence.text.trim());
  const sourceList = evidenceFiles.length
    ? evidenceFiles.map((evidence) => `- ${evidence.name}`)
    : ["- No raw files uploaded yet."];

  const summaryLines = textEvidence.length
    ? [
        `Generated from ${textEvidence.length} readable raw source file(s).`,
        "This summary is intentionally conservative until stronger extraction logic is added."
      ]
    : [
        "Needs source material from readable text files in `raw/`."
      ];

  const noteLines = textEvidence.length
    ? textEvidence.flatMap((evidence) => [
        `### ${evidence.name}`,
        ...(
          evidence.excerptLines.length
            ? evidence.excerptLines.map((line) => `- ${line}`)
            : ["- Text file was readable but no non-empty excerpt was found."]
        ),
        ""
      ])
    : ["No raw files processed yet."];

  return [
    "# Profile",
    "",
    "## Summary",
    "",
    ...summaryLines,
    "",
    "## Current Goals",
    "",
    "Needs clarification.",
    "",
    "## Sources",
    "",
    ...sourceList,
    "",
    "## Source Notes",
    "",
    ...noteLines
  ].join("\n");
}

function buildSkillsPage(evidenceFiles, skills) {
  const textSources = evidenceFiles.filter((evidence) => evidence.isText).map((evidence) => evidence.name);
  const skillLines = skills.length
    ? skills.map((skill) => `- ${skill}`)
    : ["- No grounded skills identified yet from the current raw text files."];

  return [
    "# Skills",
    "",
    "Skills below are matched directly from raw text and should be reviewed by the user.",
    "",
    "## Detected Skills",
    "",
    ...skillLines,
    "",
    "## Evidence Sources",
    "",
    ...(textSources.length ? textSources.map((name) => `- ${name}`) : ["- No readable text sources yet."])
  ].join("\n");
}

function buildProjectsPage(evidenceFiles) {
  const sections = evidenceFiles.length
    ? evidenceFiles.flatMap((evidence) => {
        const bulletCandidates = evidence.isText ? collectBulletCandidates(evidence.text) : [];
        const sentenceCandidates = evidence.isText ? collectSentenceCandidates(evidence.text) : [];
        const evidenceLines = bulletCandidates.length
          ? bulletCandidates
          : sentenceCandidates.length
            ? sentenceCandidates
            : evidence.excerptLines;

        return [
          `## ${evidence.name}`,
          "",
          `- Source: ${evidence.name}`,
          `- Readable text: ${evidence.isText ? "Yes" : "No"}`,
          "- Context: Needs clarification.",
          "- Role: Needs clarification.",
          "- Outcome: Needs clarification unless supported below.",
          "- Evidence:",
          ...(evidenceLines.length
            ? evidenceLines.map((line) => `  - ${line}`)
            : ["  - No grounded excerpt available yet."]),
          ""
        ];
      })
    : [
        "No projects processed yet.",
        "",
        "Add raw evidence files to begin building project entries."
      ];

  return [
    "# Projects",
    "",
    ...sections
  ].join("\n");
}

function buildResumeBulletsPage(evidenceFiles) {
  const bullets = [];

  for (const evidence of evidenceFiles) {
    if (!evidence.isText) {
      continue;
    }

    const candidates = collectBulletCandidates(evidence.text);
    for (const candidate of candidates) {
      bullets.push(`${candidate}  _(source: ${evidence.name})_`);
      if (bullets.length >= 12) {
        break;
      }
    }

    if (bullets.length >= 12) {
      break;
    }
  }

  return [
    "# Resume-Ready Bullets",
    "",
    "These are conservative bullet candidates copied from raw evidence. They should be edited before final resume use.",
    "",
    ...(bullets.length
      ? bullets.map((bullet) => `- ${bullet}`)
      : ["- No bullet-style evidence found yet in the current raw files."]),
    "",
    "## Review Notes",
    "",
    "- Keep only claims that remain grounded in the source evidence.",
    "- Add metrics, scope, and outcomes only when the raw material supports them."
  ].join("\n");
}

function buildOpenQuestionsPage(evidenceFiles) {
  const combinedText = evidenceFiles
    .filter((evidence) => evidence.isText)
    .map((evidence) => evidence.text)
    .join("\n");

  const questions = [];

  if (!evidenceFiles.length) {
    questions.push("What work samples should be uploaded first?");
  }

  if (evidenceFiles.length && !hasRoleSignal(combinedText)) {
    questions.push("What role or title should be associated with the uploaded work?");
  }

  if (evidenceFiles.length && !hasMetricSignal(combinedText)) {
    questions.push("Are there any measurable outcomes, impact numbers, or scope details for this work?");
  }

  questions.push("Which project or experience should be prioritized for the first resume draft?");

  return [
    "# Open Questions",
    "",
    "Questions below are generated when the current evidence is incomplete.",
    "",
    ...questions.map((question) => `- ${question}`)
  ].join("\n");
}

function buildChangeNotesPage(evidenceFiles, skills) {
  const readableCount = evidenceFiles.filter((evidence) => evidence.isText).length;

  return [
    "# Change Notes",
    "",
    `Updated at: ${new Date().toISOString()}`,
    "",
    "## Summary",
    "",
    `- Raw files discovered: ${evidenceFiles.length}`,
    `- Readable text sources: ${readableCount}`,
    `- Skills matched from evidence: ${skills.length}`,
    "",
    "## Generated Pages",
    "",
    "- `profile.md`",
    "- `skills.md`",
    "- `projects.md`",
    "- `resume-bullets.md`",
    "- `open-questions.md`"
  ].join("\n");
}

async function writeWikiPages(pages) {
  await Promise.all(
    Object.entries(pages).map(([name, content]) =>
      fs.writeFile(path.join(wikiDir, name), content, "utf8")
    )
  );
}

function getPageContent(pages, name) {
  return pages.find((page) => page.name === name)?.content ?? "";
}

function extractMarkdownSection(content, sectionName) {
  const lines = content.split(/\r?\n/);
  const header = `## ${sectionName}`;
  const startIndex = lines.findIndex((line) => line.trim() === header);

  if (startIndex === -1) {
    return [];
  }

  const collected = [];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.startsWith("## ")) {
      break;
    }
    collected.push(line);
  }

  return collected.map((line) => line.trim()).filter((line) => line.length > 0);
}

function extractTopLevelBullets(content) {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "));
}

function buildResumeDraft(wikiPages) {
  const profileContent = getPageContent(wikiPages, "profile.md");
  const skillsContent = getPageContent(wikiPages, "skills.md");
  const bulletsContent = getPageContent(wikiPages, "resume-bullets.md");
  const questionsContent = getPageContent(wikiPages, "open-questions.md");

  const summaryLines = extractMarkdownSection(profileContent, "Summary");
  const skillBullets = extractMarkdownSection(skillsContent, "Detected Skills")
    .filter((line) => line.startsWith("- "))
    .slice(0, 8);
  const resumeBullets = extractTopLevelBullets(
    extractMarkdownSection(bulletsContent, "Review Notes").length
      ? bulletsContent.split("## Review Notes")[0]
      : bulletsContent
  )
    .slice(0, 6);
  const openQuestions = extractTopLevelBullets(questionsContent).slice(0, 5);

  return [
    "# Resume Draft",
    "",
    `Generated at: ${new Date().toISOString()}`,
    "",
    "This draft is generated from the current structured wiki files.",
    "",
    "## Candidate Summary",
    "",
    ...(summaryLines.length ? summaryLines : ["Needs clarification."]),
    "",
    "## Skills Snapshot",
    "",
    ...(skillBullets.length ? skillBullets : ["- No grounded skills available yet."]),
    "",
    "## Experience Bullet Candidates",
    "",
    ...(resumeBullets.length ? resumeBullets : ["- No grounded bullet candidates available yet."]),
    "",
    "## Open Questions",
    "",
    ...(openQuestions.length ? openQuestions : ["- No open questions recorded."]),
    "",
    "## Source Wiki Pages",
    "",
    ...wikiPages.map((page) => `- ${page.name}`)
  ].join("\n");
}

async function createWindow() {
  await ensureProjectDirs();

  const win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 920,
    minHeight: 640,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  await win.loadFile(path.join(__dirname, "renderer", "index.html"));
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

ipcMain.handle("project:getState", async () => {
  await ensureProjectDirs();
  const [projectState, rawFiles, originalResumeFiles, wikiPages, resumeDrafts] = await Promise.all([
    readProjectState(),
    listRawFiles(),
    listOriginalResumeFiles(),
    readMarkdownFiles(wikiDir),
    readMarkdownFiles(draftDir)
  ]);

  return {
    workflowMode: projectState.workflowMode,
    lastSourceUpdateAt: projectState.lastSourceUpdateAt,
    lastWikiGeneratedAt: projectState.lastWikiGeneratedAt,
    lastResumeGeneratedAt: projectState.lastResumeGeneratedAt,
    isWikiReady: isStateUpToDate(projectState.lastWikiGeneratedAt, projectState.lastSourceUpdateAt),
    isResumeFresh: isStateUpToDate(projectState.lastResumeGeneratedAt, projectState.lastWikiGeneratedAt),
    rawFiles,
    originalResumeFiles,
    wikiPages,
    resumeDrafts
  };
});

ipcMain.handle("project:setWorkflowMode", async (_event, workflowMode) => {
  await ensureProjectDirs();
  const nextWorkflowMode = Object.values(workflowModes).includes(workflowMode)
    ? workflowMode
    : workflowModes.buildFromScratch;

  const state = await mergeProjectState({ workflowMode: nextWorkflowMode });
  return { workflowMode: state.workflowMode };
});

ipcMain.handle("raw:uploadFiles", async (_event, files) => {
  await ensureProjectDirs();

  for (const file of files) {
    const safeName = path.basename(file.name);
    const destination = path.join(rawDir, safeName);
    await fs.writeFile(destination, Buffer.from(file.bytes));
  }

  await mergeProjectState({ lastSourceUpdateAt: getIsoNow() });
  return listRawFiles();
});

ipcMain.handle("resume:uploadOriginalFiles", async (_event, files) => {
  await ensureProjectDirs();

  for (const file of files) {
    const safeName = path.basename(file.name);
    const destination = path.join(originalResumeDir, safeName);
    await fs.writeFile(destination, Buffer.from(file.bytes));
  }

  await mergeProjectState({ lastSourceUpdateAt: getIsoNow() });
  return listOriginalResumeFiles();
});

ipcMain.handle("wiki:generate", async () => {
  await ensureProjectDirs();
  const evidenceFiles = await readRawEvidenceFiles();
  const skills = inferSkills(evidenceFiles);

  await writeWikiPages({
    "profile.md": buildProfilePage(evidenceFiles),
    "skills.md": buildSkillsPage(evidenceFiles, skills),
    "projects.md": buildProjectsPage(evidenceFiles),
    "resume-bullets.md": buildResumeBulletsPage(evidenceFiles),
    "open-questions.md": buildOpenQuestionsPage(evidenceFiles),
    "change-notes.md": buildChangeNotesPage(evidenceFiles, skills)
  });

  await mergeProjectState({ lastWikiGeneratedAt: getIsoNow() });
  return readMarkdownFiles(wikiDir);
});

ipcMain.handle("resume:generate", async () => {
  await ensureProjectDirs();
  const wikiPages = await readMarkdownFiles(wikiDir);
  const content = buildResumeDraft(wikiPages);

  await fs.writeFile(path.join(draftDir, "resume-draft.md"), content, "utf8");
  await mergeProjectState({ lastResumeGeneratedAt: getIsoNow() });
  return readMarkdownFiles(draftDir);
});

