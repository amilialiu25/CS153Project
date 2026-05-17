const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("resumeCopilot", {
  getState: () => ipcRenderer.invoke("project:getState"),
  uploadFiles: (files) => ipcRenderer.invoke("raw:uploadFiles", files),
  generateWiki: () => ipcRenderer.invoke("wiki:generate"),
  generateResume: () => ipcRenderer.invoke("resume:generate")
});

