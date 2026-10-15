import { contextBridge, ipcRenderer } from "electron";
import type { GolfinhoAPI, Signal } from "../shared/contracts";
const api: GolfinhoAPI = {
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
};
contextBridge.exposeInMainWorld("golfinho", api);
