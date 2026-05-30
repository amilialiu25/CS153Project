const http = require("http");
const fs = require("fs");
const fsPromises = require("fs/promises");
const path = require("path");
const core = require("./main");
const { detectClaude, generateWikiPages: agentGenerateWikiPages, generateResumeValues: agentGenerateResumeValues } = require("./agent");

const PORT = 3000;
const rendererDir = path.join(__dirname, "renderer");

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
      const [projectState, rawFiles, originalResumeFiles, templateFiles, exportFiles, wikiPages, agentStatus] = await Promise.all([
        core.readProjectState(),
        core.listRawFiles(),
        core.listOriginalResumeFiles(),
        core.listResumeTemplateFiles(),
        core.listExportFiles(),
        core.readMarkdownFiles(core.wikiDir),
        detectClaude()
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
        wikiPages
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

      const agentResult = await agentGenerateResumeValues(wikiPages);
      let docxPath;
      let usedAgent = agentResult.usedAgent;

      if (agentResult.usedAgent) {
        const outputPath = path.join(core.exportDir, "resume-draft.docx");
        try {
          await fsPromises.access(core.defaultDocxTemplatePath);
          await core.fillDocxTemplate(core.defaultDocxTemplatePath, outputPath, agentResult.values);
          docxPath = outputPath;
        } catch {
          docxPath = await core.writeResumeDocx(wikiPages);
          usedAgent = false;
        }
      } else {
        docxPath = await core.writeResumeDocx(wikiPages);
      }

      let exportError = null;
      if (outputFormat === "pdf") {
        try {
          await core.convertDocxToPdf(docxPath);
        } catch (error) {
          exportError = `DOCX was created, but PDF export failed: ${error.message}`;
        }
      }

      await core.mergeProjectState({ lastResumeGeneratedAt: core.getIsoNow() });
      return sendJson(res, {
        exportFiles: await core.listExportFiles(),
        exportError,
        usedAgent
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
  } else {
    serveStatic(req, res);
  }
});

core.ensureProjectDirs().then(() => {
  server.listen(PORT, () => {
    console.log(`AI Resume Copilot running at http://localhost:${PORT}`);
  });
});
