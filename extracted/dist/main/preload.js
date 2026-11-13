"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main/preload.ts
var preload_exports = {};
module.exports = __toCommonJS(preload_exports);
var import_electron = require("electron");
var api = {
  closeWindow: () => import_electron.ipcRenderer.send("window:close"),
  setWindowSize: (w, h) => import_electron.ipcRenderer.send("window:set-size", w, h),
  setWindowOpacity: (opacity) => import_electron.ipcRenderer.send("window:set-opacity", opacity),
  getWindowBounds: () => import_electron.ipcRenderer.invoke("window:get-bounds"),
  setWindowBounds: (x, y, w, h) => import_electron.ipcRenderer.send("window:set-bounds", x, y, w, h),
  animateWindowBounds: (x, y, w, h, durationMs) => new Promise((resolve) => {
    import_electron.ipcRenderer.once("window:animate-bounds-done", () => resolve());
    import_electron.ipcRenderer.send("window:animate-bounds", x, y, w, h, durationMs ?? 300);
  }),
  openTextFile: () => import_electron.ipcRenderer.invoke("dialog:open-text-file"),
  importDocument: (filePath) => import_electron.ipcRenderer.invoke("dialog:import-document", filePath),
  getVoskModelPath: () => import_electron.ipcRenderer.invoke("vosk:model-path"),
  listVoskModels: () => import_electron.ipcRenderer.invoke("vosk:list-models"),
  resolveVoskModel: (modelId) => import_electron.ipcRenderer.invoke("vosk:resolve-model", modelId),
  downloadVoskModel: (modelId) => import_electron.ipcRenderer.invoke("vosk:download-model", modelId),
  deleteVoskModel: (modelId) => import_electron.ipcRenderer.invoke("vosk:delete-model", modelId),
  /** Voice following for CTC models (Arabic). Main resolves the model by id; only text comes back. */
  ctcSpeech: {
    load: (modelId) => import_electron.ipcRenderer.invoke("speech-ctc:load", modelId),
    pushAudio: (samples, speaking) => import_electron.ipcRenderer.send("speech-ctc:audio", samples, speaking),
    reset: () => import_electron.ipcRenderer.send("speech-ctc:reset"),
    unload: () => import_electron.ipcRenderer.send("speech-ctc:unload"),
    onText: (cb) => {
      const handler = (_e, result) => cb(result);
      import_electron.ipcRenderer.on("speech-ctc:text", handler);
      return () => {
        import_electron.ipcRenderer.removeListener("speech-ctc:text", handler);
      };
    }
  },
  onVoskDownloadProgress: (cb) => {
    const handler = (_e, progress) => cb(progress);
    import_electron.ipcRenderer.on("vosk:download-progress", handler);
    return () => {
      import_electron.ipcRenderer.removeListener("vosk:download-progress", handler);
    };
  },
  // Menu popup
  openMenu: (btnScreenX, btnScreenY, btnW, btnH, isNarrow) => import_electron.ipcRenderer.send("menu:open", btnScreenX, btnScreenY, btnW, btnH, isNarrow),
  closeMenu: () => import_electron.ipcRenderer.send("menu:close"),
  onMenuClosed: (cb) => {
    import_electron.ipcRenderer.on("menu:closed", cb);
    return () => {
      import_electron.ipcRenderer.removeListener("menu:closed", cb);
    };
  },
  // Menu settings bridge (main window listens, menu window sends)
  sendMenuSetting: (key, value) => import_electron.ipcRenderer.send("menu:setting", key, value),
  onMenuSetting: (cb) => {
    const handler = (_e, key, value) => cb(key, value);
    import_electron.ipcRenderer.on("menu:setting", handler);
    return () => {
      import_electron.ipcRenderer.removeListener("menu:setting", handler);
    };
  },
  // Menu state sync
  trackUsage: (event, properties) => import_electron.ipcRenderer.send("usage:event", event, properties),
  getHintsEnabled: () => import_electron.ipcRenderer.invoke("usage:hints-enabled"),
  getMenuState: () => import_electron.ipcRenderer.invoke("menu:get-state"),
  // Sticky notes (from main window)
  createNote: () => import_electron.ipcRenderer.send("note:create"),
  closeAllNotes: () => import_electron.ipcRenderer.send("note:close-all"),
  openNotesContextMenu: (hasNotes) => import_electron.ipcRenderer.send("note:context-menu", hasNotes),
  openMicContextMenu: (devices, selectedId) => import_electron.ipcRenderer.invoke("mic:context-menu", devices, selectedId),
  onNoteCountChanged: (cb) => {
    const handler = (_e, count) => cb(count);
    import_electron.ipcRenderer.on("note:count-changed", handler);
    return () => {
      import_electron.ipcRenderer.removeListener("note:count-changed", handler);
    };
  },
  onMicToggleShortcut: (cb) => {
    const handler = () => cb();
    import_electron.ipcRenderer.on("mic:toggle-shortcut", handler);
    return () => {
      import_electron.ipcRenderer.removeListener("mic:toggle-shortcut", handler);
    };
  },
  // Sticky notes (from note window)
  getNoteState: () => import_electron.ipcRenderer.invoke("note:get-state"),
  updateNoteContent: (content) => import_electron.ipcRenderer.send("note:update-content", content),
  closeNote: () => import_electron.ipcRenderer.send("note:close"),
  onNoteHydrated: (cb) => {
    const handler = (_e, state) => cb(state);
    import_electron.ipcRenderer.on("note:hydrate", handler);
    return () => {
      import_electron.ipcRenderer.removeListener("note:hydrate", handler);
    };
  },
  onNoteThemeUpdate: (cb) => {
    const handler = (_e, theme) => cb(theme);
    import_electron.ipcRenderer.on("note:theme-update", handler);
    return () => {
      import_electron.ipcRenderer.removeListener("note:theme-update", handler);
    };
  },
  onNoteTypographyUpdate: (cb) => {
    const handler = (_e, payload) => cb(payload);
    import_electron.ipcRenderer.on("note:typography-update", handler);
    return () => {
      import_electron.ipcRenderer.removeListener("note:typography-update", handler);
    };
  },
  // App state persistence
  saveState: (state) => import_electron.ipcRenderer.send("store:save", state),
  loadState: () => import_electron.ipcRenderer.invoke("store:load"),
  // Shell
  openExternal: (url) => import_electron.ipcRenderer.send("shell:open-external", url),
  // Help dialog
  openHelp: () => import_electron.ipcRenderer.send("help:open"),
  closeHelp: () => import_electron.ipcRenderer.send("help:close"),
  getHelpState: () => import_electron.ipcRenderer.invoke("help:get-state"),
  consumePurchaseThanks: () => import_electron.ipcRenderer.invoke("help:consume-purchase-thanks"),
  // Licensing / Activation
  getLicenseStatus: () => import_electron.ipcRenderer.invoke("license:status"),
  openActivation: () => import_electron.ipcRenderer.send("activation:open"),
  closeActivation: () => import_electron.ipcRenderer.send("activation:close"),
  fitActivationWindow: (contentHeight) => import_electron.ipcRenderer.send("activation:fit-bounds", contentHeight),
  getActivationState: () => import_electron.ipcRenderer.invoke("activation:get-state"),
  activateKey: (key) => import_electron.ipcRenderer.send("activation:activate", key),
  onActivationResult: (cb) => {
    const handler = (_e, ok, err) => cb(ok, err);
    import_electron.ipcRenderer.on("activation:result", handler);
    return () => {
      import_electron.ipcRenderer.removeListener("activation:result", handler);
    };
  },
  onLicenseActivated: (cb) => {
    import_electron.ipcRenderer.on("license:activated", cb);
    return () => {
      import_electron.ipcRenderer.removeListener("license:activated", cb);
    };
  },
  onTrialExpired: (cb) => {
    import_electron.ipcRenderer.on("trial:expired", cb);
    return () => {
      import_electron.ipcRenderer.removeListener("trial:expired", cb);
    };
  },
  // Required first-launch question
  getQuestionState: () => import_electron.ipcRenderer.invoke("question:get-state"),
  fitQuestionWindow: (contentHeight) => import_electron.ipcRenderer.send("question:fit-bounds", contentHeight),
  answerUseCase: (value) => import_electron.ipcRenderer.invoke("question:answer", value),
  onQuestionAnswered: (cb) => {
    import_electron.ipcRenderer.on("question:answered", cb);
    return () => {
      import_electron.ipcRenderer.removeListener("question:answered", cb);
    };
  },
  setScrollActive: (active) => import_electron.ipcRenderer.send("trial:scroll-state", active === true),
  // Update check
  checkForUpdates: () => import_electron.ipcRenderer.invoke("update:check"),
  onUpdateEvent: (cb) => {
    const handler = (_e, info) => cb(info);
    import_electron.ipcRenderer.on("update:event", handler);
    return () => {
      import_electron.ipcRenderer.removeListener("update:event", handler);
    };
  },
  installUpdate: () => import_electron.ipcRenderer.invoke("update:install"),
  downloadUpdate: () => import_electron.ipcRenderer.invoke("update:download"),
  onReleaseNotesShow: (cb) => {
    const handler = (_e, payload) => cb(payload);
    import_electron.ipcRenderer.on("update:release-notes", handler);
    return () => {
      import_electron.ipcRenderer.removeListener("update:release-notes", handler);
    };
  },
  dismissReleaseNotes: (version) => import_electron.ipcRenderer.invoke("update:dismiss-release-notes", version),
  onMessageAvailable: (cb) => {
    const handler = (_e, message) => cb(message);
    import_electron.ipcRenderer.on("message:available", handler);
    return () => {
      import_electron.ipcRenderer.removeListener("message:available", handler);
    };
  }
};
import_electron.contextBridge.exposeInMainWorld("notchAPI", api);
