# Golfinho

<img src="build/icon.png" alt="Logo do Golfinho" width="96" />

Ambiente desktop para organizar tarefas feitas por agentes de código (Codex, Claude
Code e Antigravity) dentro de repositórios Git. Reúne terminal interativo, chat,
editor de arquivos, revisão de diff, checks, histórico e publicação de branches.

As tarefas novas trabalham na pasta do projeto, na branch escolhida ou criada para
a tarefa. A fila executa uma tarefa por vez em cada pasta de projeto; projetos
diferentes podem executar em paralelo. Tarefas antigas com `git worktree` continuam
usando suas pastas próprias.

- **Plataformas:** Linux, Windows e macOS (instaladores gerados pelo GitHub Actions).
- **Stack:** Electron, React, TypeScript, Monaco Editor, xterm.js, `node-pty` e SQLite
  nativo do Node.js.

## Sumário

- [Instalação para usuários](#instalação-para-usuários)
- [Desenvolvimento](#desenvolvimento)
- [Primeiros passos](#primeiros-passos)
- [Fluxo de uma tarefa](#fluxo-de-uma-tarefa)
- [Funcionalidades](#funcionalidades)
- [Terminal e chat](#terminal-e-chat)
- [Memória do projeto](#memória-do-projeto)
- [Agentes suportados](#agentes-suportados)
- [Segurança e limites](#segurança-e-limites)
- [Dados locais](#dados-locais)
- [Estrutura do código](#estrutura-do-código)
- [Testes e validação](#testes-e-validação)
- [Gerar instaladores e publicar uma versão](#gerar-instaladores-e-publicar-uma-versão)
- [Logo e ícones](#logo-e-ícones)
- [Fora do escopo desta versão](#fora-do-escopo-desta-versão)
- [Referências](#referências)

## Instalação para usuários

**Ubuntu e outras distribuições com snap:**

```bash
sudo snap install golfinho --classic
```

O snap se atualiza sozinho. O `--classic` é necessário porque o Golfinho abre terminais,
roda o `git` e os CLIs dos agentes e edita as pastas dos seus projetos.

No macOS, instale pelo Terminal:

```bash
curl -fsSL https://raw.githubusercontent.com/Joaocstt/golfinho/main/scripts/install-mac.sh | bash
```

O script baixa a versão mais recente para o seu Mac (Apple Silicon ou Intel), confere o
sha512, instala em *Aplicativos* e abre o app. Como o download não passa pelo navegador, o
macOS não marca o app com quarentena e não é preciso rodar `xattr`. As versões seguintes vêm
pelo próprio Golfinho (veja abaixo).

**Atualizações:** o Golfinho não verifica nada sozinho. Clique no botão de download ao lado de
*Configurações*, no topo da barra lateral: se houver versão nova, o aviso mostra *Atualizar*,
que baixa a versão, e depois *Reiniciar e atualizar*. Funciona no Windows, no macOS e no
AppImage; o snap se atualiza pela loja e o `.deb` pelo `apt`.

Para os outros sistemas, baixe os arquivos na página de [Releases](https://github.com/Joaocstt/golfinho/releases).

| Sistema | Arquivo | Como instalar |
| --- | --- | --- |
| Windows | `Golfinho Setup <versão>.exe` | Execute o instalador. Ele pode escolher outra pasta de instalação. |
| macOS | `Golfinho-<versão>.dmg` (Apple Silicon ou Intel) | Arraste o app para *Aplicativos* (prefira o script acima). |
| Linux (qualquer distribuição) | `Golfinho-<versão>.AppImage` | `chmod +x Golfinho-<versão>.AppImage` e execute. |
| Linux (Debian/Ubuntu) | `golfinho_<versão>_amd64.deb` | `sudo apt install ./golfinho_<versão>_amd64.deb` |

**Avisos de segurança do sistema:** os instaladores não são assinados digitalmente.

- **Windows:** o SmartScreen mostra "O Windows protegeu o computador". Clique em
  *Mais informações* e depois em *Executar mesmo assim*.
- **macOS:** com o `.dmg` baixado pelo navegador, o Gatekeeper bloqueia o app. Use o
  script acima ou rode `xattr -dr com.apple.quarantine /Applications/Golfinho.app` uma vez;
  as atualizações seguintes, feitas pelo botão de atualizar do Golfinho, não precisam disso.
- **Linux:** o AppImage precisa de FUSE. No Ubuntu 24.04 e derivados, instale com
  `sudo apt install libfuse2t64` (em versões anteriores, `libfuse2`).

**Pré-requisitos no computador de uso:**

- **Git** instalado e no `PATH`.
- As CLIs dos agentes que você pretende usar (`codex`, `claude` ou `agy`), já
  autenticados pelas próprias ferramentas. O Golfinho não pede nem armazena chaves de API.
- Para conexões remotas, o cliente **OpenSSH** (`ssh`) precisa estar disponível.
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

No Windows, `npm run dev` e `npm start` usam o launcher
[`scripts/local-app.mjs`](scripts/local-app.mjs). Ele prepara um `Golfinho-dev.exe`
com nome e ícone próprios ao lado do runtime, preservando o `electron.exe` original.
Após trocar a logo ou atualizar o Electron, feche a sessão local anterior e abra
novamente para aplicar a identidade visual.

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
   **Setup das pastas de trabalho**. Ele roda na pasta usada pela tarefa antes da CLI
   e não se repete após ter terminado com sucesso naquela tarefa.
4. Crie a primeira tarefa. Use **Terminal** para as três CLIs ou **Chat** para Claude
   e Codex. O botão **Ajuda** na barra lateral explica o fluxo dentro do app.

## Fluxo de uma tarefa

1. **Criar a tarefa** com título, instrução, agente, base e remoto. A branch
   `golfinho/...` é sugerida automaticamente. A base precisa ser uma referência local
   existente; o Golfinho não faz `fetch` implícito.
2. **Colocar na fila.** Numa tarefa nova, o Golfinho cria a branch `golfinho/...` a
   partir da base e a torna ativa na pasta do projeto. Numa tarefa com branch existente,
   a tarefa entra nessa branch e trabalha diretamente nela. Cada projeto roda uma tarefa
   por vez, na pasta do projeto. Se a pasta tiver alterações não commitadas, a tarefa
   continua na fila com um aviso e os botões **Tentar agora** e **Guardar alterações
   (stash)**, que usa `git stash -u` e pode ser desfeito com `git stash pop`.
3. **Trabalhar com o agente.** No Terminal, responda às perguntas da CLI. No Chat
   de Claude ou Codex, envie mensagens e imagens e responda aos cartões de aprovação.
   Terminal e Chat mantêm conversas independentes.
4. **Commit.** A aba **Commit** mostra as alterações da pasta da tarefa agrupadas por
   pasta. Marque os arquivos que entram no commit, escreva a mensagem e escolha
   **Commit** ou **Commit e enviar**. Só os arquivos marcados são commitados; o resto
   continua alterado. Para pedir o commit ao agente, use a aba **Chat**.
5. **Executar checks.** Escolha os comandos que quiser (testes, lint, build) na aba
   **Checks**. Nenhum check roda sozinho. Os resultados ficam registrados no histórico.
6. **Diff.** A aba **Diff** mostra o que a tarefa mudou em relação à base, quando você
   carregar a revisão.

> Saída zero do agente **não** significa que a tarefa está concluída. Ela só mostra
> que a CLI encerrou.

**Excluir tarefa:** remove os registros da tarefa e a branch criada pelo Golfinho.
Uma branch que já existia ao criar a tarefa é preservada. A pasta principal do
projeto é mantida. Nas tarefas antigas com worktree, a pasta própria também é
removida; alterações não commitadas nessa pasta bloqueiam a exclusão. Não é possível
excluir uma tarefa em execução ou na fila sem cancelá-la antes.

**Tarefas antigas:** tarefas criadas antes desta versão com pasta própria continuam nela.

## Funcionalidades

**Projetos e tarefas**

- Vários projetos e várias tarefas por projeto, com branch nova ou existente.
- Tarefas na pasta do mesmo projeto esperam sua vez; pastas de projetos diferentes
  podem executar em paralelo. Worktrees antigas continuam suportadas.
- Limite global de execuções simultâneas (padrão: 2). Checks também contam para esse
  limite; o que passar do limite entra em fila.
- Encerramento por inatividade no terminal: o prazo é renovado ao receber saída
  da CLI ou entrada do usuário. Zero desativa o limite.

**Terminal**

- Terminal real (pseudoterminal) para cada CLI de agente, com copiar e colar, busca,
  redimensionamento e atalhos. O clique direito abre um menu (Copiar, Colar, Selecionar
  tudo, Buscar). Colar uma imagem da área de transferência insere o caminho do arquivo salvo.
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
- Antes de publicar uma branch que já existe no remoto, o app consulta e busca sua
  referência. Se houver commits remotos ausentes localmente, pede que você atualize
  a branch antes de tentar novamente.
- Tarefas antigas com worktree permitem testar o commit da tarefa na pasta do
  projeto e depois restaurar o checkout anterior, desde que a pasta esteja limpa.

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
- Ao salvar um arquivo remoto, o app verifica sua data de modificação e cria uma
  cópia de segurança do conteúdo anterior no servidor.
- Senhas, quando usadas, ficam no cofre do sistema, via Electron `safeStorage`
  (libsecret/GNOME Keyring no Linux, Keychain no macOS, DPAPI no Windows). Nunca são
  gravadas em texto puro.

## Terminal e chat

| Recurso | Terminal | Chat |
| --- | --- | --- |
| Agentes | Codex, Claude Code e Antigravity | Codex e Claude |
| Interface | CLI interativa em xterm.js | Mensagens em Markdown, blocos de código e resultados de ferramentas recolhíveis |
| Aprovações | Solicitadas pela CLI | Cartões para permitir ou negar; permissão para a sessão quando oferecida pelo agente |
| Imagens | Colar insere o caminho local da imagem | Anexar arquivos ou colar imagens, com prévia antes do envio |
| Conversas | ID da sessão da CLI, quando detectado | Histórico persistido e ID de sessão próprio por tarefa |

O Chat do Claude usa o Claude Agent SDK. O Chat do Codex se comunica com
`codex app-server`, usando o executável configurado no app. As autenticações são
as das ferramentas instaladas; não há formulário de chave de API no Golfinho.

O Chat aceita até **8 imagens por mensagem**, com até **5 MiB por imagem**, nos
formatos PNG, JPEG, GIF e WebP. As imagens ficam armazenadas localmente e são
enviadas ao agente ao enviar a mensagem. O botão **Parar** interrompe o turno
atual e permite continuar a conversa depois.

Terminal e Chat têm sessões separadas e não compartilham o histórico da conversa.
Os dois acessam a mesma pasta de trabalho da tarefa. Evite executar os dois
agentes ao mesmo tempo sobre os mesmos arquivos. O limite da fila controla as
execuções do coordenador e os checks; o Chat e os shells avulsos têm ciclo próprio.

## Memória do projeto

Cada projeto tem uma memória local: notas de **decisão**, **convenção**, **armadilha**,
**contexto** e o registro de **tarefas** concluídas. Elas ficam na aba **Memória**, onde
dá para buscar (a busca ignora acentos), criar, editar, fixar, arquivar e excluir.

- **De onde vêm as notas:** criadas na aba Memória; o botão **Salvar na memória** em
  cada resposta do chat; o registro automático de cada tarefa (situação, pedido, linha
  do tempo da conversa com suas mensagens, as respostas e ferramentas de cada agente e as
  trocas de agente, arquivos alterados e checks, montado sem LLM), atualizado a cada
  resposta do chat, a cada fim de execução no terminal e ao **Concluir**, sempre na mesma
  nota; e o próprio agente, pela ferramenta `memoria_salvar`.
- **Como chegam ao agente:** na primeira mensagem de uma conversa nova (Terminal ou
  Chat), inclusive depois de trocar de agente, o agente recebe **todas** as notas não
  arquivadas: primeiro as fixadas, depois as mais relacionadas ao pedido e então as mais
  recentes. Até cerca de 24 mil caracteres elas vão completas; as que passarem disso vão
  só pelo título, e Claude e Codex podem abri-las com `memoria_ler`. Ao retomar uma
  sessão, nada é repetido.
- **Histórico pesquisável:** todas as conversas do chat (mensagens, respostas, ferramentas
  e resultados) ficam indexadas. O `memoria_buscar` procura nas notas e nesse histórico,
  inclusive de outras tarefas e de outros agentes, e o `memoria_conversa` abre o trecho
  completo.
- **Ferramentas MCP:** Claude e Codex recebem, só naquela execução, o servidor
  `golfinho_memoria`, com `memoria_buscar`, `memoria_conversa`, `memoria_ler`,
  `memoria_recentes` e `memoria_salvar`. O servidor escuta apenas em `127.0.0.1`, exige um token novo a cada
  abertura do app e só enxerga o projeto da tarefa. A configuração global das CLIs não é
  alterada. O Antigravity não aceita MCP por execução e recebe só as notas da primeira
  mensagem.
- **Desligar:** em Configurações → *Memória do projeto*. As notas continuam guardadas.

## Agentes suportados

| Agente | Executável | Integração | Permissões |
| --- | --- | --- | --- |
| Codex | `codex` | CLI no Terminal; `app-server` no Chat | `workspace-write` e aprovação `on-request`. |
| Claude Code | `claude` | CLI no Terminal; Claude Agent SDK no Chat | Terminal com `--permission-mode manual`; Chat com modo `default` e cartões para os pedidos de aprovação. |
| Antigravity | `agy` | CLI no Terminal | Configurações de aprovação da própria CLI. |

O chat do Antigravity usa `--dangerously-skip-permissions`: qualquer comando e edição é
aprovado sem perguntar, porque esse modo não tem cartão de aprovação. Os demais agentes
seguem as aprovações de cada CLI. Os caminhos dos executáveis podem ser ajustados na interface.

## Segurança e limites

- **Não há sandbox do Golfinho.** Branches isolam o histórico, mas não isolam o sistema
  de arquivos. Os agentes têm o acesso que as próprias CLIs concedem. Revise os diffs
  antes de publicar.
- **Credenciais:** o Golfinho usa as autenticações existentes das CLIs e não lê nem
  guarda chaves de API.
- **Publicação:** o push é sempre normal (sem `--force`). Nada é mesclado na branch base.
- **Exclusão:** bloqueia a remoção de worktrees com alterações não commitadas e
  preserva branches adotadas pelo usuário.
- **Editor:** arquivos grandes (acima de 2 MiB) não são abertos.

## Dados locais

- **Banco:** SQLite (`node:sqlite`) com projetos, tarefas, eventos, configurações e
  resultados de checks, além do histórico e dos IDs de sessão do chat e das notas da
  memória dos projetos (com índice FTS5 para a busca).
- **Configuração MCP do Claude:** um arquivo por tarefa em `mcp/` na pasta de dados,
  legível só pelo usuário. A pasta é apagada ao abrir e ao fechar o app.
- **Logs de terminal:** limitados a uma cauda de cerca de 2 MiB em disco. A interface
  recebe até 512 mil caracteres.
- **Pasta de dados:**
  - Linux: `~/.config/golfinho/`
  - Windows: `%APPDATA%\golfinho\`
  - macOS: `~/Library/Application Support/golfinho/`
- **Pasta de dados alternativa:** defina a variável `GOLFINHO_DATA_DIR` para usar outro
  diretório, por exemplo em testes.
- **Pastas de tarefas antigas:** criadas como `git worktree` em
  `worktrees/<projeto>/<tarefa>`. Tarefas novas usam a pasta do projeto.
- **Imagens coladas:** salvas em `clipboard/` na pasta de dados, e o caminho do arquivo
  é colado no terminal.
- **Anexos do chat:** arquivos importados para `chat-images/` na pasta de dados.
- **Reabertura:** tarefas que estavam em execução são marcadas como interrompidas.
  Os processos não reiniciam sozinhos; a retomada exige uma ação do usuário.

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
│   ├── chat.ts          chat do Claude, aprovações e gestão das conversas
│   ├── memory.ts        memória do projeto: consulta, registro da tarefa e pacote enviado
│   ├── memoryMcp.ts     servidor MCP local da memória
│   ├── codexChat.ts     integração com codex app-server
│   ├── chatImages.ts    importação e validação de imagens do chat
│   ├── pty.ts           pseudoterminais (node-pty)
│   ├── shells.ts        shells avulsos
│   ├── sessions.ts      leitura das sessões dos agentes para retomada
│   ├── quota.ts         consumo dos planos via CLI
│   ├── ssh.ts           conexões SSH
│   ├── vault.ts         cofre do sistema para senhas
│   ├── logs.ts          logs de terminal
│   └── schema.ts        validação das requisições (zod)
├── preload/     # ponte segura entre o main e a interface
├── renderer/    # interface React (App, ChatPane, HelpPane, editor, terminal, SSH)
└── shared/
    └── contracts.ts     tipos e contratos compartilhados
tests/           # testes com Vitest
scripts/         # launcher local, conversão de ícones e smoke test
build/           # logo e ícones nativos para Windows, macOS e Linux
```

## Testes e validação

```bash
npm test              # testes unitários e de integração (Vitest)
npm run typecheck     # checagem de tipos (TypeScript)
npm run build         # build de produção
npm run smoke         # integração gráfica em Linux, com Bash e /proc
```

- Os testes de Git usam repositórios temporários e um remoto `bare` local.
- O **smoke** percorre o fluxo completo com um executável de teste controlado: branch →
  terminal → diff → check → aceite → push local. Não envia prompts a serviços de IA.
  Grava uma captura em `out/smoke.png`.
- O smoke atual usa `/bin/bash` e `/proc`: execute-o em Linux com sessão gráfica
  ou display virtual. Ele não é um teste portátil para Windows e macOS.
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

1. Atualize a versão de `package.json` e do lockfile, por exemplo com
   `npm version patch --no-git-tag-version`, e valide o build e os testes.
2. Faça commit e push das alterações. Crie e envie uma tag igual à versão do pacote
   (substitua `X.Y.Z` pela versão escolhida):
   ```bash
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```
3. O workflow [`release.yml`](.github/workflows/release.yml) roda os testes, gera os
   instaladores de Linux, Windows e macOS e cria uma release com todos os arquivos.
4. Também é possível disparar o workflow manualmente, pela aba *Actions*, sem criar a tag.
   Nesse caso, os instaladores ficam apenas como artefatos da execução.
5. O mesmo workflow gera o snap a partir de [`snap/snapcraft.yaml`](snap/snapcraft.yaml)
   e, numa tag, publica no canal `stable` da Snap Store. A publicação só roda se o
   secret `SNAPCRAFT_STORE_CREDENTIALS` existir; sem ele, o `.snap` fica só como artefato.

**Configurar a Snap Store (uma vez):**

1. Crie uma conta em [snapcraft.io](https://snapcraft.io) e instale o `snapcraft`
   (`sudo snap install snapcraft --classic`).
2. Reserve o nome: `snapcraft login` e depois `snapcraft register golfinho`.
3. Gere o token do CI e salve como secret `SNAPCRAFT_STORE_CREDENTIALS` no repositório:
   ```bash
   snapcraft export-login --snaps=golfinho --acls package_access,package_push,package_update,package_release -
   ```
4. Peça o confinamento `classic` no fórum, na categoria
   [store-requests](https://forum.snapcraft.io/c/store-requests/19). Até a aprovação,
   a loja segura os uploads para revisão manual.

Um push comum na `main` não dispara esse workflow de release. Os comandos locais
de distribuição usam `--publish never`: geram os arquivos sem publicá-los.

## Logo e ícones

A marca do Golfinho está em [`build/`](build/README.md). O build usa `icon.ico` no
Windows e no instalador/desinstalador, `icon.icns` no macOS e os PNGs de `build/icons/`
no Linux. A interface, o favicon e a janela também usam a identidade do app.

Para recriar os formatos nativos após substituir `build/icon.png`, execute no Windows:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/generate-icons.ps1
```

Os SVGs de Antigravity, Claude e Codex ficam em
[`src/renderer/assets/agents/`](src/renderer/assets/agents/README.md), com registro
das fontes e da licença aplicável. São incluídos no aplicativo e funcionam offline.
O ícone do Codex usa azul na interface.

## Fora do escopo desta versão

- Merge automático de branches e resolução de conflitos.
- Assinatura de código para Windows e macOS (os instaladores são distribuídos sem assinatura).
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

**Componentes de terceiros:** os ícones de arquivo e pasta vêm do
[Material Icon Theme](https://github.com/material-extensions/vscode-material-icon-theme)
(pacote npm `material-icon-theme`), sob licença MIT. O aviso de licença está em
`src/renderer/assets/LICENSE.material-icon-theme`.
