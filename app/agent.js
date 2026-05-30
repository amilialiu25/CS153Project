const { spawn } = require("child_process");
const path = require("path");
const os = require("os");

const WIKI_TIMEOUT_MS = 300_000;
const RESUME_TIMEOUT_MS = 120_000;

const WIKI_PAGE_NAMES = [
  "profile.md",
  "education.md",
  "work-experience.md",
  "leadership-experience.md",
  "skills.md",
  "resume-bullets.md",
  "impact-metrics.md",
  "projects.md",
  "original-resume.md",
  "open-questions.md"
];

const TEMPLATE_FIELDS = [
  "candidateName",
  "phone",
  "email",
  "location",
  "schoolName",
  "schoolLocation",
  "degree",
  "educationDates",
  "educationBulletOne",
  "educationBulletTwo",
  "companyName",
  "roleTitle",
  "jobLocation",
  "jobDates",
  "impactBulletOne",
  "impactBulletTwo",
  "impactBulletThree",
  "organizationName",
  "leadershipRole",
  "leadershipLocation",
  "leadershipDates",
  "leadershipBulletOne",
  "skills",
  "interests"
];

let cachedDetection = null;

function getClaudeCandidates() {
  const home = os.homedir();
  const candidates = ["claude"];

  if (process.platform === "win32") {
    candidates.push(
      path.join(home, ".local", "bin", "claude.exe"),
      path.join(home, "AppData", "Local", "Programs", "claude-code", "claude.exe"),
      path.join(home, "AppData", "Roaming", "npm", "claude.cmd")
    );
  } else {
    candidates.push(
      path.join(home, ".local", "bin", "claude"),
      path.join(home, ".npm-global", "bin", "claude"),
      "/usr/local/bin/claude"
    );
  }

  return candidates;
}

async function detectClaude() {
  if (cachedDetection) {
    return cachedDetection;
  }

  for (const candidate of getClaudeCandidates()) {
    const isFullPath = path.isAbsolute(candidate);
    try {
      const version = await runCommand(candidate, ["--version"], !isFullPath);
      cachedDetection = { available: true, cli: candidate, version: version.trim() };
      console.log(`Claude CLI found: ${candidate} (${cachedDetection.version})`);
      return cachedDetection;
    } catch {
      // try next candidate
    }
  }

  cachedDetection = { available: false, cli: null, version: null };
  console.warn("Claude CLI not found. Wiki/resume generation will use heuristic fallback.");
  return cachedDetection;
}

function runCommand(command, args, useShell = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: useShell, windowsHide: true });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${command} timed out`));
    }, 10_000);

    child.on("error", (err) => { clearTimeout(timer); reject(err); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || `${command} exited with code ${code}`));
    });
  });
}

function runClaude(cliPath, prompt, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(cliPath, ["-p", "--output-format", "json"], {
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Claude CLI timed out after ${timeoutMs / 1000} seconds.`));
    }, timeoutMs);

    child.on("error", (err) => { clearTimeout(timer); reject(err); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(stderr || `claude exited with code ${code}`));
        return;
      }

      try {
        const envelope = JSON.parse(stdout);
        const text = typeof envelope.result === "string"
          ? envelope.result
          : typeof envelope === "string" ? envelope : stdout;
        resolve(text);
      } catch {
        resolve(stdout);
      }
    });

    child.stdin.write(prompt, "utf8");
    child.stdin.end();
  });
}

function parseAgentJson(text) {
  const cleaned = text.trim();

  try {
    return JSON.parse(cleaned);
  } catch { /* continue */ }

  const fenceMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch { /* continue */ }
  }

  const objectMatch = cleaned.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    try {
      return JSON.parse(objectMatch[0]);
    } catch { /* continue */ }
  }

  throw new Error("Could not parse JSON from agent output.");
}

function buildWikiPrompt(evidenceFiles) {
  const timestamp = new Date().toISOString();
  const evidenceSections = evidenceFiles
    .filter((e) => e.isText && e.text.trim())
    .map((e) => `### File: ${e.name} (type: ${e.sourceType})\n\`\`\`\n${e.text}\n\`\`\``)
    .join("\n\n");

  return `You are a resume wiki builder following the LLM Wiki pattern. Your job is to deeply analyze the source evidence below and produce a structured, interlinked personal knowledge base optimized for resume generation.

## Your task

Read all the evidence files carefully. Analyze the candidate's background, experiences, achievements, and skills. Then produce a JSON object where each key is a wiki page filename and each value is the full Markdown content for that page.

## Output format

Return ONLY a JSON code block. The JSON must have exactly these keys:
${WIKI_PAGE_NAMES.map((n) => `"${n}"`).join(", ")}

## Page format

Every page must follow this structure:
- Start with \`# Page Title\`
- Include \`**Summary**: one-to-two sentence description\`
- Include \`**Sources**:\` with bullet list of source filenames
- Include \`**Last updated**: ${timestamp}\`
- Include \`---\` separator
- Then rich body content with \`## Section\` headings
- End with \`## Related pages\` section using [[wiki-link]] notation

## Page-specific instructions

**profile.md**: Synthesize the candidate's identity. Include full name, contact info, a 2-3 sentence professional summary highlighting their strongest positioning, and their career trajectory (education → work → current focus). This should read like a professional brief, not a data dump.

**education.md**: List each degree with school, location, dates, GPA, honors, and relevant coursework. Add context about how the education connects to their career goals.

**work-experience.md**: For EACH role, include the company, title, location, dates, and then analyze the bullet points. Group achievements by theme (e.g., "Revenue Impact", "Technical Leadership", "Process Improvement"). Highlight the strongest metrics and cross-reference with [[impact-metrics]].

**leadership-experience.md**: Same structure as work experience but for leadership, research, volunteer, and extracurricular roles. Note transferable skills.

**skills.md**: Categorize skills into groups (e.g., "Programming Languages", "Data & Analytics", "Business & Finance", "Soft Skills"). Only include skills that are evidenced in the source material. Note which experiences demonstrate each skill.

**resume-bullets.md**: This is the most important page. Transform raw experience bullets into polished, resume-ready statements. Each bullet should: start with a strong action verb, include quantified impact where available, specify scope and context. Organize by experience. Mark the top 5-8 strongest bullets.

**impact-metrics.md**: Extract and organize ALL quantified achievements. For each metric, note: the number, what it measures, the context, and which experience it comes from. Flag the most impressive metrics for resume prominence.

**projects.md**: Identify distinct projects, initiatives, or ventures. For each, summarize: what it was, the candidate's role, technologies/methods used, outcomes, and current status. Connect to [[impact-metrics]] where applicable.

**original-resume.md**: If the evidence includes an existing resume, preserve its structure and content as a reference. Note what sections it has, what's strong, and what could be improved.

**open-questions.md**: Identify gaps in the evidence that would strengthen the resume. Examples: missing metrics for strong-sounding achievements, unclear role scope, missing dates, skills claimed but not demonstrated, experiences that could use more context.

## Analysis rules

- Deeply analyze each piece of evidence. Don't just copy text — synthesize, categorize, and connect information across sources.
- Every factual claim must cite its source using \`(source: filename)\` format.
- Use \`[[wiki-links]]\` extensively to connect related concepts across pages.
- When evidence is ambiguous or incomplete, mark it as \`Needs verification\` and add a question to open-questions.md.
- Prioritize resume-useful information: roles, actions, tools, outcomes, impact, metrics.
- Write in clear, professional language suitable for resume building.

## Evidence files

${evidenceSections || "No readable evidence files were provided."}

Return ONLY the JSON object inside a \`\`\`json code fence, nothing else.`;
}

function buildResumePrompt(wikiPages) {
  const wikiSections = wikiPages
    .map((p) => `### ${p.name}\n${p.content}`)
    .join("\n\n");

  return `You are a professional resume data extractor. Given the wiki pages below, extract the best values for a resume template. Return ONLY a JSON code block with exactly these keys:

${TEMPLATE_FIELDS.join(", ")}

## Field descriptions
- candidateName: full name of the candidate
- phone, email, location: contact details (parse from contact line if needed)
- schoolName, schoolLocation, degree, educationDates: most prominent education
- educationBulletOne, educationBulletTwo: strongest academic achievements or coursework highlights
- companyName, roleTitle, jobLocation, jobDates: most recent or most impactful work experience
- impactBulletOne/Two/Three: the 3 strongest achievement bullets with metrics, starting with action verbs
- organizationName, leadershipRole, leadershipLocation, leadershipDates: most notable leadership experience
- leadershipBulletOne: strongest leadership achievement bullet
- skills: comma-separated list of categorized skills
- interests: interests and activities that show personality

## Rules
- Extract values directly from the wiki content. Do not invent information.
- For bullet fields: use concise, polished action-verb statements with metrics when available.
- For missing fields: use "Needs clarification" as the value.
- Choose the most recent or most impactful experience for the primary slots.
- Prioritize bullets that have quantified impact metrics.

## Wiki pages

${wikiSections}

Return ONLY the JSON object inside a \`\`\`json code fence, nothing else.`;
}

async function generateWikiPages(evidenceFiles) {
  try {
    const detection = await detectClaude();
    if (!detection.available) {
      return { pages: {}, usedAgent: false };
    }

    console.log("Starting agent-backed wiki generation...");
    const prompt = buildWikiPrompt(evidenceFiles);
    const output = await runClaude(detection.cli, prompt, WIKI_TIMEOUT_MS);
    const parsed = parseAgentJson(output);

    const hasAllPages = WIKI_PAGE_NAMES.every((name) => typeof parsed[name] === "string");
    if (!hasAllPages) {
      const missing = WIKI_PAGE_NAMES.filter((name) => typeof parsed[name] !== "string");
      console.warn(`Agent returned incomplete wiki pages (missing: ${missing.join(", ")}), falling back to heuristic.`);
      return { pages: {}, usedAgent: false };
    }

    console.log("Agent-backed wiki generation complete.");
    return { pages: parsed, usedAgent: true };
  } catch (err) {
    console.error("Agent wiki generation failed:", err.message);
    return { pages: {}, usedAgent: false };
  }
}

async function generateResumeValues(wikiPages) {
  try {
    const detection = await detectClaude();
    if (!detection.available) {
      return { values: {}, usedAgent: false };
    }

    console.log("Starting agent-backed resume extraction...");
    const prompt = buildResumePrompt(wikiPages);
    const output = await runClaude(detection.cli, prompt, RESUME_TIMEOUT_MS);
    const parsed = parseAgentJson(output);

    for (const field of TEMPLATE_FIELDS) {
      if (typeof parsed[field] !== "string") {
        parsed[field] = "Needs clarification";
      }
    }

    console.log("Agent-backed resume extraction complete.");
    return { values: parsed, usedAgent: true };
  } catch (err) {
    console.error("Agent resume generation failed:", err.message);
    return { values: {}, usedAgent: false };
  }
}

module.exports = {
  detectClaude,
  generateWikiPages,
  generateResumeValues
};
