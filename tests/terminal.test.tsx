// @vitest-environment jsdom
import React from 'react';
import {render,screen,fireEvent,waitFor,act,cleanup} from '@testing-library/react';
import {vi,it,expect,beforeEach,afterEach} from 'vitest';
import type {Signal,Request,Response} from '../src/shared/contracts';
const mock=vi.hoisted(()=>({instances:[] as any[],searches:[] as any[]}));
vi.mock('@xterm/xterm',()=>({Terminal:class{
 options:any;unicode={activeVersion:'6'};cols=80;rows=24;buffer={active:{viewportY:100,baseY:100}};selection='seleção';data=(_s:string)=>{};scroll=(_n:number)=>{};selectionChange=()=>{};key=(_e:KeyboardEvent)=>true;
 write=vi.fn((_s:string,callback?:()=>void)=>callback?.());paste=vi.fn((text:string)=>this.data(text));clear=vi.fn();selectAll=vi.fn();select=vi.fn();dispose=vi.fn();focus=vi.fn();
 scrollToBottom=vi.fn(()=>{this.buffer.active.viewportY=this.buffer.active.baseY;this.scroll(this.buffer.active.viewportY);});scrollToLine=vi.fn((line:number)=>{this.buffer.active.viewportY=line;this.scroll(line);});reset=vi.fn(()=>{});
 constructor(options:any){this.options=options;mock.instances.push(this);}loadAddon(){}open(){}hasSelection(){return !!this.selection;}onData(fn:any){this.data=fn;return {dispose:vi.fn()};}onScroll(fn:any){this.scroll=fn;return {dispose:vi.fn()};}onSelectionChange(fn:any){this.selectionChange=fn;return {dispose:vi.fn()};}getSelection(){return this.selection;}getSelectionPosition(){return undefined;}attachCustomKeyEventHandler(fn:any){this.key=fn;}
}}));
vi.mock('@xterm/addon-fit',()=>({FitAddon:class{fit=vi.fn();}}));
vi.mock('@xterm/addon-web-links',()=>({WebLinksAddon:class{constructor(_h:any){}}}));
vi.mock('@xterm/addon-unicode11',()=>({Unicode11Addon:class{}}));
vi.mock('@xterm/addon-search',()=>({SearchAddon:class{result=(_r:any)=>{};findNext=vi.fn(()=>{this.result({resultIndex:0,resultCount:3});return true;});findPrevious=vi.fn(()=>true);clearDecorations=vi.fn();clearActiveDecoration=vi.fn();dispose=vi.fn();constructor(){mock.searches.push(this);}onDidChangeResults(fn:any){this.result=fn;return {dispose:vi.fn()};}}}));
import {TerminalPane} from '../src/renderer/TerminalPane';
import {ShellPane} from '../src/renderer/ShellPane';
let signal:(s:Signal)=>void;let request:ReturnType<typeof vi.fn<(r:Request)=>Promise<Response>>>;const props={taskId:'terminal-default',active:true,provider:'codex',status:'running',onError:vi.fn()};
const openMenu=()=>fireEvent.click(screen.getByRole('button',{name:'Mais ações do terminal'}));
const menuItem=(name:string)=>{openMenu();return screen.getByRole('button',{name});};
beforeEach(()=>{mock.instances.length=0;mock.searches.length=0;localStorage.clear();vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});request=vi.fn(async(r:Request)=>r.action==='terminal'?{data:'histórico',nextOffset:9}:(r as any).action==='readClipboard'?'conteúdo colado':null);window.golfinho={request,getPathForFile:()=>'',update:{status:async()=>({state:'unsupported'}),check:async()=>{},download:async()=>{},install:async()=>{},subscribe:()=>()=>{}},youtube:{show:async()=>{},hide:async()=>{},command:async()=>{},subscribe:()=>()=>{}},subscribe:fn=>{signal=fn;return()=>{};}};});
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.clearAllMocks();});
const terminal=()=>mock.instances.at(-1);const search=()=>mock.searches.at(-1);
it('leva o foco para a CLI quando a fila termina de preparar o terminal',async()=>{
 const rendered=render(<TerminalPane {...props} active={false}/>);
 await waitFor(()=>expect(terminal().write).toHaveBeenCalledWith('histórico',expect.any(Function)));
 const existing=terminal();
 expect(existing.focus).not.toHaveBeenCalled();
 rendered.rerender(<TerminalPane {...props} active={true}/>);
 expect(existing.focus).toHaveBeenCalledTimes(1);
 expect(existing.options.disableStdin).toBe(false);
 act(()=>existing.data('comando\r'));
 await waitFor(()=>expect(request).toHaveBeenCalledWith({action:'input',taskId:props.taskId,data:'comando\r'}));
 rendered.rerender(<TerminalPane {...props} active={true} onError={vi.fn()}/>);
 expect(existing.focus).toHaveBeenCalledTimes(1);
});
it('não rouba o foco quando uma tarefa em segundo plano fica pronta',async()=>{
 const rendered=render(<TerminalPane {...props} active={false} autoFocus={false}/>);
 rendered.rerender(<TerminalPane {...props} active={true} autoFocus={false}/>);
 expect(terminal().focus).not.toHaveBeenCalled();
 expect(terminal().options.disableStdin).toBe(false);
});
it('não rouba o foco se o shell terminar de abrir depois de trocar de tarefa',async()=>{
 let finish!:(id:string)=>void;
 const start=new Promise<string>(resolve=>{finish=resolve;});
 const open=()=>start;
 const rendered=render(<ShellPane scopeKey="delayed-focus" openSession={open} onError={vi.fn()} autoFocus={true}/>);
 rendered.rerender(<ShellPane scopeKey="delayed-focus" openSession={open} onError={vi.fn()} autoFocus={false}/>);
 await act(async()=>{finish('shell-delayed');await start;});
 expect(terminal().focus).not.toHaveBeenCalled();
});
it('confirma entrada somente após o envio e não repete o foco de um pedido antigo',async()=>{
 const sent=vi.fn();
 const rendered=render(<TerminalPane {...props} onInput={sent} focusRequest={0}/>);
 await act(async()=>{terminal().data('\r');});
 expect(sent).toHaveBeenCalledWith('\r');
 rendered.rerender(<TerminalPane {...props} onInput={sent} focusRequest={1}/>);
 const count=terminal().focus.mock.calls.length;
 rendered.rerender(<TerminalPane {...props} onInput={sent} focusRequest={1} autoFocus={false}/>);
 rendered.rerender(<TerminalPane {...props} onInput={sent} focusRequest={1} autoFocus={true}/>);
 expect(terminal().focus).toHaveBeenCalledTimes(count);
 request.mockRejectedValueOnce(new Error('input failed'));
 await act(async()=>{terminal().data('n\r');});
 expect(sent).not.toHaveBeenCalledWith('n\r');
});
it('busca texto com resultados e navegação, Escape fecha',async()=>{render(<TerminalPane {...props}/>);fireEvent.click(screen.getByRole('button',{name:'Buscar no terminal'}));fireEvent.change(screen.getByRole('searchbox',{name:'Texto no terminal'}),{target:{value:'login'}});await waitFor(()=>expect(search().findNext).toHaveBeenCalledWith('login',expect.any(Object)));expect(screen.getByRole('status').textContent).toContain('1 de 3');fireEvent.click(screen.getByRole('button',{name:'Resultado anterior'}));expect(search().findPrevious).toHaveBeenCalled();fireEvent.keyDown(screen.getByRole('searchbox'),{key:'Escape'});expect(screen.queryByRole('searchbox')).toBeNull();});
it('zoom persiste, limita 10–22 e restaura 14',async()=>{const rendered=render(<TerminalPane {...props}/>);openMenu();for(let i=0;i<20;i++)fireEvent.click(screen.getByRole('button',{name:'Aumentar fonte do terminal'}));expect(terminal().options.fontSize).toBe(22);expect(localStorage.getItem('golfinho.terminal.fontSize')).toBe('22');rendered.unmount();render(<TerminalPane {...props} taskId="zoom-other"/>);expect(terminal().options.fontSize).toBe(22);openMenu();for(let i=0;i<20;i++)fireEvent.click(screen.getByRole('button',{name:'Diminuir fonte do terminal'}));expect(terminal().options.fontSize).toBe(10);fireEvent.click(screen.getByRole('button',{name:'Restaurar tamanho da fonte'}));expect(terminal().options.fontSize).toBe(14);});
it('menu reúne as ações secundárias e fecha ao escolher ou com Escape',async()=>{render(<TerminalPane {...props}/>);const menu=screen.getByRole('button',{name:'Mais ações do terminal'});expect(menu.getAttribute('aria-expanded')).toBe('false');expect(screen.queryByRole('button',{name:'Limpar somente a tela'})).toBeNull();const popover=()=>screen.queryByRole('group',{name:'Ações do terminal'});openMenu();expect(popover()).toBeTruthy();fireEvent.keyDown(popover()!,{key:'Escape'});expect(popover()).toBeNull();openMenu();fireEvent.click(screen.getByRole('button',{name:'Selecionar tudo no terminal'}));expect(popover()).toBeNull();openMenu();fireEvent.pointerDown(document.body);expect(popover()).toBeNull();});
it('clipboard usa seleção e paste sem Enter, limpa só tela',async()=>{render(<TerminalPane {...props}/>);fireEvent.click(menuItem('Copiar seleção'));await waitFor(()=>expect(request).toHaveBeenCalledWith({action:'writeClipboard',text:'seleção'}));fireEvent.click(menuItem('Selecionar tudo no terminal'));expect(terminal().selectAll).toHaveBeenCalled();fireEvent.click(menuItem('Colar no terminal'));await waitFor(()=>expect(terminal().paste).toHaveBeenCalledWith('conteúdo colado'));expect(request).toHaveBeenCalledWith({action:'input',taskId:props.taskId,data:'conteúdo colado'});fireEvent.click(menuItem('Limpar somente a tela'));expect(terminal().clear).toHaveBeenCalled();expect(request).not.toHaveBeenCalledWith(expect.objectContaining({action:'clear'}));});
it('histórico bloqueia paste/input e prontidão atualiza sem recriar/replay',async()=>{const rendered=render(<TerminalPane {...props} active={false}/>);await waitFor(()=>expect(terminal().write).toHaveBeenCalledWith('histórico',expect.any(Function)));const existing=terminal();act(()=>existing.data('texto'));expect(request).not.toHaveBeenCalledWith(expect.objectContaining({action:'input'}));expect(menuItem('Colar no terminal')).toHaveProperty('disabled',true);expect(existing.options.disableStdin).toBe(true);rendered.rerender(<TerminalPane {...props} active={true}/>);expect(terminal()).toBe(existing);expect(request.mock.calls.filter(([r])=>r.action==='terminal')).toHaveLength(1);expect(existing.options.disableStdin).toBe(false);act(()=>existing.data('resposta'));await waitFor(()=>expect(request).toHaveBeenCalledWith({action:'input',taskId:props.taskId,data:'resposta'}));});
it('atalhos da interface não interceptam Ctrl+C da CLI sem seleção; com seleção, Ctrl+C copia',async()=>{render(<TerminalPane {...props}/>);terminal().selection='';expect(terminal().key(new KeyboardEvent('keydown',{key:'c',ctrlKey:true}))).toBe(true);terminal().selection='texto';expect(terminal().key(new KeyboardEvent('keydown',{key:'c',ctrlKey:true,cancelable:true}))).toBe(false);await waitFor(()=>expect(request).toHaveBeenCalledWith({action:'writeClipboard',text:'texto'}));terminal().selection='seleção';expect(terminal().key(new KeyboardEvent('keydown',{key:'f',ctrlKey:true,shiftKey:true,cancelable:true}))).toBe(false);expect(await screen.findByRole('searchbox')).toBeTruthy();act(()=>terminal().key(new KeyboardEvent('keydown',{key:'+',ctrlKey:true,cancelable:true})));expect(terminal().options.fontSize).toBe(15);});
it('Ctrl+Shift+V cola o caminho da imagem da área de transferência na CLI', async () => {
 request.mockImplementation(async (r: Request) => {
   if (r.action === 'terminal') return { data: 'histórico', nextOffset: 9 };
   if (r.action === 'readClipboard') return '';
   if (r.action === 'pasteImage') return '/dados/clipboard/imagem.png';
   return null;
 });
 render(<TerminalPane {...props}/>);
 expect(terminal().key(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, shiftKey: true, cancelable: true }))).toBe(false);
 await waitFor(() => expect(terminal().paste).toHaveBeenCalledWith('/dados/clipboard/imagem.png '));
 expect(request).toHaveBeenCalledWith({ action: 'pasteImage' });
});
it('saída mantém viewport antigo e voltar ao fim é explícito, restaura por tarefa',async()=>{const rendered=render(<TerminalPane {...props} taskId="scroll-task"/>);await waitFor(()=>expect(terminal().write).toHaveBeenCalled());act(()=>{terminal().buffer.active.viewportY=25;terminal().scroll(25);});act(()=>signal({kind:'terminal',taskId:'scroll-task',data:'novo',offset:9}));expect(terminal().scrollToLine).toHaveBeenCalledWith(25);expect(screen.getByRole('button',{name:'Voltar ao fim do terminal'})).toBeTruthy();rendered.unmount();render(<TerminalPane {...props} taskId="scroll-task"/>);await waitFor(()=>expect(terminal().scrollToLine).toHaveBeenCalledWith(25));fireEvent.click(screen.getByRole('button',{name:'Voltar ao fim do terminal'}));expect(terminal().scrollToBottom).toHaveBeenCalled();expect(screen.queryByRole('button',{name:'Voltar ao fim do terminal'})).toBeNull();});
