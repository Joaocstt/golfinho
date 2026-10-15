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
