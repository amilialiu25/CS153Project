const http = require("http");
const fs = require("fs");
const fsPromises = require("fs/promises");
const path = require("path");
const core = require("./main");
const { detectClaude, generateWikiPages: agentGenerateWikiPages, generateResumeValues: agentGenerateResumeValues } = require("./agent");

const PORT = 3000;
const rendererDir = path.join(__dirname, "renderer");
const resumeValuesPath = path.join(core.exportDir, "resume-values.json");
const resumeValuesPrevPath = path.join(core.exportDir, "resume-values-prev.json");

async function readResumeValues(filePath) {
  try { return JSON.parse(await fsPromises.readFile(filePath, "utf8")); }
  catch { return null; }
}

async function saveResumeValues(values) {
  const current = await readResumeValues(resumeValuesPath);
  if (current) await fsPromises.writeFile(resumeValuesPrevPath, JSON.stringify(current, null, 2));
  await fsPromises.writeFile(resumeValuesPath, JSON.stringify(values, null, 2));
}

const MIME_TYPES = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res, data, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function sendError(res, message, status = 500) {
  sendJson(res, { error: message }, status);
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const route = url.pathname;
  const method = req.method;

  try {
    if (route === "/api/state" && method === "GET") {
      await core.ensureProjectDirs();
      const [projectState, rawFiles, originalResumeFiles, templateFiles, exportFiles, wikiPages, agentStatus, resumeValues, prevResumeValues] = await Promise.all([
        core.readProjectState(),
        core.listRawFiles(),
        core.listOriginalResumeFiles(),
        core.listResumeTemplateFiles(),
        core.listExportFiles(),
        core.readMarkdownFiles(core.wikiDir),
        detectClaude(),
        readResumeValues(resumeValuesPath),
        readResumeValues(resumeValuesPrevPath)
      ]);

      return sendJson(res, {
        workflowMode: projectState.workflowMode,
        lastSourceUpdateAt: projectState.lastSourceUpdateAt,
        lastWikiGeneratedAt: projectState.lastWikiGeneratedAt,
        lastResumeGeneratedAt: projectState.lastResumeGeneratedAt,
        isWikiReady: core.isStateUpToDate(projectState.lastWikiGeneratedAt, projectState.lastSourceUpdateAt),
        isResumeFresh: core.isStateUpToDate(projectState.lastResumeGeneratedAt, projectState.lastWikiGeneratedAt),
        agentAvailable: agentStatus.available,
        rawFiles,
        originalResumeFiles,
        templateFiles,
        exportFiles,
        wikiPages,
        resumeValues,
        prevResumeValues
      });
    }

    if (route === "/api/agent/status" && method === "GET") {
      return sendJson(res, await detectClaude());
    }

    if (route === "/api/workflow-mode" && method === "POST") {
      await core.ensureProjectDirs();
      const { workflowMode } = JSON.parse(await readBody(req));
      const nextMode = Object.values(core.workflowModes).includes(workflowMode)
        ? workflowMode
        : core.workflowModes.buildFromScratch;
      const state = await core.mergeProjectState({ workflowMode: nextMode });
      return sendJson(res, { workflowMode: state.workflowMode });
    }

    if (route === "/api/file-preview" && method === "GET") {
      await core.ensureProjectDirs();
      const fileGroup = url.searchParams.get("group");
      const fileName = url.searchParams.get("name");
      return sendJson(res, await core.readManagedFileText(fileGroup, fileName));
    }

    if (route === "/api/delete-file" && method === "POST") {
      await core.ensureProjectDirs();
      const { fileGroup, fileName } = JSON.parse(await readBody(req));
      await core.deleteManagedFile(fileGroup, fileName);
      return sendJson(res, { ok: true });
    }

    if (route === "/api/upload/raw" && method === "POST") {
      await core.ensureProjectDirs();
      const { files } = JSON.parse(await readBody(req));
      for (const file of files) {
        const safeName = path.basename(file.name);
        await fsPromises.writeFile(path.join(core.rawDir, safeName), Buffer.from(file.bytes));
      }
      await core.mergeProjectState({ lastSourceUpdateAt: core.getIsoNow() });
      return sendJson(res, await core.listRawFiles());
    }

    if (route === "/api/upload/original" && method === "POST") {
      await core.ensureProjectDirs();
      const { files } = JSON.parse(await readBody(req));
      for (const file of files) {
        const safeName = path.basename(file.name);
        await fsPromises.writeFile(path.join(core.originalResumeDir, safeName), Buffer.from(file.bytes));
      }
      await core.mergeProjectState({ lastSourceUpdateAt: core.getIsoNow() });
      return sendJson(res, await core.listOriginalResumeFiles());
    }

    if (route === "/api/upload/template" && method === "POST") {
      await core.ensureProjectDirs();
      const { files } = JSON.parse(await readBody(req));
      for (const file of files) {
        const safeName = path.basename(file.name);
        if (path.extname(safeName).toLowerCase() !== ".docx") continue;
        await fsPromises.writeFile(path.join(core.templateDir, safeName), Buffer.from(file.bytes));
      }
      return sendJson(res, await core.listResumeTemplateFiles());
    }

    if (route === "/api/wiki/generate" && method === "POST") {
      await core.ensureProjectDirs();
      const evidenceFiles = await core.readAllEvidenceFiles();
      const skills = core.inferSkills(evidenceFiles);

      const agentResult = await agentGenerateWikiPages(evidenceFiles);
      let pages;

      if (agentResult.usedAgent) {
        pages = agentResult.pages;
        const structuralPages = await core.buildWikiPages(evidenceFiles, skills);
        pages["index.md"] = structuralPages["index.md"];
        pages["log.md"] = structuralPages["log.md"];
        pages["source-index.md"] = structuralPages["source-index.md"];
        for (const [name, content] of Object.entries(structuralPages)) {
          if (!pages[name]) pages[name] = content;
        }
      } else {
        pages = await core.buildWikiPages(evidenceFiles, skills);
      }

      await core.writeWikiPages(pages);
      await core.mergeProjectState({ lastWikiGeneratedAt: core.getIsoNow() });

      return sendJson(res, {
        wikiPages: await core.readMarkdownFiles(core.wikiDir),
        usedAgent: agentResult.usedAgent
      });
    }

    if (route === "/api/resume/generate" && method === "POST") {
      await core.ensureProjectDirs();
      const body = await readBody(req);
      const options = body ? JSON.parse(body) : {};
      const wikiPages = await core.readMarkdownFiles(core.wikiDir);
      const outputFormat = options.outputFormat === "pdf" ? "pdf" : "docx";

      const projectState = await core.readProjectState();
      const styleProfile = await core.resolveResumeStyleProfile(projectState.workflowMode);

      const agentResult = await agentGenerateResumeValues(wikiPages);
      let usedAgent = agentResult.usedAgent;
      let resumeValues;

      if (agentResult.usedAgent && Array.isArray(agentResult.values.experience)) {
        resumeValues = core.trimResumeValues(agentResult.values);
      } else {
        resumeValues = core.trimResumeValues(core.buildFullResumeValues(wikiPages));
        usedAgent = false;
      }

      const docxPath = await core.writeResumeDocx(wikiPages, resumeValues, styleProfile);

      const prevResumeValues = await readResumeValues(resumeValuesPath);
      await saveResumeValues(resumeValues);

      let exportError = null;
      try {
        await core.convertDocxToPdf(docxPath);
      } catch (error) {
        exportError = `DOCX was created, but PDF export failed: ${error.message}`;
      }

      await core.mergeProjectState({ lastResumeGeneratedAt: core.getIsoNow() });
      return sendJson(res, {
        exportFiles: await core.listExportFiles(),
        exportError,
        usedAgent,
        formatSource: styleProfile.source,
        resumeValues,
        prevResumeValues
      });
    }

    sendError(res, "Not found", 404);
  } catch (err) {
    console.error("API error:", err);
    sendError(res, err.message);
  }
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let filePath = url.pathname === "/" ? "/index.html" : url.pathname;
  const fullPath = path.join(rendererDir, filePath);

  if (!fullPath.startsWith(rendererDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  const ext = path.extname(fullPath);
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  const stream = fs.createReadStream(fullPath);
  stream.on("open", () => {
    res.writeHead(200, { "Content-Type": contentType });
    stream.pipe(res);
  });
  stream.on("error", () => {
    res.writeHead(404);
    res.end("Not found");
  });
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/")) {
    handleApi(req, res);
  } else if (req.url.startsWith("/exports/")) {
    const safeName = path.basename(req.url);
    const fullPath = path.join(core.exportDir, safeName);
    if (!fullPath.startsWith(core.exportDir)) { res.writeHead(403); res.end(); return; }
    const ext = path.extname(safeName);
    const ct = ext === ".pdf" ? "application/pdf" : ext === ".docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "application/octet-stream";
    const stream = fs.createReadStream(fullPath);
    stream.on("open", () => { res.writeHead(200, { "Content-Type": ct }); stream.pipe(res); });
    stream.on("error", () => { res.writeHead(404); res.end("Not found"); });
  } else {
    serveStatic(req, res);
  }
});

core.ensureProjectDirs().then(() => {
  server.listen(PORT, () => {
    console.log(`AI Resume Copilot running at http://localhost:${PORT}`);
  });
});
