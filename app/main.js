const { spawn } = require("child_process");
const {
  AlignmentType,
  BorderStyle,
  Document,
  Packer,
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
const hiddenTemplateFiles = new Set(["README.md"]);
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
  const originalResumeContent = getPageContent(wikiPages, "original-resume.md");

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
  const importedName = extractLabeledBulletValue(originalResumeContent, "Name");
  const importedContact = extractLabeledBulletValue(originalResumeContent, "Contact");

  return {
    candidateName: importedName || "Candidate Name",
    contactLine: importedContact || "email@example.com | Phone | Location | LinkedIn | Portfolio",
    summaryLines,
    skillBullets,
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

function sectionHeading(text) {
  return new Paragraph({
    spacing: { before: 180, after: 40 },
    border: {
      bottom: {
        color: "111111",
        space: 1,
        style: BorderStyle.SINGLE,
        size: 6
      }
    },
    children: [
      new TextRun({
        text,
        bold: true,
        size: 22,
        font: "Times New Roman"
      })
    ]
  });
}

function bodyParagraph(text, options = {}) {
  return new Paragraph({
    alignment: options.alignment,
    spacing: { before: options.before ?? 0, after: options.after ?? 30 },
    indent: options.indent,
    tabStops: options.tabStops,
    bullet: options.bullet,
    numbering: options.numbering,
    children: [
      new TextRun({
        text: stripMarkdown(text),
        bold: options.bold ?? false,
        italics: options.italics ?? false,
        size: options.size ?? 20,
        font: "Times New Roman"
      })
    ]
  });
}

function resumeEntryParagraph(left, right = "") {
  return new Paragraph({
    spacing: { before: 60, after: 10 },
    tabStops: [
      {
        type: TabStopType.RIGHT,
        position: TabStopPosition.MAX
      }
    ],
    children: [
      new TextRun({
        text: stripMarkdown(left),
        bold: true,
        size: 22,
        font: "Times New Roman"
      }),
      new TextRun({
        text: right ? `\t${stripMarkdown(right)}` : "",
        size: 22,
        font: "Times New Roman"
      })
    ]
  });
}

function buildResumeDocx(wikiPages) {
  const model = createResumeModel(wikiPages);
  const experienceBullets = model.resumeBullets.length
    ? model.resumeBullets
    : ["No grounded bullet candidates available yet."];
  const skills = model.skillBullets.length
    ? model.skillBullets.map(stripMarkdown).join(", ")
    : "No grounded skills available yet.";
  const questions = model.openQuestions.length
    ? model.openQuestions
    : ["No open questions recorded."];

  return new Document({
    numbering: {
      config: [
        {
          reference: "resume-bullets",
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: "\u2022",
              style: {
                paragraph: {
                  indent: {
                    left: 360,
                    hanging: 180
                  }
                },
                run: {
                  font: "Times New Roman",
                  size: 20
                }
              }
            }
          ]
        }
      ]
    },
    styles: {
      default: {
        document: {
          run: {
            font: "Times New Roman",
            size: 20
          },
          paragraph: {
            spacing: { after: 30 }
          }
        }
      }
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 720,
              right: 720,
              bottom: 720,
              left: 720
            }
          }
        },
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 20 },
            children: [
              new TextRun({
                text: model.candidateName,
                size: 30,
                font: "Times New Roman"
              })
            ]
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 80 },
            children: [
              new TextRun({
                text: model.contactLine,
                size: 22,
                font: "Times New Roman"
              })
            ]
          }),
          sectionHeading("EDUCATION"),
          bodyParagraph("Needs clarification.", { italics: true, size: 22 }),
          sectionHeading("WORK EXPERIENCE"),
          resumeEntryParagraph("Organization - Role | Location", "Dates"),
          ...experienceBullets.map((bullet) =>
            bodyParagraph(bullet, {
              numbering: { reference: "resume-bullets", level: 0 },
              size: 20
            })
          ),
          sectionHeading("LEADERSHIP EXPERIENCE"),
          bodyParagraph("Needs clarification.", { italics: true, size: 22 }),
          sectionHeading("SKILLS, ACTIVITIES & INTERESTS"),
          bodyParagraph(`Languages & Skills: ${skills}`, { size: 20 }),
          sectionHeading("OPEN QUESTIONS"),
          ...questions.map((question) =>
            bodyParagraph(question, {
              numbering: { reference: "resume-bullets", level: 0 },
              size: 20
            })
          )
        ]
      }
    ]
  });
}

async function writeResumeDocx(wikiPages) {
  const originalResumePath = await getPrimaryOriginalResumeDocxPath();
  if (originalResumePath) {
    const outputPath = path.join(exportDir, "resume-draft.docx");
    await fs.copyFile(originalResumePath, outputPath);
    return outputPath;
  }

  try {
    await fs.access(defaultDocxTemplatePath);
    const outputPath = path.join(exportDir, "resume-draft.docx");
    await fillDocxTemplate(defaultDocxTemplatePath, outputPath, buildDocxTemplateValues(wikiPages));
    return outputPath;
  } catch {
    // Fall back to the programmatic builder if the DOCX template is missing or invalid.
  }

  const doc = buildResumeDocx(wikiPages);
  const buffer = await Packer.toBuffer(doc);
  const outputPath = path.join(exportDir, "resume-draft.docx");
  await fs.writeFile(outputPath, buffer);
  return outputPath;
}

async function getPrimaryOriginalResumeDocxPath() {
  const fileNames = await listOriginalResumeFiles();
  const docxName = fileNames.find((name) => path.extname(name).toLowerCase() === ".docx");
  return docxName ? path.join(originalResumeDir, docxName) : null;
}

function buildDocxTemplateValues(wikiPages) {
  const model = createResumeModel(wikiPages);
  const experienceBullets = model.resumeBullets.map(stripMarkdown);
  const contactParts = model.contactLine.split("|").map((part) => part.trim());
  const skillText = model.skillBullets.length
    ? model.skillBullets.map(stripMarkdown).join(", ")
    : "Needs clarification.";

  return {
    candidateName: model.candidateName,
    phone: contactParts[0] || "Phone",
    email: contactParts[1] || "email@example.com",
    location: contactParts[2] || "Location",
    schoolName: "School Name",
    schoolLocation: "School Location",
    degree: "Degree or Program",
    educationDates: "Dates",
    educationBulletOne: "Education detail or academic achievement.",
    educationBulletTwo: "Relevant coursework, honors, or activities.",
    companyName: "Organization",
    roleTitle: "Role Title",
    jobLocation: "Location",
    jobDates: "Dates",
    impactBulletOne: experienceBullets[0] ?? "Grounded resume bullet from wiki evidence.",
    impactBulletTwo: experienceBullets[1] ?? "Grounded resume bullet from wiki evidence.",
    impactBulletThree: experienceBullets[2] ?? "Grounded resume bullet from wiki evidence.",
    organizationName: "Organization",
    leadershipRole: "Leadership Role",
    leadershipLocation: "Location",
    leadershipDates: "Dates",
    leadershipBulletOne: experienceBullets[3] ?? "Grounded leadership or project bullet from wiki evidence.",
    skills: skillText,
    interests: "Optional interests or activities."
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
  readAllEvidenceFiles,
  inferSkills,
  buildWikiPages,
  writeWikiPages,
  writeResumeDocx,
  fillDocxTemplate,
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

