import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { GolfinhoAPI, Signal, UpdateStatus, YouTubeState } from "../shared/contracts";
const api: GolfinhoAPI = {
  getPathForFile(file) {
    return webUtils.getPathForFile(file);
  },
  async request(request) {
    const result = await ipcRenderer.invoke("golfinho:request", request);
    if (!result.ok) throw new Error(result.error);
    return result.value;
  },
  subscribe(listener) {
    const handler = (_event: unknown, signal: Signal) => listener(signal);
    ipcRenderer.on("golfinho:signal", handler);
    return () => ipcRenderer.removeListener("golfinho:signal", handler);
  },
  update: {
    status: () => ipcRenderer.invoke("golfinho:update:status"),
    check: () => ipcRenderer.invoke("golfinho:update:check"),
    download: () => ipcRenderer.invoke("golfinho:update:download"),
    install: () => ipcRenderer.invoke("golfinho:update:install"),
    subscribe(listener) {
      const handler = (_event: unknown, status: UpdateStatus) => listener(status);
      ipcRenderer.on("golfinho:update", handler);
      return () => ipcRenderer.removeListener("golfinho:update", handler);
    },
  },
  youtube: {
    show: (bounds) => ipcRenderer.invoke("golfinho:youtube:show", bounds),
    hide: () => ipcRenderer.invoke("golfinho:youtube:hide"),
    command: (command) => ipcRenderer.invoke("golfinho:youtube:command", command),
    subscribe(listener) {
      const handler = (_event: unknown, state: YouTubeState) => listener(state);
      ipcRenderer.on("golfinho:youtube", handler);
      return () => ipcRenderer.removeListener("golfinho:youtube", handler);
    },
  },
};
contextBridge.exposeInMainWorld("golfinho", api);
