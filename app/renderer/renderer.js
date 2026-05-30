/* ─── API ─── */

const jsonPost = (url, body) =>
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }).then((r) => r.json());

const resumeCopilot = {
  getState: () => fetch("/api/state").then((r) => r.json()),
  setWorkflowMode: (workflowMode) => jsonPost("/api/workflow-mode", { workflowMode }),
  deleteFile: (fileGroup, fileName) => jsonPost("/api/delete-file", { fileGroup, fileName }),
  uploadFiles: (files) => jsonPost("/api/upload/raw", { files }),
  uploadOriginalResumeFiles: (files) => jsonPost("/api/upload/original", { files }),
  uploadTemplateFiles: (files) => jsonPost("/api/upload/template", { files }),
  generateWiki: () => jsonPost("/api/wiki/generate", {}),
  generateResume: (options) => jsonPost("/api/resume/generate", options || {})
};

/* ─── DOM REFS ─── */

const shell = document.querySelector("#appShell");
const workflowModeInputs = Array.from(document.querySelectorAll('input[name="workflowMode"]'));
const fileInput = document.querySelector("#fileInput");
const originalResumeInput = document.querySelector("#originalResumeInput");
const templateInput = document.querySelector("#templateInput");
const rawList = document.querySelector("#rawList");
const originalResumeList = document.querySelector("#originalResumeList");
const templateList = document.querySelector("#templateList");
const exportList = document.querySelector("#exportList");
const wikiFileTree = document.querySelector("#wikiFileTree");
const wikiStatusBadge = document.querySelector("#wikiStatusBadge");
const resumeStatusBadge = document.querySelector("#resumeStatusBadge");
const generateWikiButton = document.querySelector("#generateWikiButton");
const generateResumeButton = document.querySelector("#generateResumeButton");
const outputFormatInputs = Array.from(document.querySelectorAll('input[name="outputFormat"]'));
const agentStatusIndicator = document.querySelector("#agentStatusIndicator");
const wikiLoadingOverlay = document.querySelector("#wikiLoadingOverlay");
const resumeLoadingOverlay = document.querySelector("#resumeLoadingOverlay");
const graphCanvas = document.querySelector("#graphCanvas");
const graphEmptyState = document.querySelector("#graphEmptyState");
const graphResetBtn = document.querySelector("#graphResetBtn");
const contentEmpty = document.querySelector("#contentEmpty");
const contentActive = document.querySelector("#contentActive");
const contentTitle = document.querySelector("#contentTitle");
const contentBody = document.querySelector("#contentBody");
const resizeHandle = document.querySelector("#resizeHandle");

/* ─── STATE ─── */

let currentWikiPages = [];
let activePageName = null;
let graph = null;

/* ─── RESIZE HANDLE ─── */

let isResizing = false;

resizeHandle.addEventListener("mousedown", (e) => {
  isResizing = true;
  resizeHandle.classList.add("active");
  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";
  e.preventDefault();
});

document.addEventListener("mousemove", (e) => {
  if (!isResizing) return;
  const shellRect = shell.getBoundingClientRect();
  const sidebarW = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--sidebar-w"));
  const graphW = shellRect.right - e.clientX - 2;
  const minGraph = 200;
  const maxGraph = shellRect.width - sidebarW - 300 - 4;
  const clamped = Math.max(minGraph, Math.min(maxGraph, graphW));
  document.documentElement.style.setProperty("--graph-w", clamped + "px");
  if (graph) graph.resize();
});

document.addEventListener("mouseup", () => {
  if (isResizing) {
    isResizing = false;
    resizeHandle.classList.remove("active");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }
});

/* ─── GRAPH ENGINE ─── */

class GraphEngine {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.nodes = [];
    this.edges = [];
    this.dpr = window.devicePixelRatio || 1;
    this.width = 0;
    this.height = 0;
    this.hoveredNode = null;
    this.draggedNode = null;
    this.mouseX = 0;
    this.mouseY = 0;
    this.animFrame = null;
    this.damping = 0.92;
    this.running = false;
    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;
    this.isPanning = false;
    this.panStartX = 0;
    this.panStartY = 0;
    this._mouseDownPos = null;

    this._onMouseMove = this._onMouseMove.bind(this);
    this._onMouseDown = this._onMouseDown.bind(this);
    this._onMouseUp = this._onMouseUp.bind(this);
    this._onClick = this._onClick.bind(this);
    this._onWheel = this._onWheel.bind(this);
    this._tick = this._tick.bind(this);

    canvas.addEventListener("mousemove", this._onMouseMove);
    canvas.addEventListener("mousedown", this._onMouseDown);
    canvas.addEventListener("mouseup", this._onMouseUp);
    canvas.addEventListener("click", this._onClick);
    canvas.addEventListener("wheel", this._onWheel, { passive: false });
    window.addEventListener("resize", () => this.resize());
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = this.width * this.dpr;
    this.canvas.height = this.height * this.dpr;
    this.canvas.style.width = this.width + "px";
    this.canvas.style.height = this.height + "px";
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  setData(pages) {
    const nodeMap = new Map();
    this.nodes = [];
    this.edges = [];

    const cx = this.width / 2;
    const cy = this.height / 2;
    const radius = Math.min(this.width, this.height) * 0.25;

    pages.forEach((page, i) => {
      const slug = page.name.replace(/\.md$/, "");
      const angle = (i / pages.length) * Math.PI * 2 - Math.PI / 2;
      const node = {
        id: slug,
        label: slug,
        x: cx + Math.cos(angle) * radius + (Math.random() - 0.5) * 30,
        y: cy + Math.sin(angle) * radius + (Math.random() - 0.5) * 30,
        vx: 0,
        vy: 0,
        radius: 4,
        content: page.content,
        fileName: page.name,
        connections: 0
      };
      this.nodes.push(node);
      nodeMap.set(slug, node);
    });

    pages.forEach((page) => {
      const sourceSlug = page.name.replace(/\.md$/, "");
      const linkPattern = /\[\[([^\]]+)\]\]/g;
      let match;
      while ((match = linkPattern.exec(page.content)) !== null) {
        const targetSlug = match[1].toLowerCase().replace(/\s+/g, "-");
        if (nodeMap.has(targetSlug) && targetSlug !== sourceSlug) {
          const exists = this.edges.some(
            (e) =>
              (e.source.id === sourceSlug && e.target.id === targetSlug) ||
              (e.source.id === targetSlug && e.target.id === sourceSlug)
          );
          if (!exists) {
            const source = nodeMap.get(sourceSlug);
            const target = nodeMap.get(targetSlug);
            this.edges.push({ source, target });
            source.connections++;
            target.connections++;
          }
        }
      }
    });

    this.nodes.forEach((n) => {
      n.radius = Math.max(1.8, Math.min(3.5, 1.5 + n.connections * 0.2));
    });

    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;
    this.start();
  }

  start() {
    this.running = true;
    this.resize();
    if (!this.animFrame) this._tick();
  }

  stop() {
    this.running = false;
    if (this.animFrame) {
      cancelAnimationFrame(this.animFrame);
      this.animFrame = null;
    }
  }

  reset() {
    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;
    if (this.nodes.length && currentWikiPages.length) {
      this.setData(currentWikiPages);
    }
  }

  _tick() {
    this._simulate();
    this._draw();
    this.animFrame = requestAnimationFrame(this._tick);
  }

  _simulate() {
    const repulsion = 700;
    const attraction = 0.008;
    const centerPull = 0.012;
    const cx = this.width / 2;
    const cy = this.height / 2;

    for (let i = 0; i < this.nodes.length; i++) {
      const a = this.nodes[i];
      if (a === this.draggedNode) continue;

      a.vx += (cx - a.x) * centerPull;
      a.vy += (cy - a.y) * centerPull;

      for (let j = i + 1; j < this.nodes.length; j++) {
        const b = this.nodes[j];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let dist = Math.sqrt(dx * dx + dy * dy) || 1;
        let force = repulsion / (dist * dist);
        let fx = (dx / dist) * force;
        let fy = (dy / dist) * force;
        if (a !== this.draggedNode) { a.vx += fx; a.vy += fy; }
        if (b !== this.draggedNode) { b.vx -= fx; b.vy -= fy; }
      }
    }

    for (const edge of this.edges) {
      const dx = edge.target.x - edge.source.x;
      const dy = edge.target.y - edge.source.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const idealDist = 130;
      const force = (dist - idealDist) * attraction;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      if (edge.source !== this.draggedNode) { edge.source.vx += fx; edge.source.vy += fy; }
      if (edge.target !== this.draggedNode) { edge.target.vx -= fx; edge.target.vy -= fy; }
    }

    const pad = 40;
    for (const n of this.nodes) {
      if (n === this.draggedNode) continue;
      n.vx *= this.damping;
      n.vy *= this.damping;
      n.x += n.vx;
      n.y += n.vy;
      n.x = Math.max(pad, Math.min(this.width - pad, n.x));
      n.y = Math.max(pad, Math.min(this.height - pad, n.y));
    }
  }

  _draw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);

    ctx.save();
    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(this.scale, this.scale);

    for (const edge of this.edges) {
      const isHovered =
        this.hoveredNode &&
        (edge.source === this.hoveredNode || edge.target === this.hoveredNode);
      const isActive =
        activePageName &&
        (edge.source.fileName === activePageName || edge.target.fileName === activePageName);

      ctx.beginPath();
      ctx.moveTo(edge.source.x, edge.source.y);
      ctx.lineTo(edge.target.x, edge.target.y);

      if (isHovered || isActive) {
        ctx.strokeStyle = "rgba(200, 200, 200, 0.25)";
        ctx.lineWidth = 0.6;
      } else {
        ctx.strokeStyle = "rgba(150, 150, 150, 0.07)";
        ctx.lineWidth = 0.4;
      }
      ctx.stroke();
    }

    for (const node of this.nodes) {
      const isHovered = node === this.hoveredNode;
      const isActive = node.fileName === activePageName;
      const isConnected =
        this.hoveredNode &&
        this.edges.some(
          (e) =>
            (e.source === this.hoveredNode && e.target === node) ||
            (e.target === this.hoveredNode && e.source === node)
        );

      ctx.beginPath();
      ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);

      if (isActive) {
        ctx.fillStyle = "#e0e0e0";
      } else if (isHovered) {
        ctx.fillStyle = "#d4d4d4";
      } else if (isConnected) {
        ctx.fillStyle = "rgba(180, 180, 180, 0.7)";
      } else {
        ctx.fillStyle = "rgba(150, 150, 150, 0.5)";
      }
      ctx.fill();

      ctx.font = `${isHovered || isActive ? 500 : 400} 8px 'Outfit', sans-serif`;
      if (isHovered || isActive) {
        ctx.fillStyle = "#dcddde";
      } else if (isConnected) {
        ctx.fillStyle = "rgba(220, 220, 220, 0.5)";
      } else {
        ctx.fillStyle = "rgba(220, 220, 220, 0.25)";
      }
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(node.label, Math.round(node.x), Math.round(node.y - node.radius - 5));
    }

    ctx.restore();
    this.canvas.style.cursor = this.isPanning ? "grabbing" : this.hoveredNode ? "pointer" : "grab";
  }

  _screenToWorld(sx, sy) {
    return {
      x: (sx - this.offsetX) / this.scale,
      y: (sy - this.offsetY) / this.scale
    };
  }

  _getNodeAt(wx, wy) {
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const n = this.nodes[i];
      const dx = wx - n.x;
      const dy = wy - n.y;
      const hitRadius = Math.max(n.radius + 4, 10);
      if (dx * dx + dy * dy <= hitRadius * hitRadius) return n;
    }
    return null;
  }

  _canvasCoords(e) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  _onMouseMove(e) {
    const { x, y } = this._canvasCoords(e);
    this.mouseX = x;
    this.mouseY = y;

    if (this.isPanning) {
      this.offsetX = x - this.panStartX;
      this.offsetY = y - this.panStartY;
      return;
    }

    const world = this._screenToWorld(x, y);

    if (this.draggedNode) {
      this.draggedNode.x = world.x;
      this.draggedNode.y = world.y;
      this.draggedNode.vx = 0;
      this.draggedNode.vy = 0;
      return;
    }

    this.hoveredNode = this._getNodeAt(world.x, world.y);
  }

  _onMouseDown(e) {
    const { x, y } = this._canvasCoords(e);
    this._mouseDownPos = { x, y };
    const world = this._screenToWorld(x, y);
    const node = this._getNodeAt(world.x, world.y);
    if (node) {
      this.draggedNode = node;
      node.vx = 0;
      node.vy = 0;
    } else {
      this.isPanning = true;
      this.panStartX = x - this.offsetX;
      this.panStartY = y - this.offsetY;
    }
  }

  _onMouseUp() {
    this.draggedNode = null;
    this.isPanning = false;
  }

  _onClick(e) {
    const { x, y } = this._canvasCoords(e);
    if (this._mouseDownPos) {
      const dx = x - this._mouseDownPos.x;
      const dy = y - this._mouseDownPos.y;
      if (dx * dx + dy * dy > 9) return;
    }
    const world = this._screenToWorld(x, y);
    const node = this._getNodeAt(world.x, world.y);
    if (node) {
      openPagePreview(node.fileName);
    }
  }

  _onWheel(e) {
    e.preventDefault();
    const { x, y } = this._canvasCoords(e);
    const wx = (x - this.offsetX) / this.scale;
    const wy = (y - this.offsetY) / this.scale;
    const factor = e.deltaY > 0 ? 0.92 : 1.08;
    this.scale = Math.max(0.2, Math.min(5, this.scale * factor));
    this.offsetX = x - wx * this.scale;
    this.offsetY = y - wy * this.scale;
  }
}

/* ─── MARKDOWN RENDERER ─── */

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function renderInlineMarkdown(text) {
  return escapeHtml(text)
    .replace(/\[\[([^\]]+)\]\]/g, '<span class="wiki-link" data-page="$1">$1</span>')
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/_([^_]+)_/g, "<em>$1</em>");
}

function markdownToHtml(content) {
  const lines = content.split(/\r?\n/);
  const blocks = [];
  let paragraphLines = [];
  let listItems = [];
  let inMeta = false;
  let metaLines = [];

  function flushParagraph() {
    if (!paragraphLines.length) return;
    blocks.push(`<p>${renderInlineMarkdown(paragraphLines.join(" "))}</p>`);
    paragraphLines = [];
  }

  function flushList() {
    if (!listItems.length) return;
    blocks.push(`<ul>${listItems.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join("")}</ul>`);
    listItems = [];
  }

  function flushMeta() {
    if (!metaLines.length) return;
    blocks.push(`<div class="meta-block">${metaLines.map((l) => `<p>${renderInlineMarkdown(l)}</p>`).join("")}</div>`);
    metaLines = [];
    inMeta = false;
  }

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();

    if (trimmed === "---") {
      if (inMeta) { flushMeta(); }
      else if (metaLines.length) { flushMeta(); }
      continue;
    }

    if (trimmed.startsWith("**Summary**:") || trimmed.startsWith("**Sources**:") || trimmed.startsWith("**Last updated**:")) {
      flushParagraph();
      flushList();
      inMeta = true;
      metaLines.push(trimmed);
      continue;
    }

    if (inMeta && (trimmed.startsWith("- ") || trimmed === "")) {
      if (trimmed.startsWith("- ")) metaLines.push(trimmed);
      if (trimmed === "") { flushMeta(); }
      continue;
    }

    if (inMeta && trimmed) {
      metaLines.push(trimmed);
      continue;
    }

    if (inMeta && !trimmed) { flushMeta(); }

    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    if (trimmed.startsWith("#### ")) {
      flushParagraph(); flushList(); flushMeta();
      blocks.push(`<h4>${renderInlineMarkdown(trimmed.slice(5))}</h4>`);
      continue;
    }

    if (trimmed.startsWith("### ")) {
      flushParagraph(); flushList(); flushMeta();
      blocks.push(`<h4>${renderInlineMarkdown(trimmed.slice(4))}</h4>`);
      continue;
    }

    if (trimmed.startsWith("## ")) {
      flushParagraph(); flushList(); flushMeta();
      blocks.push(`<h3>${renderInlineMarkdown(trimmed.slice(3))}</h3>`);
      continue;
    }

    if (trimmed.startsWith("# ")) {
      flushParagraph(); flushList(); flushMeta();
      blocks.push(`<h2>${renderInlineMarkdown(trimmed.slice(2))}</h2>`);
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      flushParagraph();
      listItems.push(trimmed.replace(/^[-*]\s+/, ""));
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      flushParagraph();
      listItems.push(trimmed.replace(/^\d+\.\s+/, ""));
      continue;
    }

    paragraphLines.push(trimmed);
  }

  flushParagraph();
  flushList();
  flushMeta();

  return blocks.join("");
}

/* ─── PAGE PREVIEW ─── */

function openPagePreview(fileName) {
  const page = currentWikiPages.find((p) => p.name === fileName);
  if (!page) return;

  activePageName = fileName;
  contentTitle.textContent = fileName.replace(/\.md$/, "");
  contentBody.innerHTML = markdownToHtml(page.content);

  contentBody.querySelectorAll(".wiki-link").forEach((link) => {
    link.addEventListener("click", () => {
      const target = link.dataset.page.toLowerCase().replace(/\s+/g, "-") + ".md";
      openPagePreview(target);
    });
  });

  contentEmpty.classList.add("hidden");
  contentActive.classList.remove("hidden");
  highlightActiveInTree();
}

function highlightActiveInTree() {
  wikiFileTree.querySelectorAll("li").forEach((li) => {
    li.classList.toggle("active", li.dataset.page === activePageName);
  });
}

/* ─── FILE LIST RENDERING ─── */

function renderFileList(container, files, emptyMessage, fileGroup = null) {
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

    if (!fileGroup) {
      item.textContent = file;
      container.appendChild(item);
      continue;
    }

    item.className = "file-chip";
    const name = document.createElement("span");
    name.className = "file-name";
    name.textContent = file;

    const deleteButton = document.createElement("button");
    deleteButton.className = "file-delete-button";
    deleteButton.type = "button";
    deleteButton.textContent = "DEL";
    deleteButton.setAttribute("aria-label", `Delete ${file}`);
    deleteButton.addEventListener("click", async () => {
      await resumeCopilot.deleteFile(fileGroup, file);
      await refreshState();
    });

    item.append(name, deleteButton);
    container.appendChild(item);
  }
}

function renderWikiFileTree(pages) {
  wikiFileTree.innerHTML = "";

  if (pages.length === 0) {
    const item = document.createElement("li");
    item.className = "empty-chip";
    item.textContent = "No wiki pages yet";
    wikiFileTree.appendChild(item);
    return;
  }

  for (const page of pages) {
    const item = document.createElement("li");
    item.textContent = page.name.replace(/\.md$/, "");
    item.dataset.page = page.name;
    if (page.name === activePageName) item.classList.add("active");

    item.addEventListener("click", () => openPagePreview(page.name));
    wikiFileTree.appendChild(item);
  }
}

/* ─── STATUS ─── */

function formatStatusDate(isoString) {
  if (!isoString) return null;
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function updateGenerationStatus(state) {
  const wikiTime = formatStatusDate(state.lastWikiGeneratedAt);
  const resumeTime = formatStatusDate(state.lastResumeGeneratedAt);

  if (state.isWikiReady) {
    wikiStatusBadge.textContent = wikiTime ? `Ready · ${wikiTime}` : "Ready";
    wikiStatusBadge.dataset.state = "ready";
  } else if (state.lastSourceUpdateAt) {
    wikiStatusBadge.textContent = "Sources changed";
    wikiStatusBadge.dataset.state = "warning";
  } else {
    wikiStatusBadge.textContent = "Wiki not generated";
    wikiStatusBadge.dataset.state = "idle";
  }

  if (state.isWikiReady) {
    generateResumeButton.disabled = false;
    if (state.isResumeFresh) {
      resumeStatusBadge.textContent = resumeTime ? `Current · ${resumeTime}` : "Current";
      resumeStatusBadge.dataset.state = "ready";
    } else if (state.lastResumeGeneratedAt) {
      resumeStatusBadge.textContent = "Wiki changed";
      resumeStatusBadge.dataset.state = "warning";
    } else {
      resumeStatusBadge.textContent = "Ready to generate";
      resumeStatusBadge.dataset.state = "ready";
    }
  } else {
    generateResumeButton.disabled = true;
    resumeStatusBadge.textContent = "Generate wiki first";
    resumeStatusBadge.dataset.state = "idle";
  }
}

function updateAgentStatus(agentAvailable) {
  if (agentAvailable) {
    agentStatusIndicator.textContent = "Claude Code connected";
    agentStatusIndicator.dataset.state = "available";
  } else {
    agentStatusIndicator.textContent = "Heuristic mode";
    agentStatusIndicator.dataset.state = "unavailable";
  }
}

/* ─── REFRESH ─── */

async function refreshState() {
  const state = await resumeCopilot.getState();

  workflowModeInputs.forEach((input) => {
    input.checked = input.value === state.workflowMode;
  });

  updateGenerationStatus(state);
  updateAgentStatus(state.agentAvailable);
  renderFileList(rawList, state.rawFiles, "No raw files", "raw");
  renderFileList(originalResumeList, state.originalResumeFiles, "No resume uploaded", "originalResume");
  renderFileList(templateList, state.templateFiles, "No templates", "template");
  renderFileList(exportList, state.exportFiles, "No exports yet", "export");

  currentWikiPages = state.wikiPages || [];
  renderWikiFileTree(currentWikiPages);

  if (currentWikiPages.length > 0) {
    graphEmptyState.classList.add("hidden");
    if (!graph) {
      graph = new GraphEngine(graphCanvas);
    }
    graph.setData(currentWikiPages);
  } else {
    graphEmptyState.classList.remove("hidden");
  }

  if (activePageName) {
    const stillExists = currentWikiPages.some((p) => p.name === activePageName);
    if (stillExists) openPagePreview(activePageName);
  }
}

/* ─── FILE UPLOAD ─── */

async function serializeInputFiles(input) {
  return Promise.all(
    Array.from(input.files).map(async (file) => ({
      name: file.name,
      bytes: Array.from(new Uint8Array(await file.arrayBuffer()))
    }))
  );
}

/* ─── EVENT LISTENERS ─── */

workflowModeInputs.forEach((input) => {
  input.addEventListener("change", async () => {
    if (!input.checked) return;
    await resumeCopilot.setWorkflowMode(input.value);
  });
});

fileInput.addEventListener("change", async () => {
  const files = await serializeInputFiles(fileInput);
  await resumeCopilot.uploadFiles(files);
  fileInput.value = "";
  await refreshState();
});

originalResumeInput.addEventListener("change", async () => {
  const files = await serializeInputFiles(originalResumeInput);
  await resumeCopilot.uploadOriginalResumeFiles(files);
  originalResumeInput.value = "";
  await refreshState();
});

templateInput.addEventListener("change", async () => {
  const files = await serializeInputFiles(templateInput);
  await resumeCopilot.uploadTemplateFiles(files);
  templateInput.value = "";
  await refreshState();
});

generateWikiButton.addEventListener("click", async () => {
  generateWikiButton.disabled = true;
  wikiLoadingOverlay.classList.remove("hidden");
  try {
    const result = await resumeCopilot.generateWiki();
    await refreshState();
    if (result?.usedAgent) {
      wikiStatusBadge.textContent += " (AI)";
    }
  } finally {
    wikiLoadingOverlay.classList.add("hidden");
    generateWikiButton.disabled = false;
  }
});

generateResumeButton.addEventListener("click", async () => {
  if (generateResumeButton.disabled) return;
  generateResumeButton.disabled = true;
  resumeLoadingOverlay.classList.remove("hidden");
  try {
    const outputFormat = outputFormatInputs.find((input) => input.checked)?.value ?? "docx";
    const result = await resumeCopilot.generateResume({ outputFormat });
    await refreshState();
    if (result?.exportError) {
      resumeStatusBadge.textContent = "Export error";
      resumeStatusBadge.dataset.state = "warning";
    }
  } finally {
    resumeLoadingOverlay.classList.add("hidden");
    generateResumeButton.disabled = false;
  }
});

graphResetBtn.addEventListener("click", () => {
  if (graph) graph.reset();
});

/* ─── INIT ─── */

refreshState();
