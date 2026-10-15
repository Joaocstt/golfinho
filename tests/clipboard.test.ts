import { it, expect } from "vitest";
import { Service } from "../src/main/service";
import { Store } from "../src/main/store";
import type { GitService } from "../src/main/git";
import type { Coordinator } from "../src/main/coordinator";
it("reads and writes explicit clipboard text and rejects oversized pastes", async()=>{
 let clipboard="";const store=new Store(":memory:");
 const service=new Service(store, {} as GitService, {} as Coordinator, {append(){},replay(){return{data:"",nextOffset:0};},remove(){}}, ()=>{},async()=>null,{read:()=>clipboard,write:text=>{clipboard=text;}});
 await service.request({action:"writeClipboard",text:"texto escolhido"});
 expect(await service.request({action:"readClipboard"})).toBe("texto escolhido");
 clipboard="é".repeat(40000);await expect(service.request({action:"readClipboard"})).rejects.toThrow(/64 KiB/);
 await expect(service.request({action:"writeClipboard",text:"é".repeat(2*1024*1024)})).rejects.toThrow(/2 MiB/);
 store.close();
});
it("cola uma imagem da área de transferência como caminho do arquivo salvo", async () => {
  const store = new Store(":memory:");
  const service = new Service(store, {} as GitService, {} as Coordinator, {append(){},replay(){return{data:"",nextOffset:0};},remove(){}}, ()=>{}, async()=>null, {
    read: () => "",
    write: () => {},
    image: async () => Buffer.from("png"),
    saveImage: async (png) => `/dados/clipboard/x-${png.length}.png`,
  });
  expect(await service.request({ action: "pasteImage" } as never)).toBe("/dados/clipboard/x-3.png");
  store.close();
});
it("sem imagem na área de transferência, pasteImage não devolve caminho", async () => {
  const store = new Store(":memory:");
  const service = new Service(store, {} as GitService, {} as Coordinator, {append(){},replay(){return{data:"",nextOffset:0};},remove(){}}, ()=>{}, async()=>null, {
    read: () => "",
    write: () => {},
    image: async () => null,
    saveImage: async () => "nunca",
  });
  expect(await service.request({ action: "pasteImage" } as never)).toBeNull();
  store.close();
});
