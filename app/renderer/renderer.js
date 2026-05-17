const fileInput = document.querySelector("#fileInput");
const rawList = document.querySelector("#rawList");
const wikiPreview = document.querySelector("#wikiPreview");
const resumePreview = document.querySelector("#resumePreview");
const generateWikiButton = document.querySelector("#generateWikiButton");
const generateResumeButton = document.querySelector("#generateResumeButton");

function renderFileList(files) {
  rawList.innerHTML = "";

  if (files.length === 0) {
    rawList.innerHTML = "<li>No raw files uploaded yet.</li>";
    return;
  }

  for (const file of files) {
    const item = document.createElement("li");
    item.textContent = file;
    rawList.appendChild(item);
  }
}

function renderMarkdownPreview(container, pages, emptyText) {
  container.innerHTML = "";

  if (pages.length === 0) {
    container.textContent = emptyText;
    return;
  }

  for (const page of pages) {
    const article = document.createElement("article");
    const title = document.createElement("h3");
    const body = document.createElement("pre");

    title.textContent = page.name;
    body.textContent = page.content;
    article.append(title, body);
    container.appendChild(article);
  }
}

async function refreshState() {
  const state = await window.resumeCopilot.getState();
  renderFileList(state.rawFiles);
  renderMarkdownPreview(wikiPreview, state.wikiPages, "No wiki pages yet.");
  renderMarkdownPreview(resumePreview, state.resumeDrafts, "No resume drafts yet.");
}

fileInput.addEventListener("change", async () => {
  const files = await Promise.all(
    Array.from(fileInput.files).map(async (file) => ({
      name: file.name,
      bytes: Array.from(new Uint8Array(await file.arrayBuffer()))
    }))
  );

  await window.resumeCopilot.uploadFiles(files);
  fileInput.value = "";
  await refreshState();
});

generateWikiButton.addEventListener("click", async () => {
  const pages = await window.resumeCopilot.generateWiki();
  renderMarkdownPreview(wikiPreview, pages, "No wiki pages yet.");
});

generateResumeButton.addEventListener("click", async () => {
  const drafts = await window.resumeCopilot.generateResume();
  renderMarkdownPreview(resumePreview, drafts, "No resume drafts yet.");
});

refreshState();

