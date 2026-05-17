const { app, BrowserWindow, ipcMain } = require("electron");
const fs = require("fs/promises");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const rawDir = path.join(projectRoot, "raw");
const wikiDir = path.join(projectRoot, "wiki");
const draftDir = path.join(projectRoot, "ai-resume", "drafts");

async function ensureProjectDirs() {
  await Promise.all([
    fs.mkdir(rawDir, { recursive: true }),
    fs.mkdir(wikiDir, { recursive: true }),
    fs.mkdir(draftDir, { recursive: true })
  ]);
}

async function readMarkdownFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name)
    .sort();

  return Promise.all(
    files.map(async (name) => ({
      name,
      content: await fs.readFile(path.join(dir, name), "utf8")
    }))
  );
}

async function listRawFiles() {
  const entries = await fs.readdir(rawDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name !== ".DS_Store")
    .map((entry) => entry.name)
    .sort();
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
  const [rawFiles, wikiPages, resumeDrafts] = await Promise.all([
    listRawFiles(),
    readMarkdownFiles(wikiDir),
    readMarkdownFiles(draftDir)
  ]);

  return { rawFiles, wikiPages, resumeDrafts };
});

ipcMain.handle("raw:uploadFiles", async (_event, files) => {
  await ensureProjectDirs();

  for (const file of files) {
    const safeName = path.basename(file.name);
    const destination = path.join(rawDir, safeName);
    await fs.writeFile(destination, Buffer.from(file.bytes));
  }

  return listRawFiles();
});

ipcMain.handle("wiki:generate", async () => {
  await ensureProjectDirs();
  const rawFiles = await listRawFiles();
  const generatedAt = new Date().toISOString();
  const content = [
    "# Generated Wiki Snapshot",
    "",
    `Generated at: ${generatedAt}`,
    "",
    "## Raw Sources",
    "",
    ...rawFiles.map((file) => `- ${file}`),
    "",
    "## Notes",
    "",
    "This is a placeholder wiki snapshot. Future agent logic should read the raw",
    "files, extract grounded facts, and update the structured wiki pages."
  ].join("\n");

  await fs.writeFile(path.join(wikiDir, "generated-snapshot.md"), content, "utf8");
  return readMarkdownFiles(wikiDir);
});

ipcMain.handle("resume:generate", async () => {
  await ensureProjectDirs();
  const wikiPages = await readMarkdownFiles(wikiDir);
  const generatedAt = new Date().toISOString();
  const content = [
    "# Resume Draft",
    "",
    `Generated at: ${generatedAt}`,
    "",
    "## Source Wiki Pages",
    "",
    ...wikiPages.map((page) => `- ${page.name}`),
    "",
    "## Draft",
    "",
    "Resume generation is currently a placeholder. Future logic should create a",
    "targeted resume from the user's structured wiki."
  ].join("\n");

  await fs.writeFile(path.join(draftDir, "resume-draft.md"), content, "utf8");
  return readMarkdownFiles(draftDir);
});

