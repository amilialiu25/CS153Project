const { spawn } = require("child_process");
const {
  AlignmentType,
  BorderStyle,
  Document,
  LineRuleType,
  Packer,
  PageOrientation,
  Paragraph,
  LevelFormat,
  TabStopPosition,
  TabStopType,
  TextRun
} = require("docx");
const fs = require("fs/promises");
const JSZip = require("jszip");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const rawDir = path.join(projectRoot, "raw");
const wikiDir = path.join(projectRoot, "wiki");
const exportDir = path.join(projectRoot, "ai-resume", "exports");
const templateDir = path.join(projectRoot, "ai-resume", "templates");
const defaultDocxTemplatePath = path.join(templateDir, "default-ats.docx");
const originalResumeDir = path.join(projectRoot, "ai-resume", "original");
const projectStatePath = path.join(projectRoot, ".resume-copilot-state.json");
const hiddenAppFiles = new Set(["README.md", ".DS_Store"]);
const hiddenWikiPages = new Set(["README.md", "change-notes.md"]);
const hiddenOriginalResumeFiles = new Set(["README.md"]);
// default-ats.docx is the built-in fallback template, not a user upload — hide it
// from the template list so it can't be deleted through the UI.
const hiddenTemplateFiles = new Set(["README.md", "default-ats.docx"]);
const hiddenExportFiles = new Set(["README.md"]);
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
    fs.mkdir(exportDir, { recursive: true }),
    fs.mkdir(templateDir, { recursive: true }),
    fs.mkdir(originalResumeDir, { recursive: true })
  ]);
}

async function readMarkdownFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const hiddenNames = dir === wikiDir
    ? hiddenWikiPages
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

async function listResumeTemplateFiles() {
  return listVisibleFiles(templateDir, hiddenTemplateFiles);
}

async function listExportFiles() {
  return listVisibleFiles(exportDir, hiddenExportFiles);
}

function getManagedFileDirectory(fileGroup) {
  if (fileGroup === "raw") {
    return { dir: rawDir, hiddenNames: hiddenAppFiles, sourceAffectsWiki: true };
  }

  if (fileGroup === "originalResume") {
    return { dir: originalResumeDir, hiddenNames: hiddenOriginalResumeFiles, sourceAffectsWiki: true };
  }

  if (fileGroup === "template") {
    return { dir: templateDir, hiddenNames: hiddenTemplateFiles, sourceAffectsWiki: false };
  }

  if (fileGroup === "export") {
    return { dir: exportDir, hiddenNames: hiddenExportFiles, sourceAffectsWiki: false };
  }

  throw new Error("Unsupported file group.");
}

async function deleteManagedFile(fileGroup, fileName) {
  const { dir, hiddenNames, sourceAffectsWiki } = getManagedFileDirectory(fileGroup);
  const safeName = path.basename(fileName);

  if (!safeName || hiddenNames.has(safeName)) {
    throw new Error("This file cannot be deleted from the app.");
  }

  await fs.rm(path.join(dir, safeName), { force: true });

  if (sourceAffectsWiki) {
    await mergeProjectState({ lastSourceUpdateAt: getIsoNow() });
  }
}

// Extract a previewable text view of an uploaded source file (raw evidence,
// original resume, or template). DOCX is run through the same text extractor
// used for wiki generation; plain-text formats are returned as-is.
async function readManagedFileText(fileGroup, fileName) {
  const { dir, hiddenNames } = getManagedFileDirectory(fileGroup);
  const safeName = path.basename(fileName);

  if (!safeName || hiddenNames.has(safeName)) {
    throw new Error("This file cannot be previewed.");
  }

  const fullPath = path.join(dir, safeName);
  const extension = path.extname(safeName).toLowerCase();

  if (extension === ".docx") {
    const text = await extractDocxText(fullPath);
    const resume = await parseResumeDocx(fullPath);
    return { name: safeName, kind: "docx", isText: text.trim().length > 0, text, resume };
  }

  if (supportedRawTextExtensions.has(extension)) {
    const text = await fs.readFile(fullPath, "utf8");
    return { name: safeName, kind: "text", isText: true, text };
  }

  return { name: safeName, kind: "binary", isText: false, text: "" };
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
      sourceType: "raw",
      isText: false,
      text: "",
      excerptLines: []
    };

    try {
      if (extension === ".docx") {
        evidence.text = await extractDocxText(fullPath);
        evidence.isText = evidence.text.trim().length > 0;
      } else if (supportedRawTextExtensions.has(extension)) {
        evidence.text = await fs.readFile(fullPath, "utf8");
        evidence.isText = evidence.text.trim().length > 0;
      }

      if (evidence.isText) {
        evidence.excerptLines = getExcerptLines(evidence.text);
      }
    } catch {
      evidence.isText = false;
    }

    evidenceFiles.push(evidence);
  }

  return evidenceFiles;
}

async function readOriginalResumeEvidenceFiles() {
  const fileNames = await listOriginalResumeFiles();
  const evidenceFiles = [];

  for (const name of fileNames) {
    const extension = path.extname(name).toLowerCase();
    const fullPath = path.join(originalResumeDir, name);
    const evidence = {
      name,
      path: fullPath,
      sourceType: "original resume",
      isText: false,
      text: "",
      excerptLines: []
    };

    try {
      if (extension === ".docx") {
        evidence.text = await extractDocxText(fullPath);
        evidence.isText = evidence.text.trim().length > 0;
      } else if (supportedRawTextExtensions.has(extension)) {
        evidence.text = await fs.readFile(fullPath, "utf8");
        evidence.isText = evidence.text.trim().length > 0;
      }

      if (evidence.isText) {
        evidence.excerptLines = getExcerptLines(evidence.text);
      }
    } catch {
      evidence.isText = false;
    }

    evidenceFiles.push(evidence);
  }

  return evidenceFiles;
}

async function readAllEvidenceFiles() {
  const [rawEvidenceFiles, originalResumeEvidenceFiles] = await Promise.all([
    readRawEvidenceFiles(),
    readOriginalResumeEvidenceFiles()
  ]);

  return [...originalResumeEvidenceFiles, ...rawEvidenceFiles];
}

async function extractDocxText(filePath) {
  const zip = await JSZip.loadAsync(await fs.readFile(filePath));
  const documentFile = zip.file("word/document.xml");

  if (!documentFile) {
    return "";
  }

  const documentXml = await documentFile.async("string");
  const paragraphMatches = documentXml.match(/<w:p\b[\s\S]*?<\/w:p>/g) ?? [];
  const lines = paragraphMatches
    .map((paragraphXml) => extractDocxParagraphText(paragraphXml))
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.join("\n");
}

function extractDocxParagraphText(paragraphXml) {
  const hasNumbering = /<w:numPr\b/.test(paragraphXml);
  const tokenMatches = paragraphXml.match(/<w:t\b[^>]*>[\s\S]*?<\/w:t>|<w:tab\/>|<w:br\/>/g) ?? [];
  let text = "";

  for (const token of tokenMatches) {
    if (token === "<w:tab/>") {
      text += "\t";
    } else if (token === "<w:br/>") {
      text += "\n";
    } else {
      text += decodeXmlText(token.replace(/^<w:t\b[^>]*>/, "").replace(/<\/w:t>$/, ""));
    }
  }

  const compactText = text.replace(/[ \t]+/g, " ").trim();
  const normalizedText = normalizeExtractedText(compactText);
  return hasNumbering && normalizedText ? `- ${normalizedText}` : normalizedText;
}

function decodeXmlText(text) {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function normalizeExtractedText(text) {
  return text;

  return text
    .replaceAll("鈥檚", "'s")
    .replaceAll("鈥檛", "'t")
    .replaceAll("鈥檙", "'r")
    .replaceAll("鈥檝", "'v")
    .replaceAll("鈥檒", "'l")
    .replaceAll("鈥檇", "'d")
    .replaceAll("鈥?", "-")
    .replaceAll("鈥�", "-")
    .replaceAll("鈥�", "\"")
    .replaceAll("鈥�", "\"")
    .replaceAll("鈩�", "(TM)");
}

function getExcerptLines(text, maxLines = 4) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, maxLines);
}

function collectBulletCandidates(text, maxItems = 8) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^([-*]|\d+\.)\s+/.test(line))
    .slice(0, maxItems);
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
    ? evidenceFiles.map((evidence) => `- ${evidence.name} (${evidence.sourceType})`)
    : ["- No source files uploaded yet."];

  const summaryLines = textEvidence.length
    ? [
        `Generated from ${textEvidence.length} readable source file(s).`,
        "This summary is intentionally conservative until stronger extraction logic is added."
      ]
    : [
        "Needs source material from readable files in `raw/` or `ai-resume/original/`."
      ];

  const noteLines = textEvidence.length
    ? textEvidence.flatMap((evidence) => [
        `### ${evidence.name} (${evidence.sourceType})`,
        ...(
          evidence.excerptLines.length
            ? evidence.excerptLines.map((line) => `- ${line}`)
            : ["- Text file was readable but no non-empty excerpt was found."]
        ),
        ""
      ])
    : ["No source files processed yet."];

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
          `- Source type: ${evidence.sourceType}`,
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

    const candidates = collectBulletCandidates(evidence.text, 24);
    for (const candidate of candidates) {
      bullets.push(`${stripMarkdown(candidate)}  _(source: ${evidence.name})_`);
      if (bullets.length >= 24) {
        break;
      }
    }

    if (bullets.length >= 24) {
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

function buildOriginalResumePage(evidenceFiles) {
  const originalResumeEvidence = evidenceFiles.filter(
    (evidence) => evidence.sourceType === "original resume" && evidence.isText && evidence.text.trim()
  );

  if (!originalResumeEvidence.length) {
    return [
      "# Original Resume Import",
      "",
      "No readable original resume has been imported yet."
    ].join("\n");
  }

  const sections = originalResumeEvidence.flatMap((evidence) => {
    const lines = evidence.text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const importedBullets = collectBulletCandidates(evidence.text, 100).map(stripMarkdown);
    const sectionHeadings = lines.filter((line) => isResumeSectionHeading(line));

    return [
      `## ${evidence.name}`,
      "",
      "### Imported Contact",
      "",
      `- Name: ${lines[0] ?? "Needs clarification"}`,
      `- Contact: ${lines[1] ?? "Needs clarification"}`,
      "",
      "### Detected Sections",
      "",
      ...(sectionHeadings.length ? sectionHeadings.map((line) => `- ${line}`) : ["- Needs clarification"]),
      "",
      "### Imported Resume Bullets",
      "",
      ...(importedBullets.length ? importedBullets : ["- No bullet-style resume lines found."]),
      "",
      "### Full Imported Text",
      "",
      ...lines.map((line) => /^[-*]\s+/.test(line) ? line : `- ${line}`),
      ""
    ];
  });

  return [
    "# Original Resume Import",
    "",
    "Facts below were imported from user-provided original resume files. Review before using them as final truth.",
    "",
    ...sections
  ].join("\n");
}

function isResumeSectionHeading(line) {
  return /^[A-Z][A-Z\s,&]+$/.test(line) && line.length <= 60;
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
  const rawCount = evidenceFiles.filter((evidence) => evidence.sourceType === "raw").length;
  const originalResumeCount = evidenceFiles.filter((evidence) => evidence.sourceType === "original resume").length;

  return [
    "# Change Notes",
    "",
    `Updated at: ${new Date().toISOString()}`,
    "",
    "## Summary",
    "",
    `- Source files discovered: ${evidenceFiles.length}`,
    `- Raw files discovered: ${rawCount}`,
    `- Original resume files discovered: ${originalResumeCount}`,
    `- Readable text sources: ${readableCount}`,
    `- Skills matched from evidence: ${skills.length}`,
    "",
    "## Generated Pages",
    "",
    "- `profile.md`",
    "- `skills.md`",
    "- `projects.md`",
    "- `resume-bullets.md`",
    "- `original-resume.md`",
    "- `open-questions.md`"
  ].join("\n");
}

function getEvidenceLines(evidence) {
  return evidence.text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function getReadableEvidence(evidenceFiles) {
  return evidenceFiles.filter((evidence) => evidence.isText && evidence.text.trim());
}

function getSourceSlug(sourceName) {
  const baseName = path.basename(sourceName, path.extname(sourceName));
  const slug = baseName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "source";
}

function wikiLink(pageName) {
  return `[[${pageName}]]`;
}

function sourceCitation(sourceName) {
  return `(source: ${sourceName})`;
}

function formatWikiPage({ title, summary, sources, updatedAt, bodyLines, relatedPages }) {
  const sourceLines = sources.length
    ? sources.map((source) => `- ${source}`)
    : ["- Needs verification"];
  const relatedLines = relatedPages.length
    ? relatedPages.map((page) => `- ${wikiLink(page)}`)
    : ["- None yet"];

  return [
    `# ${title}`,
    "",
    `**Summary**: ${summary}`,
    "",
    "**Sources**:",
    ...sourceLines,
    "",
    `**Last updated**: ${updatedAt}`,
    "",
    "---",
    "",
    ...bodyLines,
    "",
    "## Related pages",
    "",
    ...relatedLines
  ].join("\n");
}

function splitResumeSections(lines) {
  const sections = new Map();
  let currentSection = "header";
  sections.set(currentSection, []);

  for (const line of lines) {
    if (isResumeSectionHeading(line)) {
      currentSection = line.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      sections.set(currentSection, []);
      continue;
    }

    sections.get(currentSection).push(line);
  }

  return sections;
}

function getSectionLines(evidenceFiles, sectionName) {
  const rows = [];

  for (const evidence of getReadableEvidence(evidenceFiles)) {
    const sections = splitResumeSections(getEvidenceLines(evidence));
    const lines = sections.get(sectionName) ?? [];
    for (const line of lines) {
      rows.push({ line, source: evidence.name });
    }
  }

  return rows;
}

function getAllBulletRows(evidenceFiles, maxItems = 100) {
  const rows = [];

  for (const evidence of getReadableEvidence(evidenceFiles)) {
    const bullets = collectBulletCandidates(evidence.text, maxItems).map(stripMarkdown);
    for (const bullet of bullets) {
      rows.push({ line: bullet, source: evidence.name });
      if (rows.length >= maxItems) {
        return rows;
      }
    }
  }

  return rows;
}

function getHeaderRows(evidenceFiles) {
  for (const evidence of getReadableEvidence(evidenceFiles)) {
    const header = splitResumeSections(getEvidenceLines(evidence)).get("header") ?? [];
    if (header.length) {
      return { source: evidence.name, lines: header };
    }
  }

  return { source: "", lines: [] };
}

function citeRows(rows) {
  return rows.length
    ? rows.map((row) => `- ${stripMarkdown(row.line)} ${sourceCitation(row.source)}`)
    : ["- Needs verification"];
}

function buildSourceWikiPage(evidence, updatedAt) {
  const lines = evidence.isText ? getEvidenceLines(evidence) : [];
  const sections = lines.filter((line) => isResumeSectionHeading(line));
  const bullets = evidence.isText ? collectBulletCandidates(evidence.text, 100).map(stripMarkdown) : [];
  const sourcePage = getSourceSlug(evidence.name);
  const relatedPages = [
    "profile",
    "education",
    "work-experience",
    "leadership-experience",
    "skills",
    "resume-bullets"
  ];

  const bodyLines = [
    `This source is connected to ${wikiLink("profile")}, ${wikiLink("resume-bullets")}, and the relevant experience pages.`,
    "",
    "## Key takeaways",
    "",
    `- Source type: ${evidence.sourceType} ${sourceCitation(evidence.name)}`,
    `- Readable text: ${evidence.isText ? "Yes" : "No"} ${sourceCitation(evidence.name)}`,
    `- Detected section count: ${sections.length} ${sourceCitation(evidence.name)}`,
    `- Imported bullet count: ${bullets.length} ${sourceCitation(evidence.name)}`,
    "",
    "## Detected sections",
    "",
    ...(sections.length ? sections.map((section) => `- ${section} ${sourceCitation(evidence.name)}`) : ["- Needs verification"]),
    "",
    "## Imported bullets",
    "",
    ...(bullets.length ? bullets.map((bullet) => `- ${bullet} ${sourceCitation(evidence.name)}`) : ["- No bullet-style lines found."]),
    "",
    "## Extracted text",
    "",
    ...(lines.length ? lines.map((line) => `- ${stripMarkdown(line)} ${sourceCitation(evidence.name)}`) : ["- No readable text extracted."])
  ];

  return {
    pageName: sourcePage,
    title: path.basename(evidence.name),
    description: `Source summary for ${evidence.name}.`,
    content: formatWikiPage({
      title: path.basename(evidence.name),
      summary: `Source summary for ${evidence.name}.`,
      sources: [evidence.name],
      updatedAt,
      bodyLines,
      relatedPages
    })
  };
}

function buildProfileWikiPage(evidenceFiles, updatedAt) {
  const header = getHeaderRows(evidenceFiles);
  const source = header.source || "Needs verification";
  const name = header.lines[0] ?? "Needs verification";
  const contact = header.lines[1] ?? "Needs verification";

  return formatWikiPage({
    title: "Profile",
    summary: "Candidate identity and contact details imported from the available resume evidence.",
    sources: header.source ? [header.source] : [],
    updatedAt,
    bodyLines: [
      `The candidate name is ${name} ${header.source ? sourceCitation(source) : "(Needs verification)"}.`,
      `The contact line is ${contact} ${header.source ? sourceCitation(source) : "(Needs verification)"}.`,
      "",
      "## Resume identity",
      "",
      `- Name: ${name} ${header.source ? sourceCitation(source) : "(Needs verification)"}`,
      `- Contact: ${contact} ${header.source ? sourceCitation(source) : "(Needs verification)"}`,
      "",
      `This page links the identity layer to ${wikiLink("education")}, ${wikiLink("work-experience")}, and ${wikiLink("skills")}.`
    ],
    relatedPages: ["education", "work-experience", "leadership-experience", "skills", "resume-bullets"]
  });
}

function buildSectionWikiPage({ title, pageName, summary, evidenceFiles, sectionName, updatedAt, relatedPages }) {
  const rows = getSectionLines(evidenceFiles, sectionName);

  return formatWikiPage({
    title,
    summary,
    sources: Array.from(new Set(rows.map((row) => row.source))),
    updatedAt,
    bodyLines: [
      `This page extracts resume-useful details from ${wikiLink("source-index")} and connects them to ${wikiLink("resume-bullets")}.`,
      "",
      "## Imported details",
      "",
      ...citeRows(rows)
    ],
    relatedPages
  });
}

function buildSkillsWikiPage(evidenceFiles, skills, updatedAt) {
  const skillSectionRows = getSectionLines(evidenceFiles, "skills-activities-interests");
  const sourceNames = Array.from(new Set([
    ...skillSectionRows.map((row) => row.source),
    ...getReadableEvidence(evidenceFiles).map((evidence) => evidence.name)
  ]));

  return formatWikiPage({
    title: "Skills",
    summary: "Skills and interests grounded in uploaded source material.",
    sources: sourceNames,
    updatedAt,
    bodyLines: [
      `Detected skills should be reviewed before final resume use and cross-checked with ${wikiLink("resume-bullets")}.`,
      "",
      "## Keyword matches",
      "",
      ...(skills.length
        ? skills.map((skill) => `- ${skill} ${sourceNames.length ? sourceCitation(sourceNames[0]) : "(Needs verification)"}`)
        : ["- Needs verification"]),
      "",
      "## Imported skills section",
      "",
      ...citeRows(skillSectionRows)
    ],
    relatedPages: ["profile", "education", "work-experience", "resume-bullets"]
  });
}

function buildResumeBulletsWikiPage(evidenceFiles, updatedAt) {
  const rows = getAllBulletRows(evidenceFiles, 100);

  return formatWikiPage({
    title: "Resume Bullets",
    summary: "Resume-ready bullet candidates copied from source evidence without inventing unsupported claims.",
    sources: Array.from(new Set(rows.map((row) => row.source))),
    updatedAt,
    bodyLines: [
      `These bullets are grounded excerpts. Use ${wikiLink("impact-metrics")} to identify quantified claims.`,
      "",
      "## Imported bullets",
      "",
      ...citeRows(rows)
    ],
    relatedPages: ["work-experience", "leadership-experience", "impact-metrics", "skills"]
  });
}

function buildImpactMetricsWikiPage(evidenceFiles, updatedAt) {
  const rows = getAllBulletRows(evidenceFiles, 100).filter((row) => hasMetricSignal(row.line));

  return formatWikiPage({
    title: "Impact Metrics",
    summary: "Quantified outcomes, scope, and metrics found in the source evidence.",
    sources: Array.from(new Set(rows.map((row) => row.source))),
    updatedAt,
    bodyLines: [
      `Metrics here are candidates for high-impact bullets in ${wikiLink("resume-bullets")}.`,
      "",
      "## Metric-backed claims",
      "",
      ...citeRows(rows)
    ],
    relatedPages: ["resume-bullets", "work-experience", "leadership-experience"]
  });
}

function buildProjectsWikiPage(evidenceFiles, updatedAt) {
  const rows = getAllBulletRows(evidenceFiles, 100).filter((row) =>
    /\b(project|research|startup|initiative|model|algorithm|product|pipeline|framework|program)\b/i.test(row.line)
  );

  return formatWikiPage({
    title: "Projects and Work Samples",
    summary: "Project-like work, research, initiatives, and concrete work samples extracted from source evidence.",
    sources: Array.from(new Set(rows.map((row) => row.source))),
    updatedAt,
    bodyLines: [
      `Use this page to connect concrete work examples to ${wikiLink("resume-bullets")} and ${wikiLink("impact-metrics")}.`,
      "",
      "## Candidate projects and work samples",
      "",
      ...citeRows(rows)
    ],
    relatedPages: ["work-experience", "leadership-experience", "impact-metrics", "resume-bullets"]
  });
}

function buildOpenQuestionsWikiPage(evidenceFiles, updatedAt) {
  const combinedText = getReadableEvidence(evidenceFiles).map((evidence) => evidence.text).join("\n");
  const questions = [];

  if (!getReadableEvidence(evidenceFiles).length) {
    questions.push("What resume or work sample should be uploaded first?");
  }

  if (getReadableEvidence(evidenceFiles).length && !hasRoleSignal(combinedText)) {
    questions.push("Which role or title should anchor the resume?");
  }

  if (getReadableEvidence(evidenceFiles).length && !hasMetricSignal(combinedText)) {
    questions.push("Which measurable outcomes or scope details can be verified?");
  }

  questions.push("What target role, company, or resume style should guide the next draft?");

  return formatWikiPage({
    title: "Open Questions",
    summary: "Clarifying questions that would improve resume generation quality.",
    sources: getReadableEvidence(evidenceFiles).map((evidence) => evidence.name),
    updatedAt,
    bodyLines: [
      `Resolve these questions before relying on ${wikiLink("resume-bullets")} for a final resume.`,
      "",
      "## Questions",
      "",
      ...questions.map((question) => `- ${question} (Needs verification)`)
    ],
    relatedPages: ["profile", "resume-bullets", "skills"]
  });
}

function buildOriginalResumeWikiPage(evidenceFiles, updatedAt) {
  const originalResumeEvidence = getReadableEvidence(evidenceFiles).filter(
    (evidence) => evidence.sourceType === "original resume"
  );

  if (!originalResumeEvidence.length) {
    return formatWikiPage({
      title: "Original Resume",
      summary: "Tracks imported facts from the user's original resume when one exists.",
      sources: [],
      updatedAt,
      bodyLines: ["No readable original resume has been imported yet."],
      relatedPages: ["profile", "resume-bullets"]
    });
  }

  const bodyLines = originalResumeEvidence.flatMap((evidence) => {
    const lines = getEvidenceLines(evidence);
    const bullets = collectBulletCandidates(evidence.text, 100).map(stripMarkdown);
    const sections = lines.filter((line) => isResumeSectionHeading(line));

    return [
      `## ${evidence.name}`,
      "",
      "### Imported contact",
      "",
      `- Name: ${lines[0] ?? "Needs verification"} ${sourceCitation(evidence.name)}`,
      `- Contact: ${lines[1] ?? "Needs verification"} ${sourceCitation(evidence.name)}`,
      "",
      "### Detected sections",
      "",
      ...(sections.length ? sections.map((section) => `- ${section} ${sourceCitation(evidence.name)}`) : ["- Needs verification"]),
      "",
      "### Imported resume bullets",
      "",
      ...(bullets.length ? bullets.map((bullet) => `- ${bullet} ${sourceCitation(evidence.name)}`) : ["- No bullet-style resume lines found."]),
      "",
      "### Full imported text",
      "",
      ...lines.map((line) => `- ${stripMarkdown(line)} ${sourceCitation(evidence.name)}`),
      ""
    ];
  });

  return formatWikiPage({
    title: "Original Resume",
    summary: "Structured mirror of uploaded original resume files for improve-existing-resume workflows.",
    sources: originalResumeEvidence.map((evidence) => evidence.name),
    updatedAt,
    bodyLines: [
      `This page preserves the imported resume source and links it to ${wikiLink("profile")} and ${wikiLink("resume-bullets")}.`,
      "",
      ...bodyLines
    ],
    relatedPages: ["profile", "education", "work-experience", "leadership-experience", "skills", "resume-bullets"]
  });
}

function buildSourceIndexWikiPage(evidenceFiles, updatedAt) {
  const readableEvidence = getReadableEvidence(evidenceFiles);
  const bodyLines = [
    `This page lists all sources imported into the wiki and links to their source summary pages.`,
    "",
    "## Sources",
    "",
    ...(evidenceFiles.length
      ? evidenceFiles.map((evidence) =>
          `- ${wikiLink(getSourceSlug(evidence.name))}: ${evidence.sourceType}; readable=${evidence.isText ? "yes" : "no"} ${sourceCitation(evidence.name)}`
        )
      : ["- No source files uploaded yet."])
  ];

  return formatWikiPage({
    title: "Source Index",
    summary: "Inventory of source files currently represented in the wiki.",
    sources: readableEvidence.map((evidence) => evidence.name),
    updatedAt,
    bodyLines,
    relatedPages: ["profile", "original-resume", "resume-bullets"]
  });
}

async function buildWikiPages(evidenceFiles, skills) {
  const updatedAt = new Date().toISOString();
  const pages = {};
  const pageDescriptions = new Map();

  function addPage(name, description, content) {
    pages[`${name}.md`] = content;
    pageDescriptions.set(name, description);
  }

  for (const evidence of evidenceFiles) {
    const sourcePage = buildSourceWikiPage(evidence, updatedAt);
    addPage(sourcePage.pageName, sourcePage.description, sourcePage.content);
  }

  addPage("source-index", "Inventory of source files represented in the wiki.", buildSourceIndexWikiPage(evidenceFiles, updatedAt));
  addPage("profile", "Candidate identity and contact details.", buildProfileWikiPage(evidenceFiles, updatedAt));
  addPage("education", "Education history and academic details.", buildSectionWikiPage({
    title: "Education",
    pageName: "education",
    summary: "Education history extracted from source material.",
    evidenceFiles,
    sectionName: "education",
    updatedAt,
    relatedPages: ["profile", "skills", "resume-bullets"]
  }));
  addPage("work-experience", "Professional work experience imported from source material.", buildSectionWikiPage({
    title: "Work Experience",
    pageName: "work-experience",
    summary: "Professional roles and work-impact details extracted from source material.",
    evidenceFiles,
    sectionName: "work-experience",
    updatedAt,
    relatedPages: ["resume-bullets", "impact-metrics", "skills"]
  }));
  addPage("leadership-experience", "Leadership, research, and activity experience imported from source material.", buildSectionWikiPage({
    title: "Leadership Experience",
    pageName: "leadership-experience",
    summary: "Leadership and extracurricular experience extracted from source material.",
    evidenceFiles,
    sectionName: "leadership-experience",
    updatedAt,
    relatedPages: ["resume-bullets", "impact-metrics", "skills"]
  }));
  addPage("skills", "Skills and interests grounded in uploaded sources.", buildSkillsWikiPage(evidenceFiles, skills, updatedAt));
  addPage("resume-bullets", "Grounded resume bullet candidates.", buildResumeBulletsWikiPage(evidenceFiles, updatedAt));
  addPage("impact-metrics", "Metric-backed claims and quantified impact.", buildImpactMetricsWikiPage(evidenceFiles, updatedAt));
  addPage("projects", "Project-like work samples and concrete initiatives.", buildProjectsWikiPage(evidenceFiles, updatedAt));
  addPage("original-resume", "Structured mirror of uploaded original resume files.", buildOriginalResumeWikiPage(evidenceFiles, updatedAt));
  addPage("open-questions", "Clarifying questions for future resume work.", buildOpenQuestionsWikiPage(evidenceFiles, updatedAt));
  pages["index.md"] = buildWikiIndexPage(pageDescriptions, updatedAt);
  pages["log.md"] = await buildWikiLogPage(evidenceFiles, updatedAt, pageDescriptions);

  return pages;
}

function buildWikiIndexPage(pageDescriptions, updatedAt) {
  const pageRows = Array.from(pageDescriptions.entries()).sort(([a], [b]) => a.localeCompare(b));

  return [
    "# Wiki Index",
    "",
    "**Summary**: Table of contents for the resume knowledge base.",
    "",
    "**Sources**:",
    "- Generated from current source inventory",
    "",
    `**Last updated**: ${updatedAt}`,
    "",
    "---",
    "",
    "Use this index first when answering questions about the candidate or resume.",
    "",
    "## Pages",
    "",
    ...pageRows.map(([pageName, description]) => `- ${wikiLink(pageName)}: ${description}`),
    "",
    "## Related pages",
    "",
    "- [[source-index]]",
    "- [[profile]]",
    "- [[resume-bullets]]",
    "- [[open-questions]]"
  ].join("\n");
}

async function buildWikiLogPage(evidenceFiles, updatedAt, pageDescriptions) {
  let existingLog = "";
  try {
    existingLog = await fs.readFile(path.join(wikiDir, "log.md"), "utf8");
  } catch {
    existingLog = [
      "# Wiki Log",
      "",
      "**Summary**: Append-only record of wiki generation operations.",
      "",
      "**Sources**:",
      "- Generated by local app operations",
      "",
      `**Last updated**: ${updatedAt}`,
      "",
      "---",
      "",
      "## Entries",
      ""
    ].join("\n");
  }

  const sourceNames = evidenceFiles.length
    ? evidenceFiles.map((evidence) => evidence.name).join(", ")
    : "No sources";
  const pageNames = Array.from(pageDescriptions.keys()).sort().map((name) => wikiLink(name)).join(", ");
  const entry = `- ${updatedAt}: Ingested ${sourceNames}; updated ${pageDescriptions.size} pages including ${pageNames}.`;

  if (existingLog.includes(entry)) {
    return existingLog;
  }

  return `${existingLog.trimEnd()}\n${entry}\n`;
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

function createResumeModel(wikiPages) {
  const profileContent = getPageContent(wikiPages, "profile.md");
  const skillsContent = getPageContent(wikiPages, "skills.md");
  const bulletsContent = getPageContent(wikiPages, "resume-bullets.md");
  const questionsContent = getPageContent(wikiPages, "open-questions.md");

  const candidateName = extractWikiField(profileContent, "Full name")
    || extractLabeledBulletValue(getPageContent(wikiPages, "original-resume.md"), "Name")
    || "Candidate Name";

  const phone = extractWikiField(profileContent, "Phone");
  const email = extractWikiField(profileContent, "Email");
  const location = extractWikiField(profileContent, "Location");
  const contactParts = [phone, email, location].filter(Boolean);
  const contactLine = contactParts.length
    ? contactParts.join(" | ")
    : "email@example.com | Phone | Location";

  const skillLines = [];
  for (const line of skillsContent.split(/\r?\n/)) {
    const boldMatch = line.match(/^-\s*\*\*([^*]+)\*\*/);
    if (boldMatch) skillLines.push(`- ${boldMatch[1].trim()}`);
  }

  const resumeBullets = extractTopResumeBullets(bulletsContent, 6)
    .map((b) => `- ${b}`);
  const openQuestions = extractTopLevelBullets(questionsContent).slice(0, 5)
    .map((line) => stripSourceCitation(line));

  return {
    candidateName,
    contactLine,
    summaryLines: [],
    skillBullets: skillLines.slice(0, 8),
    resumeBullets,
    openQuestions,
    sourceWikiPages: wikiPages.map((page) => page.name)
  };
}

function extractLabeledBulletValue(content, label) {
  const prefix = `- ${label}:`;
  const line = content
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item.startsWith(prefix));

  return line ? line.slice(prefix.length).trim() : "";
}

function stripMarkdown(text) {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^[-*]\s+/, "")
    .trim();
}

function stripSourceCitation(text) {
  return text.replace(/\s*\(source:\s*[^)]+\)/g, "").trim();
}

function extractWikiField(content, label) {
  const regex = new RegExp(`-\\s*\\*\\*${label}\\*\\*:\\s*(.+)`, "i");
  const match = content.match(regex);
  if (!match) return "";
  return stripSourceCitation(match[1]);
}

function parseWikiH2Sections(content) {
  const lines = content.split(/\r?\n/);
  const sections = [];
  let current = null;
  const skipPattern = /related pages|open items|note on|connection to|review notes|evidence|source notes|improvement|strengths|structure/i;

  for (const line of lines) {
    const h2Match = line.match(/^## (.+)/);
    if (h2Match && !skipPattern.test(h2Match[1])) {
      if (current) sections.push(current);
      const heading = h2Match[1].trim();
      const dashMatch = heading.match(/^(.+?)\s[—–-]\s(.+)$/);
      current = {
        heading,
        org: dashMatch ? dashMatch[1].trim() : heading,
        role: dashMatch ? dashMatch[2].trim() : "",
        fields: {},
        bodyBullets: []
      };
    } else if (current) {
      const fieldMatch = line.match(/^-\s*\*\*([^*]+)\*\*:\s*(.+)/);
      if (fieldMatch) {
        current.fields[fieldMatch[1].trim()] = stripSourceCitation(fieldMatch[2]);
      } else if (/^-\s+/.test(line.trim()) && !line.includes("**")) {
        current.bodyBullets.push(stripSourceCitation(stripMarkdown(line.trim())));
      }
    }
  }
  if (current) sections.push(current);
  return sections;
}

function extractEducationHighlights(content) {
  const highlights = [];
  const lines = content.split(/\r?\n/);

  const scores = [];
  const gpa = extractWikiField(content, "Cumulative GPA");
  if (gpa) scores.push(`GPA: ${gpa}`);
  const gre = extractWikiField(content, "GRE");
  if (gre) scores.push(`GRE: ${gre}`);

  let currentH3 = "";
  const honors = [];
  const courses = [];

  for (const line of lines) {
    const h3Match = line.match(/^### (.+)/);
    if (h3Match) { currentH3 = h3Match[1].trim().toLowerCase(); continue; }
    if (line.startsWith("## ")) { currentH3 = ""; continue; }

    if (/^-\s+/.test(line.trim())) {
      const item = stripSourceCitation(stripMarkdown(line.trim()));
      if (currentH3.includes("honors") || currentH3.includes("activities")) {
        honors.push(item);
      } else if (currentH3.includes("coursework")) {
        courses.push(item);
      }
    }
  }

  const bulletOne = [...scores, ...honors].filter(Boolean).join("; ");
  if (bulletOne) highlights.push(bulletOne);
  if (courses.length) highlights.push(`Relevant Coursework: ${courses.join(", ")}`);

  return highlights;
}

function extractTopResumeBullets(content, max = 8) {
  const lines = content.split(/\r?\n/);
  const topHeader = lines.findIndex(line => /^##.*Top.*Strongest/i.test(line.trim()));

  if (topHeader >= 0) {
    const bullets = [];
    for (let i = topHeader + 1; i < lines.length; i++) {
      if (lines[i].startsWith("## ")) break;
      const numMatch = lines[i].match(/^\d+\.\s*(?:⭐\s*)?(.+)/);
      if (numMatch) {
        bullets.push(stripSourceCitation(numMatch[1].trim()));
      }
    }
    if (bullets.length) return bullets.slice(0, max);
  }

  return lines
    .filter(line => /^-\s+/.test(line.trim()) && !line.includes("**") && line.trim().length > 40)
    .map(line => stripSourceCitation(stripMarkdown(line.trim())))
    .slice(0, max);
}

function extractSectionResumeBullets(content, orgName, max = 3) {
  if (!orgName) return [];
  const lines = content.split(/\r?\n/);
  const sectionHeader = lines.findIndex(line =>
    line.startsWith("## ") && line.includes(orgName) && !/Top.*Strongest/i.test(line)
  );

  if (sectionHeader < 0) return [];

  const bullets = [];
  for (let i = sectionHeader + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) break;
    if (/^-\s+/.test(lines[i].trim()) && !lines[i].includes("**")) {
      bullets.push(stripSourceCitation(stripMarkdown(lines[i].trim())));
    }
  }

  return bullets.slice(0, max);
}

function extractSkillsText(content) {
  const skills = [];
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const boldMatch = line.match(/^-\s*\*\*([^*]+)\*\*/);
    if (boldMatch) {
      skills.push(boldMatch[1].trim());
    }
  }

  return skills.length ? skills.join(", ") : "Needs clarification";
}

function extractInterestsText(content) {
  const lines = content.split(/\r?\n/);
  const headerIndex = lines.findIndex(line => /^##\s+Interests/i.test(line));
  if (headerIndex < 0) return "Needs clarification";

  const items = [];
  for (let i = headerIndex + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) break;
    if (/^-\s+/.test(lines[i].trim())) {
      items.push(stripSourceCitation(stripMarkdown(lines[i].trim())));
    }
  }

  return items.length ? items.join(", ") : "Needs clarification";
}

const PAGE_WIDTH_TWIPS = 12240;
const DEFAULT_SECTION_LABELS = {
  education: "EDUCATION",
  experience: "EXPERIENCE",
  leadership: "LEADERSHIP",
  skills: "SKILLS & INTERESTS"
};

// A "style profile" describes the visual formatting of a resume: fonts, sizes,
// section ordering/labels, bullet glyph, margins, and name styling. The resume
// builder renders wiki-grounded content through one of these so the output can
// match an uploaded template or preserve the user's original resume format.
function getDefaultStyleProfile() {
  return {
    source: "default",
    bodyFont: "Times New Roman",
    bodySize: 20,
    entryTitleSize: 21,
    headingFont: "Times New Roman",
    headingSize: 21,
    headingBold: true,
    headingBorder: true,
    nameFont: "Times New Roman",
    nameSize: 28,
    nameCaps: true,
    nameCharSpacing: 40,
    bulletChar: "•",
    margins: { top: 500, right: 720, bottom: 500, left: 720 },
    sectionOrder: ["education", "experience", "leadership", "skills"],
    sectionLabels: { ...DEFAULT_SECTION_LABELS }
  };
}

function decodeBulletGlyph(value) {
  const dec = value.match(/^&#(\d+);$/);
  if (dec) return String.fromCharCode(Number(dec[1]));
  const hex = value.match(/^&#x([0-9a-fA-F]+);$/);
  if (hex) return String.fromCharCode(parseInt(hex[1], 16));
  return value || "•";
}

function isAllCapsHeading(text) {
  return text.length >= 3 && text.length <= 40 && /^[A-Z][A-Z\s&/.,'-]+$/.test(text) && text === text.toUpperCase();
}

function normalizeSectionKey(text) {
  const t = text.toUpperCase();
  if (/EDUCATION/.test(t)) return "education";
  if (/EXPERIENCE|EMPLOYMENT|\bWORK\b/.test(t)) return "experience";
  if (/LEADERSHIP|ACTIVITIES|VOLUNTEER|EXTRACURRICULAR|INVOLVEMENT/.test(t)) return "leadership";
  if (/SKILL|INTEREST|ADDITIONAL/.test(t)) return "skills";
  return null;
}

// Split a paragraph's text on tab stops, e.g. an "Org<tab>Dates" line becomes
// ["Org", "Dates"]. Used to recover the org/date columns of resume entries.
function paragraphTextSegments(paragraphXml) {
  const tokens = paragraphXml.match(/<w:t\b[^>]*>[\s\S]*?<\/w:t>|<w:tab\/>|<w:br\/>/g) || [];
  const segments = [""];
  for (const token of tokens) {
    if (token === "<w:tab/>") {
      segments.push("");
    } else if (token === "<w:br/>") {
      segments[segments.length - 1] += " ";
    } else {
      // A tab can be its own element (<w:tab/>) or a literal tab inside the run
      // text; split on both so "Org<tab>Dates" becomes two segments.
      const decoded = decodeXmlText(token.replace(/^<w:t\b[^>]*>/, "").replace(/<\/w:t>$/, ""));
      const parts = decoded.split("\t");
      segments[segments.length - 1] += parts[0];
      for (let part = 1; part < parts.length; part += 1) segments.push(parts[part]);
    }
  }
  return segments.map((segment) => segment.replace(/ +/g, " ").trim()).filter(Boolean);
}

function parseDocxParagraphMeta(paragraphXml) {
  const segments = paragraphTextSegments(paragraphXml);
  const text = segments.join(" ").replace(/^-\s+/, "").trim();
  const centered = /<w:jc\s+w:val="center"\s*\/>/.test(paragraphXml);
  const hasBottomBorder = /<w:pBdr>[\s\S]*?<w:bottom\b/.test(paragraphXml);
  const isBullet = /<w:numPr\b/.test(paragraphXml);
  const firstRunPr = (paragraphXml.match(/<w:r\b[^>]*>\s*<w:rPr>([\s\S]*?)<\/w:rPr>/) || [])[1] || "";
  const sizeMatch = firstRunPr.match(/<w:sz\s+w:val="(\d+)"/);
  const fontMatch = firstRunPr.match(/<w:rFonts[^>]*w:ascii="([^"]+)"/);
  const charSpacingMatch = firstRunPr.match(/<w:spacing\s+w:val="(-?\d+)"/);
  const bold = /<w:b\s*\/>|<w:b\s+w:val="(?:true|1)"\s*\/>/.test(firstRunPr);
  const italic = /<w:i\s*\/>|<w:i\s+w:val="(?:true|1)"\s*\/>/.test(firstRunPr);
  return {
    text,
    segments,
    centered,
    hasBottomBorder,
    isBullet,
    bold,
    italic,
    size: sizeMatch ? Number(sizeMatch[1]) : null,
    font: fontMatch ? fontMatch[1] : null,
    charSpacing: charSpacingMatch ? Number(charSpacingMatch[1]) : null
  };
}

// Recognized resume section titles, broader than normalizeSectionKey's render
// buckets (which only map to education/experience/leadership/skills).
function looksLikeSectionTitle(text) {
  return /^(education|experience|work experience|employment|professional experience|leadership|leadership (?:&|and) activities|activities|involvement|volunteer|skills|technical skills|skills (?:&|and) interests|interests|projects|summary|objective|profile|awards|honors|certifications?|publications?|coursework)$/i
    .test(text.trim().replace(/[:.]$/, ""));
}

function isResumePreviewHeading(meta) {
  if (meta.isBullet || !meta.text) return false;
  if (meta.hasBottomBorder) return true;
  if (looksLikeSectionTitle(meta.text)) return true;
  return isAllCapsHeading(meta.text) && meta.text.length <= 30;
}

// Parse a resume DOCX into the same structured shape the generated-resume
// preview renders (name, contact, sections of entries), so uploaded resumes and
// templates can be previewed with the identical card layout.
async function parseResumeDocx(filePath) {
  try {
    const zip = await JSZip.loadAsync(await fs.readFile(filePath));
    const documentFile = zip.file("word/document.xml");
    if (!documentFile) return null;

    const documentXml = await documentFile.async("string");
    const paragraphs = documentXml.match(/<w:p\b[\s\S]*?<\/w:p>/g) || [];
    const metas = paragraphs.map(parseDocxParagraphMeta).filter((m) => m.text || m.isBullet);
    if (!metas.length) return null;

    // The first paragraph is the name; everything up to the first section
    // heading is contact info.
    const name = metas[0].text || "";
    let index = 1;
    const contactParts = [];
    while (index < metas.length && !isResumePreviewHeading(metas[index])) {
      if (metas[index].text && !metas[index].isBullet) contactParts.push(metas[index].text);
      index += 1;
    }
    const contact = contactParts.join(" ");

    const sections = [];
    let current = null;
    let entry = null;

    const flushEntry = () => {
      if (entry && current) current.entries.push(entry);
      entry = null;
    };
    const flushSection = () => {
      flushEntry();
      if (current) sections.push(current);
      current = null;
    };

    for (; index < metas.length; index += 1) {
      const meta = metas[index];

      if (isResumePreviewHeading(meta)) {
        flushSection();
        current = { title: meta.text, key: normalizeSectionKey(meta.text), entries: [], textLines: [] };
        continue;
      }
      if (!current) continue;

      if (meta.isBullet) {
        if (!entry) entry = { org: "", dates: "", subtitle: "", bullets: [] };
        if (meta.text) entry.bullets.push(meta.text);
        continue;
      }

      // Skills/interests sections are free text, not org/date entries.
      if (current.key === "skills") {
        if (meta.text) current.textLines.push(meta.text);
        continue;
      }

      // A tabbed line is an entry header: "Organization <tab> Dates".
      if (meta.segments.length > 1) {
        flushEntry();
        entry = { org: meta.segments[0], dates: meta.segments.slice(1).join(" "), subtitle: "", bullets: [] };
        continue;
      }

      // An italic line right after a header is the role/location subtitle.
      if (meta.italic && entry && !entry.subtitle && !entry.bullets.length) {
        entry.subtitle = meta.text;
        continue;
      }

      // A bold standalone line starts a new entry without a date column.
      if (meta.bold) {
        flushEntry();
        entry = { org: meta.text, dates: "", subtitle: "", bullets: [] };
        continue;
      }

      // Otherwise treat it as a pending subtitle, or its own entry line.
      if (entry && !entry.subtitle && !entry.bullets.length) {
        entry.subtitle = meta.text;
      } else {
        flushEntry();
        entry = { org: meta.text, dates: "", subtitle: "", bullets: [] };
      }
    }
    flushSection();

    for (const section of sections) {
      section.text = section.textLines.join(" • ");
      delete section.textLines;
    }

    // Drop sections that ended up with no content (e.g. a heading immediately
    // followed by another heading) so the preview stays clean.
    const populated = sections.filter((section) => section.entries.length || section.text);

    return { name, contact, sections: populated };
  } catch {
    return null;
  }
}

// Convert a parsed resume DOCX into the resume-values shape used by the resume
// preview/diff, so an uploaded original resume can serve as the diff baseline
// in "improve existing resume" mode. Only the fields the diff reads are mapped
// (name, per-section org names + bullets, and skills).
function resumeValuesFromParsedResume(parsed) {
  if (!parsed) return null;

  const values = {
    candidateName: parsed.name || "",
    phone: "",
    email: "",
    location: "",
    education: [],
    experience: [],
    leadership: [],
    skills: "",
    interests: ""
  };

  for (const section of parsed.sections || []) {
    const key = section.key || normalizeSectionKey(section.title);
    const entries = section.entries || [];

    if (key === "education") {
      values.education = entries.map((e) => ({
        schoolName: e.org || "",
        degree: e.subtitle || "",
        schoolLocation: "",
        dates: e.dates || "",
        bullets: e.bullets || []
      }));
    } else if (key === "experience") {
      values.experience = entries.map((e) => ({
        companyName: e.org || "",
        roleTitle: e.subtitle || "",
        location: "",
        dates: e.dates || "",
        bullets: e.bullets || []
      }));
    } else if (key === "leadership") {
      values.leadership = entries.map((e) => ({
        organizationName: e.org || "",
        role: e.subtitle || "",
        location: "",
        dates: e.dates || "",
        bullets: e.bullets || []
      }));
    } else if (key === "skills" && section.text) {
      values.skills = values.skills ? `${values.skills} ${section.text}` : section.text;
    }
  }

  return values;
}

// Read a DOCX (uploaded template or original resume) and derive a style profile
// from it, falling back to the default profile for anything not detected.
async function extractDocxStyleProfile(filePath, source = "template") {
  const profile = getDefaultStyleProfile();
  profile.source = source;

  try {
    const zip = await JSZip.loadAsync(await fs.readFile(filePath));
    const documentFile = zip.file("word/document.xml");
    if (!documentFile) return profile;

    const documentXml = await documentFile.async("string");
    const stylesXml = (await zip.file("word/styles.xml")?.async("string")) || "";
    const numberingXml = (await zip.file("word/numbering.xml")?.async("string")) || "";

    const docDefaults = (stylesXml.match(/<w:docDefaults>[\s\S]*?<\/w:docDefaults>/) || [""])[0];
    const defaultFont = docDefaults.match(/<w:rFonts[^>]*w:ascii="([^"]+)"/);
    const defaultSize = docDefaults.match(/<w:sz\s+w:val="(\d+)"/);
    if (defaultFont) {
      profile.bodyFont = defaultFont[1];
      profile.headingFont = defaultFont[1];
      profile.nameFont = defaultFont[1];
    }
    if (defaultSize) profile.bodySize = Number(defaultSize[1]);

    const marginMatch = documentXml.match(/<w:pgMar\b[^>]*\/>/);
    if (marginMatch) {
      const readMargin = (key) => {
        const m = marginMatch[0].match(new RegExp(`w:${key}="(-?\\d+)"`));
        return m ? Number(m[1]) : null;
      };
      profile.margins = {
        top: readMargin("top") ?? profile.margins.top,
        right: readMargin("right") ?? profile.margins.right,
        bottom: readMargin("bottom") ?? profile.margins.bottom,
        left: readMargin("left") ?? profile.margins.left
      };
    }

    const bulletMatch = numberingXml.match(/<w:numFmt w:val="bullet"\s*\/>[\s\S]*?<w:lvlText w:val="([^"]+)"/);
    if (bulletMatch) profile.bulletChar = decodeBulletGlyph(bulletMatch[1]);

    const paragraphs = documentXml.match(/<w:p\b[\s\S]*?<\/w:p>/g) || [];
    const metas = paragraphs.map(parseDocxParagraphMeta).filter((m) => m.text || m.hasBottomBorder);

    // The first text paragraph is the candidate's name, not a section heading.
    const nameIndex = metas.findIndex((m) => m.text);
    const firstTextMeta = nameIndex >= 0 ? metas[nameIndex] : null;
    if (firstTextMeta) {
      if (firstTextMeta.font) profile.nameFont = firstTextMeta.font;
      if (firstTextMeta.size) profile.nameSize = firstTextMeta.size;
      if (firstTextMeta.charSpacing != null) profile.nameCharSpacing = firstTextMeta.charSpacing;
      profile.nameCaps = firstTextMeta.text === firstTextMeta.text.toUpperCase();
    }

    const headings = metas.filter((m, i) => {
      if (i === nameIndex || !m.text || m.isBullet) return false;
      if (m.hasBottomBorder) return true;
      // A borderless heading must read like a real section title: a recognized
      // section keyword that is either all-caps or a bold short line. This keeps
      // stray all-caps lines (names, company names) from being treated as headings.
      const key = normalizeSectionKey(m.text);
      if (!key) return false;
      return isAllCapsHeading(m.text) || (m.bold && m.text.length <= 40);
    });
    if (headings.length) {
      profile.headingBorder = headings.some((h) => h.hasBottomBorder);
      const headingSize = headings.find((h) => h.size)?.size;
      if (headingSize) {
        profile.headingSize = headingSize;
        profile.entryTitleSize = headingSize;
      }
      const headingFont = headings.find((h) => h.font)?.font;
      if (headingFont) profile.headingFont = headingFont;

      const order = [];
      const labels = { ...DEFAULT_SECTION_LABELS };
      for (const heading of headings) {
        const key = normalizeSectionKey(heading.text);
        if (key && !order.includes(key)) {
          order.push(key);
          labels[key] = heading.text;
        }
      }
      if (order.length) {
        for (const key of ["education", "experience", "leadership", "skills"]) {
          if (!order.includes(key)) order.push(key);
        }
        profile.sectionOrder = order;
        profile.sectionLabels = labels;
      }
    }
  } catch {
    return getDefaultStyleProfile();
  }

  return profile;
}

function sectionHeading(label, profile = getDefaultStyleProfile()) {
  return new Paragraph({
    spacing: { before: 120, after: 20, line: 240, lineRule: LineRuleType.AUTO },
    border: profile.headingBorder
      ? { bottom: { color: "111111", space: 1, style: BorderStyle.SINGLE, size: 6 } }
      : undefined,
    children: [
      new TextRun({ text: label, bold: profile.headingBold, size: profile.headingSize, font: profile.headingFont })
    ]
  });
}

function bodyParagraph(text, options = {}, profile = getDefaultStyleProfile()) {
  return new Paragraph({
    alignment: options.alignment,
    spacing: { before: options.before ?? 0, after: options.after ?? 20, line: 240, lineRule: LineRuleType.AUTO },
    indent: options.indent,
    tabStops: options.tabStops,
    bullet: options.bullet,
    numbering: options.numbering,
    children: [
      new TextRun({
        text: stripMarkdown(text),
        bold: options.bold ?? false,
        italics: options.italics ?? false,
        size: options.size ?? profile.bodySize,
        font: profile.bodyFont
      })
    ]
  });
}

function contentWidthFor(profile) {
  return PAGE_WIDTH_TWIPS - profile.margins.left - profile.margins.right;
}

function resumeEntryLine1(org, dates, profile = getDefaultStyleProfile()) {
  return new Paragraph({
    spacing: { before: 40, after: 0, line: 240, lineRule: LineRuleType.AUTO },
    tabStops: [{ type: TabStopType.RIGHT, position: contentWidthFor(profile) }],
    children: [
      new TextRun({ text: stripMarkdown(org || ""), bold: true, size: profile.entryTitleSize, font: profile.headingFont }),
      ...(dates ? [new TextRun({ text: `\t${stripMarkdown(dates)}`, size: profile.entryTitleSize, font: profile.headingFont })] : [])
    ]
  });
}

function resumeEntryLine2(role, location, profile = getDefaultStyleProfile()) {
  const subtitle = [role, location].filter(Boolean).join(" — ");
  if (!subtitle) return null;
  return new Paragraph({
    spacing: { before: 0, after: 0, line: 240, lineRule: LineRuleType.AUTO },
    children: [
      new TextRun({ text: stripMarkdown(subtitle), italics: true, size: profile.bodySize, font: profile.bodyFont })
    ]
  });
}

function buildFullResumeValues(wikiPages) {
  const profile = getPageContent(wikiPages, "profile.md");
  const educationPage = getPageContent(wikiPages, "education.md");
  const workPage = getPageContent(wikiPages, "work-experience.md");
  const leadershipPage = getPageContent(wikiPages, "leadership-experience.md");
  const skillsPage = getPageContent(wikiPages, "skills.md");
  const bulletsPage = getPageContent(wikiPages, "resume-bullets.md");

  const candidateName = extractWikiField(profile, "Full name") || "Needs clarification";
  const phone = extractWikiField(profile, "Phone") || "";
  const email = extractWikiField(profile, "Email") || "";
  const location = extractWikiField(profile, "Location") || "";

  const eduSections = parseWikiH2Sections(educationPage);
  const education = eduSections.map((sec) => {
    const gpa = sec.fields["Cumulative GPA"];
    const gre = sec.fields.GRE;
    const sat = sec.fields.SAT;
    const scores = [gpa ? `GPA: ${gpa}` : "", gre ? `GRE: ${gre}` : "", sat ? `SAT: ${sat}` : ""].filter(Boolean);
    const bullets = [];
    if (scores.length) bullets.push(scores.join(", "));

    const lines = educationPage.split(/\r?\n/);
    let inThisSection = false;
    let currentH3 = "";
    const honors = [];
    const courses = [];
    for (const line of lines) {
      if (line.startsWith("## ") && line.includes(sec.org)) { inThisSection = true; continue; }
      if (line.startsWith("## ") && inThisSection) break;
      if (!inThisSection) continue;
      const h3 = line.match(/^### (.+)/);
      if (h3) { currentH3 = h3[1].toLowerCase(); continue; }
      if (/^-\s+/.test(line.trim())) {
        const item = stripSourceCitation(stripMarkdown(line.trim()));
        if (currentH3.includes("honors") || currentH3.includes("activities")) honors.push(item);
        else if (currentH3.includes("coursework")) courses.push(item);
      }
    }
    if (honors.length) bullets.push(honors.join(", "));
    if (courses.length) bullets.push(`Relevant Coursework: ${courses.join(", ")}`);

    return {
      schoolName: sec.org,
      schoolLocation: sec.fields.Location || "",
      degree: sec.fields.Degree || sec.role || "",
      dates: sec.fields.Dates || sec.fields.Graduation || "",
      bullets
    };
  });

  const workSections = parseWikiH2Sections(workPage);
  const leaderSections = parseWikiH2Sections(leadershipPage);
  const totalEntries = eduSections.length + workSections.length + leaderSections.length;

  const workBulletLimit = (i) => {
    if (totalEntries <= 6) return i < 2 ? 3 : 2;
    if (totalEntries <= 8) return i < 1 ? 3 : 2;
    return i < 1 ? 2 : 1;
  };
  const leaderBulletLimit = totalEntries <= 6 ? 2 : 1;

  const experience = workSections.map((sec, i) => ({
    companyName: sec.org,
    roleTitle: sec.role || "",
    location: sec.fields.Location || "",
    dates: sec.fields.Dates || "",
    bullets: extractSectionResumeBullets(bulletsPage, sec.org, workBulletLimit(i))
  }));

  const leadership = leaderSections.map((sec) => ({
    organizationName: sec.org,
    role: sec.role || "",
    location: sec.fields.Location || "",
    dates: sec.fields.Dates || "",
    bullets: extractSectionResumeBullets(bulletsPage, sec.org, leaderBulletLimit)
  }));

  return {
    candidateName,
    phone,
    email,
    location,
    education,
    experience,
    leadership,
    skills: extractSkillsText(skillsPage),
    interests: extractInterestsText(skillsPage)
  };
}

function estimateLines(text, charsPerLine = 100) {
  return Math.ceil(stripMarkdown(text).length / charsPerLine) || 1;
}

function estimateResumeLines(rv) {
  let lines = 4;
  const entryOverhead = 2;

  for (const e of (rv.education || [])) {
    lines += entryOverhead;
    for (const b of (e.bullets || [])) lines += estimateLines(b);
  }
  lines += 1;
  for (const e of (rv.experience || [])) {
    lines += entryOverhead;
    for (const b of (e.bullets || [])) lines += estimateLines(b);
  }
  if (rv.leadership && rv.leadership.length) {
    lines += 1;
    for (const e of rv.leadership) {
      lines += entryOverhead;
      for (const b of (e.bullets || [])) lines += estimateLines(b);
    }
  }
  lines += 1;
  if (rv.skills) lines += estimateLines(rv.skills);
  if (rv.interests) lines += estimateLines(rv.interests);
  return lines;
}

function trimBullets(entries, limit) {
  return entries.map((e, i) => ({
    ...e,
    bullets: (e.bullets || []).slice(0, typeof limit === "function" ? limit(i) : limit)
  }));
}

function trimResumeValues(rv, maxLines = 62) {
  rv = JSON.parse(JSON.stringify(rv));

  if (estimateResumeLines(rv) <= maxLines) return rv;

  if (rv.leadership && rv.leadership.length > 3) {
    rv.leadership = rv.leadership.slice(0, 3);
  }
  if (rv.leadership) {
    rv.leadership = trimBullets(rv.leadership, 1);
  }
  if (estimateResumeLines(rv) <= maxLines) return rv;

  if (rv.experience) {
    rv.experience = trimBullets(rv.experience, (i) => i < 2 ? 3 : 2);
  }
  if (estimateResumeLines(rv) <= maxLines) return rv;

  if (rv.leadership && rv.leadership.length > 2) {
    rv.leadership = rv.leadership.slice(0, 2);
  }
  if (estimateResumeLines(rv) <= maxLines) return rv;

  if (rv.experience) {
    rv.experience = trimBullets(rv.experience, (i) => i < 1 ? 3 : 1);
  }
  if (estimateResumeLines(rv) <= maxLines) return rv;

  if (rv.experience) {
    rv.experience = trimBullets(rv.experience, (i) => i < 1 ? 2 : 1);
  }
  if (rv.education) {
    rv.education = trimBullets(rv.education, 1);
  }

  return rv;
}

function buildResumeDocxFromValues(rv, profile = getDefaultStyleProfile()) {
  const contactLine = [rv.phone, rv.email, rv.location].filter(Boolean).join(" | ");
  const children = [];
  const labels = profile.sectionLabels || DEFAULT_SECTION_LABELS;

  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 20, line: 240, lineRule: LineRuleType.AUTO },
      children: [new TextRun({
        text: profile.nameCaps ? (rv.candidateName || "").toUpperCase() : (rv.candidateName || ""),
        bold: true,
        size: profile.nameSize,
        font: profile.nameFont,
        characterSpacing: profile.nameCharSpacing
      })]
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 60, line: 240, lineRule: LineRuleType.AUTO },
      children: [new TextRun({ text: contactLine || "Needs clarification", size: profile.bodySize, font: profile.bodyFont })]
    })
  );

  const bulletParagraph = (text) =>
    bodyParagraph(text, { numbering: { reference: "resume-bullets", level: 0 } }, profile);

  const renderEducation = () => {
    children.push(sectionHeading(labels.education, profile));
    for (const edu of (rv.education || [])) {
      children.push(resumeEntryLine1(edu.schoolName, edu.dates, profile));
      const sub = resumeEntryLine2(edu.degree, edu.schoolLocation, profile);
      if (sub) children.push(sub);
      for (const bullet of (edu.bullets || [])) children.push(bulletParagraph(bullet));
    }
  };

  const renderExperience = () => {
    children.push(sectionHeading(labels.experience, profile));
    for (const job of (rv.experience || [])) {
      children.push(resumeEntryLine1(job.companyName, job.dates, profile));
      const sub = resumeEntryLine2(job.roleTitle, job.location, profile);
      if (sub) children.push(sub);
      for (const bullet of (job.bullets || [])) children.push(bulletParagraph(bullet));
    }
  };

  const renderLeadership = () => {
    if (!(rv.leadership && rv.leadership.length)) return;
    children.push(sectionHeading(labels.leadership, profile));
    for (const entry of rv.leadership) {
      children.push(resumeEntryLine1(entry.organizationName, entry.dates, profile));
      const sub = resumeEntryLine2(entry.role, entry.location, profile);
      if (sub) children.push(sub);
      for (const bullet of (entry.bullets || [])) children.push(bulletParagraph(bullet));
    }
  };

  const renderSkills = () => {
    children.push(sectionHeading(labels.skills, profile));
    if (rv.skills) children.push(bodyParagraph(rv.skills, {}, profile));
    if (rv.interests && rv.interests !== "Needs clarification") {
      children.push(bodyParagraph(rv.interests, {}, profile));
    }
  };

  const renderers = {
    education: renderEducation,
    experience: renderExperience,
    leadership: renderLeadership,
    skills: renderSkills
  };

  for (const key of (profile.sectionOrder || getDefaultStyleProfile().sectionOrder)) {
    if (renderers[key]) renderers[key]();
  }

  return new Document({
    numbering: {
      config: [{
        reference: "resume-bullets",
        levels: [{
          level: 0,
          format: LevelFormat.BULLET,
          text: profile.bulletChar || "\u2022",
          style: {
            paragraph: { indent: { left: 360, hanging: 180 } },
            run: { font: profile.bodyFont, size: profile.bodySize }
          }
        }]
      }]
    },
    styles: {
      default: {
        document: {
          run: { font: profile.bodyFont, size: profile.bodySize },
          paragraph: { spacing: { after: 20, line: 240, lineRule: LineRuleType.AUTO } }
        }
      }
    },
    sections: [{
      properties: {
        page: {
          size: { width: PAGE_WIDTH_TWIPS, height: 15840, orientation: PageOrientation.PORTRAIT },
          margin: { ...profile.margins, header: 0, footer: 0, gutter: 0 }
        }
      },
      children
    }]
  });
}

async function writeResumeDocx(wikiPages, resumeValues, profile = getDefaultStyleProfile()) {
  const rv = trimResumeValues(resumeValues || buildFullResumeValues(wikiPages));
  const doc = buildResumeDocxFromValues(rv, profile);
  const buffer = await Packer.toBuffer(doc);
  const outputPath = path.join(exportDir, "resume-draft.docx");
  await fs.writeFile(outputPath, buffer);
  return outputPath;
}

// Decide which formatting source to use, per the two workflow situations:
//  - a user-uploaded template always wins (build-from-scratch or improve)
//  - otherwise, in improve mode, preserve the original resume's format
//  - otherwise, fall back to the built-in default layout
async function getPrimaryUserTemplateDocxPath() {
  const fileNames = await listResumeTemplateFiles();
  const docxName = fileNames.find(
    (name) => path.extname(name).toLowerCase() === ".docx" && path.basename(name) !== "default-ats.docx"
  );
  return docxName ? path.join(templateDir, docxName) : null;
}

async function resolveResumeStyleProfile(workflowMode) {
  const userTemplatePath = await getPrimaryUserTemplateDocxPath();
  if (userTemplatePath) {
    return extractDocxStyleProfile(userTemplatePath, "template");
  }

  if (workflowMode === workflowModes.improveExistingResume) {
    const originalResumePath = await getPrimaryOriginalResumeDocxPath();
    if (originalResumePath) {
      return extractDocxStyleProfile(originalResumePath, "original");
    }
  }

  return getDefaultStyleProfile();
}

async function getPrimaryOriginalResumeDocxPath() {
  const fileNames = await listOriginalResumeFiles();
  const docxName = fileNames.find((name) => path.extname(name).toLowerCase() === ".docx");
  return docxName ? path.join(originalResumeDir, docxName) : null;
}

function buildDocxTemplateValues(wikiPages) {
  const profile = getPageContent(wikiPages, "profile.md");
  const education = getPageContent(wikiPages, "education.md");
  const work = getPageContent(wikiPages, "work-experience.md");
  const leadership = getPageContent(wikiPages, "leadership-experience.md");
  const skillsPage = getPageContent(wikiPages, "skills.md");
  const bulletsPage = getPageContent(wikiPages, "resume-bullets.md");

  const candidateName = extractWikiField(profile, "Full name") || "Needs clarification";
  const phone = extractWikiField(profile, "Phone") || "Needs clarification";
  const email = extractWikiField(profile, "Email") || "Needs clarification";
  const location = extractWikiField(profile, "Location") || "Needs clarification";

  const eduSections = parseWikiH2Sections(education);
  const edu = eduSections[0] || { org: "Needs clarification", role: "", fields: {} };
  const eduHighlights = extractEducationHighlights(education);

  const workSections = parseWikiH2Sections(work);
  const job = workSections[0] || { org: "Needs clarification", role: "", fields: {} };

  const leaderSections = parseWikiH2Sections(leadership);
  const leader = leaderSections[0] || { org: "Needs clarification", role: "", fields: {} };

  const topBullets = extractTopResumeBullets(bulletsPage);
  const leaderBullets = extractSectionResumeBullets(bulletsPage, leader.org);

  return {
    candidateName,
    phone,
    email,
    location,
    schoolName: edu.org || "Needs clarification",
    schoolLocation: edu.fields.Location || "Needs clarification",
    degree: edu.fields.Degree || edu.role || "Needs clarification",
    educationDates: edu.fields.Dates || edu.fields.Graduation || "Needs clarification",
    educationBulletOne: eduHighlights[0] || "Needs clarification",
    educationBulletTwo: eduHighlights[1] || "Needs clarification",
    companyName: job.org || "Needs clarification",
    roleTitle: job.role || "Needs clarification",
    jobLocation: job.fields.Location || "Needs clarification",
    jobDates: job.fields.Dates || "Needs clarification",
    impactBulletOne: topBullets[0] || "Needs clarification",
    impactBulletTwo: topBullets[1] || "Needs clarification",
    impactBulletThree: topBullets[2] || "Needs clarification",
    organizationName: leader.org || "Needs clarification",
    leadershipRole: leader.role || "Needs clarification",
    leadershipLocation: leader.fields.Location || "Needs clarification",
    leadershipDates: leader.fields.Dates || "Needs clarification",
    leadershipBulletOne: leaderBullets[0] || topBullets[3] || "Needs clarification",
    skills: extractSkillsText(skillsPage),
    interests: extractInterestsText(skillsPage)
  };
}

function escapeXmlText(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function fillDocxTemplate(templatePath, outputPath, values) {
  const zip = await JSZip.loadAsync(await fs.readFile(templatePath));
  const documentFile = zip.file("word/document.xml");

  if (!documentFile) {
    throw new Error("DOCX template is missing word/document.xml.");
  }

  let documentXml = await documentFile.async("string");
  for (const [key, value] of Object.entries(values)) {
    documentXml = documentXml.replaceAll(`{{${key}}}`, escapeXmlText(value));
  }

  zip.file("word/document.xml", documentXml);
  await normalizeDocxBulletNumbering(zip);
  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  await fs.writeFile(outputPath, buffer);
}

async function normalizeDocxBulletNumbering(zip) {
  const numberingFile = zip.file("word/numbering.xml");

  if (!numberingFile) {
    return;
  }

  const bulletRunProperties = [
    "<w:rPr>",
    '<w:rFonts w:ascii="Symbol" w:hAnsi="Symbol" w:hint="default"/>',
    '<w:sz w:val="20"/>',
    '<w:szCs w:val="20"/>',
    "</w:rPr>"
  ].join("");

  const numberingXml = (await numberingFile.async("string")).replace(
    /<w:lvl\b[\s\S]*?<\/w:lvl>/g,
    (levelXml) => {
      if (!levelXml.includes('<w:numFmt w:val="bullet"/>')) {
        return levelXml;
      }

      let nextLevelXml = levelXml.replace(/<w:lvlText w:val="[^"]*"\/>/, '<w:lvlText w:val="&#61623;"/>');

      if (nextLevelXml.includes("<w:rPr>")) {
        nextLevelXml = nextLevelXml.replace(/<w:rPr>[\s\S]*?<\/w:rPr>/, bulletRunProperties);
      } else {
        nextLevelXml = nextLevelXml.replace("</w:lvl>", `${bulletRunProperties}</w:lvl>`);
      }

      return nextLevelXml;
    }
  );

  zip.file("word/numbering.xml", numberingXml);
}

function runProcess(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr || `${command} exited with code ${code}`));
      }
    });
  });
}

async function convertDocxToPdf(docxPath) {
  const pdfPath = path.join(exportDir, `${path.basename(docxPath, ".docx")}.pdf`);
  const candidates = [
    "soffice",
    "libreoffice",
    "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
    "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe"
  ];

  let lastError = null;
  for (const command of candidates) {
    try {
      await runProcess(command, [
        "--headless",
        "--convert-to",
        "pdf",
        "--outdir",
        exportDir,
        docxPath
      ]);
      return pdfPath;
    } catch (error) {
      lastError = error;
    }
  }

  try {
    await convertDocxToPdfWithWord(docxPath, pdfPath);
    return pdfPath;
  } catch (error) {
    lastError = error;
  }

  throw lastError ?? new Error("LibreOffice/soffice was not found.");
}

function toPowerShellString(value) {
  return `'${value.replace(/'/g, "''")}'`;
}

async function convertDocxToPdfWithWord(docxPath, pdfPath) {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$word = New-Object -ComObject Word.Application",
    "$word.Visible = $false",
    `$doc = $word.Documents.Open(${toPowerShellString(docxPath)})`,
    `$doc.SaveAs([ref] ${toPowerShellString(pdfPath)}, [ref] 17)`,
    "$doc.Close($false)",
    "$word.Quit()"
  ].join("; ");

  await runProcess("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    script
  ]);
}


module.exports = {
  ensureProjectDirs,
  readProjectState,
  mergeProjectState,
  readMarkdownFiles,
  listRawFiles,
  listOriginalResumeFiles,
  listResumeTemplateFiles,
  listExportFiles,
  deleteManagedFile,
  readManagedFileText,
  readAllEvidenceFiles,
  inferSkills,
  buildWikiPages,
  writeWikiPages,
  writeResumeDocx,
  buildResumeDocxFromValues,
  buildFullResumeValues,
  trimResumeValues,
  getDefaultStyleProfile,
  extractDocxStyleProfile,
  parseResumeDocx,
  resumeValuesFromParsedResume,
  resolveResumeStyleProfile,
  getPrimaryOriginalResumeDocxPath,
  getPrimaryUserTemplateDocxPath,
  fillDocxTemplate,
  buildDocxTemplateValues,
  convertDocxToPdf,
  isStateUpToDate,
  getIsoNow,
  workflowModes,
  rawDir,
  wikiDir,
  exportDir,
  templateDir,
  originalResumeDir,
  defaultDocxTemplatePath
};

