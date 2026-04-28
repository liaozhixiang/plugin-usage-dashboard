"use strict";

const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");

let allowedFolder = null;

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: "NX Plugin Usage Dashboard",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  win.loadFile("index.html");
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

ipcMain.handle("dialog:selectFolder", async () => {
  const result = await dialog.showOpenDialog({
    title: "选择数据文件夹",
    properties: ["openDirectory"],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const folderPath = result.filePaths[0];
  let entries;
  try {
    entries = fs.readdirSync(folderPath);
  } catch {
    return null;
  }

  allowedFolder = folderPath;

  const txtFiles = entries
    .filter((name) => name.toLowerCase().endsWith(".txt"))
    .map((name) => ({ name, filePath: path.join(folderPath, name) }));

  return txtFiles;
});

ipcMain.handle("fs:readFile", async (_event, filePath) => {
  if (!allowedFolder) {
    throw new Error("No folder selected");
  }
  const resolved = path.resolve(filePath);
  const allowedResolved = path.resolve(allowedFolder);
  const relative = path.relative(allowedResolved, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Access denied: file is outside the selected folder");
  }
  return fs.readFileSync(resolved, "utf-8");
});
