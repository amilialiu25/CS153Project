const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("resumeCopilot", {
  getState: () => ipcRenderer.invoke("project:getState"),
  setWorkflowMode: (workflowMode) => ipcRenderer.invoke("project:setWorkflowMode", workflowMode),
  uploadFiles: (files) => ipcRenderer.invoke("raw:uploadFiles", files),
  uploadOriginalResumeFiles: (files) => ipcRenderer.invoke("resume:uploadOriginalFiles", files),
  generateWiki: () => ipcRenderer.invoke("wiki:generate"),
  generateResume: () => ipcRenderer.invoke("resume:generate")
});

