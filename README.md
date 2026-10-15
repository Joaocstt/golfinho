# Golfinho

Ambiente desktop para organizar tarefas feitas por agentes de código (Codex, Claude
Code e Antigravity) dentro de repositórios Git. Cada tarefa roda em uma branch própria
e numa pasta isolada, com terminal interativo, revisão de diff, checks, histórico e
publicação no remoto, tudo em um só lugar.

- **Plataformas:** Linux, Windows e macOS (instaladores gerados pelo GitHub Actions).
- **Stack:** Electron, React, TypeScript, Monaco Editor, xterm.js, `node-pty` e SQLite
  nativo do Node.js.

## Sumário

- [Instalação para usuários](#instalação-para-usuários)
- [Desenvolvimento](#desenvolvimento)
- [Primeiros passos](#primeiros-passos)
- [Fluxo de uma tarefa](#fluxo-de-uma-tarefa)
- [Funcionalidades](#funcionalidades)
- [Agentes suportados](#agentes-suportados)
- [Segurança e limites](#segurança-e-limites)
- [Dados locais](#dados-locais)
- [Estrutura do código](#estrutura-do-código)
- [Testes e validação](#testes-e-validação)
- [Gerar instaladores e publicar uma versão](#gerar-instaladores-e-publicar-uma-versão)
- [Fora do escopo desta versão](#fora-do-escopo-desta-versão)
- [Referências](#referências)

## Instalação para usuários

Baixe os arquivos na página de [Releases](https://github.com/Joaocstt/golfinho/releases).

| Sistema | Arquivo | Como instalar |
| --- | --- | --- |
| Windows | `Golfinho Setup <versão>.exe` | Execute o instalador. Ele pode escolher outra pasta de instalação. |
| macOS | `Golfinho-<versão>.dmg` (Apple Silicon ou Intel) | Arraste o app para *Aplicativos*. |
| Linux (qualquer distribuição) | `Golfinho-<versão>.AppImage` | `chmod +x Golfinho-<versão>.AppImage` e execute. |
| Linux (Debian/Ubuntu) | `golfinho_<versão>_amd64.deb` | `sudo apt install ./golfinho_<versão>_amd64.deb` |

**Avisos de segurança do sistema:** os instaladores não são assinados digitalmente.

- **Windows:** o SmartScreen mostra "O Windows protegeu o computador". Clique em
  *Mais informações* e depois em *Executar mesmo assim*.
- **macOS:** o Gatekeeper pode bloquear o primeiro uso. Vá em *Ajustes do Sistema →
  Privacidade e Segurança* e clique em *Abrir mesmo assim*.
- **Linux:** o AppImage precisa de FUSE. No Ubuntu 24.04 e derivados, instale com
  `sudo apt install libfuse2t64` (em versões anteriores, `libfuse2`).

**Pré-requisitos no computador de uso:**

- **Git** instalado e no `PATH`.
- Os CLIs dos agentes que você pretende usar (`codex`, `claude` ou `agy`), já
  autenticados pelas próprias ferramentas. O Golfinho não pede nem armazena chaves de API.
- No Linux, um ambiente gráfico e o pacote de senhas do sistema (GNOME Keyring ou
  equivalente), usado para guardar senhas de servidores SSH.

## Desenvolvimento

**Requisitos:**

- Node.js **24.14** ou superior
- npm
- Git
- Ferramentas de compilação nativas, necessárias para `node-pty`:
  - Linux: `make` e `g++`
  - Windows: Visual Studio Build Tools com a carga de trabalho C++
  - macOS: Xcode Command Line Tools

**Executar em modo de desenvolvimento:**

```bash
git clone git@github.com:Joaocstt/golfinho.git
cd golfinho
npm ci
npm run dev
```

O `postinstall` baixa o Electron e recompila `node-pty` para a versão do runtime.
Se a instalação falhar nessa etapa, confira as ferramentas de compilação listadas acima.

**Build de produção (sem gerar instalador):**

```bash
npm run build
npm start
```

## Primeiros passos

1. Abra **Projetos → +** e selecione um repositório Git local. O repositório precisa
   ter pelo menos um commit e um remoto configurado.
2. Em **Configurações**, confirme os caminhos dos executáveis dos agentes. A
   disponibilidade mostra apenas que o executável existe; o login precisa estar válido
   na própria CLI.
3. Se o projeto precisar de preparação (por exemplo, `npm ci`), cadastre o comando em
   **Setup das pastas de trabalho**. Ele roda na pasta nova da tarefa, antes de o agente
   começar.
4. Pronto: crie a primeira tarefa.

## Fluxo de uma tarefa

1. **Criar a tarefa** com título, instrução, agente, base e remoto. A branch
   `golfinho/...` é sugerida automaticamente. A base precisa ser uma referência local
   existente; o Golfinho não faz `fetch` implícito.
2. **Colocar na fila.** O Golfinho cria a branch local e uma pasta própria para ela
   (um `git worktree`), roda o setup do projeto e inicia o CLI do agente no terminal
   da tarefa.
3. **Interagir no terminal** para responder perguntas, aprovar ações e dar instruções
   adicionais. Quando o agente pedir algo, a própria CLI mostra a solicitação.
4. **Revisar.** Ao encerrar o CLI, a tarefa vai para revisão. Você vê o diff, os
   arquivos alterados e pode abrir qualquer arquivo no editor.
5. **Executar checks.** Escolha os comandos que quiser (testes, lint, build). Nenhum
   check roda sozinho. Os resultados ficam registrados no histórico.
6. **Concluir tarefa.** Registra o seu aceite. Não faz merge. Os checks precisam estar
   aprovados para o conteúdo atual.
7. **Publicar branch no remoto.** Faz um push comum, sem `--force`. Faça commit das
   alterações antes: você pode pedir ao agente para commitar ou fazer isso no seu terminal.

> Saída zero do agente **não** significa que a tarefa está concluída. Ela só leva a
> tarefa para revisão.

**Excluir tarefa:** remove a pasta da tarefa e a branch. Se a pasta tiver alterações
não commitadas, a exclusão é recusada para que nenhum trabalho seja perdido. Arquivos
ignorados (como `node_modules`) são removidos junto com a pasta.

**Tarefas antigas:** tarefas criadas antes da mudança para worktrees continuam no
checkout do projeto, uma por vez. Use **Ativar branch** para voltar a elas.

## Funcionalidades

**Projetos e tarefas**
- Vários projetos e várias tarefas por projeto. Tarefas do mesmo repositório rodam em
  paralelo, cada uma na sua pasta.
- Limite global de execuções simultâneas (padrão: 2). Checks também contam para esse
  limite; o que passar do limite entra em fila.
- Prazo opcional por tarefa. Zero desativa o prazo.
- Marcação manual de "aguardando", útil para lembrar que a tarefa depende de você.

**Terminal**
- Terminal real (pseudoterminal) para cada CLI de agente, com copiar e colar, busca,
  redimensionamento e atalhos.
- **Shell avulso** na pasta da tarefa, sem o agente, sem fila e sem bloqueio.
- **Terminal geral** para operar fora de uma tarefa específica.

**Editor e arquivos**
- Árvore de arquivos e editor Monaco, com realce de sintaxe.
- Indicação de "arquivo não salvo" e salvamento direto no disco.
- Limite de 2 MiB por arquivo; links simbólicos e metadados `.git` não são editados.

**Git**
- Lista de branches e estado do repositório, atualizados periodicamente.
- Diff com até 200 caminhos. Arquivos binários e grandes aparecem sem comparação textual.
- Operações Git têm prazo de 30 segundos.

**Checks**
- Comandos configurados por você, executados na pasta da tarefa (prazo de 10 minutos).
- Resultados por execução, com os 30 mais recentes exibidos no histórico.

**Histórico**
- Eventos de cada tarefa (criação, filas, transições, checks, aceite, publicação).
  Os 200 eventos mais recentes são exibidos.

**Consumo dos planos**
- Painel com a cota de cada agente, obtida pela própria CLI. Os valores são
  atualizados sob demanda e, automaticamente, a cada minuto.

**Retomada de conversas**
- O Golfinho registra o ID da sessão do agente. Ao retomar uma tarefa, a conversa
  anterior é reaberta em vez de reenviar o prompt original.

**Servidores SSH (Remote)**
- Cadastro de conexões SSH nas configurações.
- Árvore de arquivos remota, visualização e edição de arquivos de até 512 KiB.
- Terminal SSH na conexão cadastrada.
- Senhas, quando usadas, ficam no cofre do sistema, via Electron `safeStorage`
  (libsecret/GNOME Keyring no Linux, Keychain no macOS, DPAPI no Windows). Nunca são
  gravadas em texto puro.

## Agentes suportados

| Agente | Executável | Como é iniciado | Permissões |
| --- | --- | --- | --- |
| Codex | `codex` | `--sandbox workspace-write --ask-for-approval on-request` | Sandbox de escrita no workspace; aprovações sob demanda. |
| Claude Code | `claude` | `--permission-mode manual` | Modo manual: cada ação pede confirmação. |
| Antigravity | `agy` | Preserva as configurações de aprovação do próprio CLI. | Definidas pelo CLI. |

Nenhuma flag que ignora permissões é usada. Os caminhos dos executáveis podem ser
ajustados na interface.

## Segurança e limites

- **Não há sandbox do Golfinho.** Branches isolam o histórico, mas não isolam o sistema
  de arquivos. Os agentes têm o acesso que as próprias CLIs concedem. Revise os diffs
  antes de publicar.
- **Credenciais:** o Golfinho usa as autenticações existentes das CLIs e não lê nem
  guarda chaves de API.
- **Publicação:** o push é sempre normal (sem `--force`). Nada é mesclado na branch base.
- **Exclusão:** nunca apaga alterações não commitadas sem recusar antes.
- **Editor:** arquivos grandes (acima de 2 MiB) não são abertos.

## Dados locais

- **Banco:** SQLite (`node:sqlite`) com projetos, tarefas, eventos, configurações e
  resultados de checks.
- **Logs de terminal:** limitados a uma cauda de cerca de 2 MiB em disco. A interface
  recebe até 512 mil caracteres.
- **Pasta de dados:**
  - Linux: `~/.config/golfinho/`
  - Windows: `%APPDATA%\golfinho\`
  - macOS: `~/Library/Application Support/golfinho/`
- **Pasta de dados alternativa:** defina a variável `GOLFINHO_DATA_DIR` para usar outro
  diretório, por exemplo em testes.
- **Pastas das tarefas:** criadas como `git worktree` dentro da pasta de dados, em
  `worktrees/<projeto>/<tarefa>`.

## Estrutura do código

```
src/
├── main/        # processo principal do Electron
│   ├── index.ts         janela, IPC e inicialização
│   ├── service.ts       roteia as requisições da interface
│   ├── coordinator.ts   fila, transições e execução das tarefas
│   ├── store.ts         persistência em SQLite
│   ├── git.ts           operações Git e worktrees
│   ├── checkout.ts      pasta ativa de cada tarefa
│   ├── agents.ts        executáveis e argumentos de cada agente
│   ├── pty.ts           pseudoterminais (node-pty)
│   ├── shells.ts        shells avulsos
│   ├── sessions.ts     leitura das sessões dos agentes para retomada
│   ├── quota.ts         consumo dos planos via CLI
│   ├── ssh.ts           conexões SSH
│   ├── vault.ts         cofre do sistema para senhas
│   ├── logs.ts          logs de terminal
│   └── schema.ts        validação das requisições (zod)
├── preload/     # ponte segura entre o main e a interface
├── renderer/    # interface React (App, editor, terminal, SSH)
└── shared/
    └── contracts.ts     tipos e contratos compartilhados
tests/           # testes com Vitest
scripts/         # smoke test
```

## Testes e validação

```bash
npm test              # testes unitários e de integração (Vitest)
npm run typecheck     # checagem de tipos (TypeScript)
npm run build         # build de produção
npm run smoke         # abre o Electron com um repositório temporário
```

- Os testes de Git usam repositórios temporários e um remoto `bare` local.
- O **smoke** percorre o fluxo completo com um executável de teste controlado: branch →
  terminal → diff → check → aceite → push local. Não envia prompts a serviços de IA.
  Grava uma captura em `out/smoke.png`.
- Autenticação e conversas reais dos agentes devem ser verificadas manualmente ao iniciar
  uma tarefa.

## Gerar instaladores e publicar uma versão

**Localmente**, para o sistema em que você está:

```bash
npm run dist          # todos os alvos configurados para o sistema atual
npm run dist:win      # Windows (.exe)
npm run dist:mac      # macOS (.dmg e .zip)
npm run dist:linux    # Linux (.AppImage e .deb)
```

Os arquivos saem em `release/`. Cada sistema operacional gera o próprio instalador:
para Windows e macOS, use o GitHub Actions (abaixo) ou uma máquina com o sistema correspondente.

**Publicar uma versão pelo GitHub Actions:**

1. Atualize a versão em `package.json`.
2. Crie e envie a tag:
   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```
3. O workflow [`release.yml`](.github/workflows/release.yml) roda os testes, gera os
   instaladores de Linux, Windows e macOS e cria uma release com todos os arquivos.
4. Também é possível disparar o workflow manualmente, pela aba *Actions*, sem criar a tag.
   Nesse caso, os instaladores ficam apenas como artefatos da execução.

## Fora do escopo desta versão

- Merge automático de branches e resolução de conflitos.
- Assinatura de código para Windows e macOS (os instaladores são distribuídos sem assinatura).
- Atualização automática do aplicativo.
- Navegador embutido, integração de voz, DAG de agentes e loja de extensões.
- Retomada automática de conversas após reiniciar o aplicativo: a retomada depende de
  uma ação do usuário.

## Referências

- [Electron — IPC](https://www.electronjs.org/docs/latest/tutorial/ipc)
- [Monaco Editor](https://github.com/microsoft/monaco-editor)
- [Antigravity CLI](https://antigravity.google/docs/cli/headless/)
- [electron-builder](https://www.electron.build/)

## Licença

Licença ainda não definida.
