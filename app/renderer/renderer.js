const workflowModeGroup = document.querySelector("#workflowModeGroup");
const workflowModeInputs = Array.from(document.querySelectorAll('input[name="workflowMode"]'));
const modeSummary = document.querySelector("#modeSummary");
const fileInput = document.querySelector("#fileInput");
const originalResumeInput = document.querySelector("#originalResumeInput");
const rawList = document.querySelector("#rawList");
const originalResumeList = document.querySelector("#originalResumeList");
const originalResumeNote = document.querySelector("#originalResumeNote");
const wikiStatusBadge = document.querySelector("#wikiStatusBadge");
const resumeStatusBadge = document.querySelector("#resumeStatusBadge");
const wikiPreview = document.querySelector("#wikiPreview");
const resumePreview = document.querySelector("#resumePreview");
const generateWikiButton = document.querySelector("#generateWikiButton");
const generateResumeButton = document.querySelector("#generateResumeButton");

const workflowModes = {
  buildFromScratch: "build-from-scratch",
  improveExistingResume: "improve-existing-resume"
};

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function renderInlineMarkdown(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/_([^_]+)_/g, "<em>$1</em>");
}

function markdownToHtml(content) {
  const lines = content.split(/\r?\n/);
  const blocks = [];
  let paragraphLines = [];
  let listItems = [];

  function flushParagraph() {
    if (!paragraphLines.length) {
      return;
    }

    blocks.push(`<p>${renderInlineMarkdown(paragraphLines.join(" "))}</p>`);
    paragraphLines = [];
  }

  function flushList() {
    if (!listItems.length) {
      return;
    }

    blocks.push(`<ul>${listItems.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join("")}</ul>`);
    listItems = [];
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    if (trimmed.startsWith("### ")) {
      flushParagraph();
      flushList();
      blocks.push(`<h4>${renderInlineMarkdown(trimmed.slice(4))}</h4>`);
      continue;
    }

    if (trimmed.startsWith("## ")) {
      flushParagraph();
      flushList();
      blocks.push(`<h3>${renderInlineMarkdown(trimmed.slice(3))}</h3>`);
      continue;
    }

    if (trimmed.startsWith("# ")) {
      flushParagraph();
      flushList();
      blocks.push(`<h2>${renderInlineMarkdown(trimmed.slice(2))}</h2>`);
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      flushParagraph();
      listItems.push(trimmed.replace(/^[-*]\s+/, ""));
      continue;
    }

    paragraphLines.push(trimmed);
  }

  flushParagraph();
  flushList();

  return blocks.join("");
}

function createEmptyState(message) {
  const empty = document.createElement("div");
  empty.className = "empty-state";
  empty.textContent = message;
  return empty;
}

function renderFileList(container, files, emptyMessage) {
  container.innerHTML = "";

  if (files.length === 0) {
    const item = document.createElement("li");
    item.className = "empty-chip";
    item.textContent = emptyMessage;
    container.appendChild(item);
    return;
  }

  for (const file of files) {
    const item = document.createElement("li");
    item.textContent = file;
    container.appendChild(item);
  }
}

function summarizeMarkdown(content) {
  const cleanLines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

  return cleanLines[0] ?? "No preview text yet.";
}

function renderWikiPreview(container, pages, emptyText) {
  container.innerHTML = "";

  if (pages.length === 0) {
    container.appendChild(createEmptyState(emptyText));
    return;
  }

  for (const [index, page] of pages.entries()) {
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    const titleGroup = document.createElement("div");
    const title = document.createElement("span");
    const excerpt = document.createElement("span");
    const body = document.createElement("div");

    details.className = "doc-accordion";
    details.open = index === 0;

    summary.className = "doc-summary";
    titleGroup.className = "doc-summary-copy";
    title.className = "doc-title";
    excerpt.className = "doc-excerpt";
    body.className = "doc-body markdown-body";

    title.textContent = page.name;
    excerpt.textContent = summarizeMarkdown(page.content);
    body.innerHTML = markdownToHtml(page.content);

    titleGroup.append(title, excerpt);
    summary.append(titleGroup);
    details.append(summary, body);
    container.appendChild(details);
  }
}

function renderResumePreview(container, drafts, emptyText) {
  container.innerHTML = "";

  if (drafts.length === 0) {
    container.appendChild(createEmptyState(emptyText));
    return;
  }

  for (const draft of drafts) {
    const article = document.createElement("article");
    const top = document.createElement("div");
    const label = document.createElement("p");
    const title = document.createElement("h3");
    const body = document.createElement("div");

    article.className = "resume-card";
    top.className = "resume-card-top";
    label.className = "resume-label";
    title.className = "resume-title";
    body.className = "markdown-body resume-body";

    label.textContent = "Draft";
    title.textContent = draft.name;
    body.innerHTML = markdownToHtml(draft.content);

    top.append(label, title);
    article.append(top, body);
    container.appendChild(article);
  }
}

function updateWorkflowModeUI(workflowMode) {
  for (const input of workflowModeInputs) {
    input.checked = input.value === workflowMode;
  }

  workflowModeGroup.dataset.mode = workflowMode;

  if (workflowMode === workflowModes.improveExistingResume) {
    modeSummary.textContent = "We will treat your current resume as the starting point, then polish or update it with wiki-backed facts.";
    originalResumeNote.textContent = "This mode starts with your current resume. Prefer `.docx` when available, but text-based PDF is also fine.";
    generateResumeButton.textContent = "Update resume";
  } else {
    modeSummary.textContent = "We will turn raw evidence into wiki facts first, then build a new resume draft from scratch.";
    originalResumeNote.textContent = "Optional for now. This area will later support side-by-side comparison even in the build-from-scratch flow.";
    generateResumeButton.textContent = "Generate resume";
  }
}

function formatStatusDate(isoString) {
  if (!isoString) {
    return null;
  }

  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function updateGenerationStatus(state) {
  const wikiTime = formatStatusDate(state.lastWikiGeneratedAt);
  const resumeTime = formatStatusDate(state.lastResumeGeneratedAt);

  if (state.isWikiReady) {
    wikiStatusBadge.textContent = wikiTime
      ? `Wiki ready · ${wikiTime}`
      : "Wiki ready";
    wikiStatusBadge.dataset.state = "ready";
  } else if (state.lastSourceUpdateAt) {
    wikiStatusBadge.textContent = "Sources changed · refresh wiki";
    wikiStatusBadge.dataset.state = "warning";
  } else {
    wikiStatusBadge.textContent = "Wiki not generated yet";
    wikiStatusBadge.dataset.state = "idle";
  }

  if (state.isWikiReady) {
    generateResumeButton.disabled = false;

    if (state.isResumeFresh) {
      resumeStatusBadge.textContent = resumeTime
        ? `Resume current · ${resumeTime}`
        : "Resume current";
      resumeStatusBadge.dataset.state = "ready";
    } else if (state.lastResumeGeneratedAt) {
      resumeStatusBadge.textContent = "Wiki changed · refresh resume";
      resumeStatusBadge.dataset.state = "warning";
    } else {
      resumeStatusBadge.textContent = "Wiki ready · generate resume next";
      resumeStatusBadge.dataset.state = "ready";
    }
  } else {
    generateResumeButton.disabled = true;
    resumeStatusBadge.textContent = "Generate wiki first";
    resumeStatusBadge.dataset.state = "idle";
  }
}

async function serializeInputFiles(input) {
  return Promise.all(
    Array.from(input.files).map(async (file) => ({
      name: file.name,
      bytes: Array.from(new Uint8Array(await file.arrayBuffer()))
    }))
  );
}

async function refreshState() {
  const state = await window.resumeCopilot.getState();
  updateWorkflowModeUI(state.workflowMode);
  updateGenerationStatus(state);
  renderFileList(rawList, state.rawFiles, "No raw files uploaded yet.");
  renderFileList(originalResumeList, state.originalResumeFiles, "No original resume uploaded yet.");
  renderWikiPreview(wikiPreview, state.wikiPages, "No wiki pages yet.");
  renderResumePreview(resumePreview, state.resumeDrafts, "No resume drafts yet.");
}

workflowModeInputs.forEach((input) => {
  input.addEventListener("change", async () => {
    if (!input.checked) {
      return;
    }

    const state = await window.resumeCopilot.setWorkflowMode(input.value);
    updateWorkflowModeUI(state.workflowMode);
  });
});

fileInput.addEventListener("change", async () => {
  const files = await serializeInputFiles(fileInput);
  await window.resumeCopilot.uploadFiles(files);
  fileInput.value = "";
  await refreshState();
});

originalResumeInput.addEventListener("change", async () => {
  const files = await serializeInputFiles(originalResumeInput);
  await window.resumeCopilot.uploadOriginalResumeFiles(files);
  originalResumeInput.value = "";
  await refreshState();
});

generateWikiButton.addEventListener("click", async () => {
  await window.resumeCopilot.generateWiki();
  await refreshState();
});

generateResumeButton.addEventListener("click", async () => {
  if (generateResumeButton.disabled) {
    return;
  }

  await window.resumeCopilot.generateResume();
  await refreshState();
});

refreshState();
