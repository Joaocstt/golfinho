import React from "react";
import {
  CircleCheck,
  CloudUpload,
  FolderPlus,
  GitCompare,
  Hourglass,
  Keyboard,
  LifeBuoy,
  ListPlus,
  MessagesSquare,
  ShieldCheck,
  SquareTerminal,
} from "lucide-react";
// Ajuda do app: o fluxo inteiro em etapas, depois os detalhes de cada parte. O texto segue o
// que o app faz hoje; ao mudar um comportamento, atualize a seção correspondente aqui.
const FLOW = [
  { icon: FolderPlus, title: "Projeto", text: "Adicione um repositório Git local." },
  { icon: ListPlus, title: "Tarefa", text: "Descreva o que o agente deve fazer." },
  { icon: Hourglass, title: "Fila", text: "O app cria a branch e espera a vez." },
  { icon: SquareTerminal, title: "Trabalho", text: "O agente roda no Terminal ou no Chat." },
  { icon: GitCompare, title: "Revisão", text: "Veja o diff e rode os checks." },
  { icon: CircleCheck, title: "Concluir", text: "Registre o aceite da tarefa." },
  { icon: CloudUpload, title: "Publicar", text: "Envie a branch para o remoto." },
];
interface Topic {
  title: string;
  icon: typeof FolderPlus;
  body: React.ReactNode;
}
const TOPICS: Topic[] = [
  {
    title: "Primeiros passos",
    icon: FolderPlus,
    body: (
      <ol>
        <li>
          Em <b>Projetos → +</b>, escolha um repositório Git local. Ele precisa ter pelo menos um commit e
          um remoto configurado.
        </li>
        <li>
          Em <b>Configurações</b> (engrenagem), confira os caminhos das CLIs: <code>codex</code>,{" "}
          <code>claude</code> e <code>agy</code>. O login é feito na própria CLI; o Golfinho não pede nem
          guarda chaves de API.
        </li>
        <li>
          Se o projeto precisa de preparação (por exemplo, <code>npm ci</code>), cadastre o comando em{" "}
          <b>Setup das pastas de trabalho</b>. Ele roda antes de o agente começar.
        </li>
      </ol>
    ),
  },
  {
    title: "Tarefas, branches e fila",
    icon: Hourglass,
    body: (
      <ul>
        <li>
          Cada tarefa tem a sua branch (<code>golfinho/…</code>), criada a partir da base que você escolher.
          A base precisa existir localmente: o app não faz <code>fetch</code> sozinho.
        </li>
        <li>
          Ao <b>Colocar na fila</b>, o app ativa a branch na pasta do projeto. Cada projeto roda uma tarefa
          por vez; as outras esperam.
        </li>
        <li>
          Se a pasta tiver alterações não commitadas, a tarefa espera com um aviso. Use{" "}
          <b>Tentar agora</b> depois de resolver, ou <b>Guardar alterações (stash)</b>, que pode ser
          desfeito com <code>git stash pop</code>.
        </li>
        <li>
          Há um limite global de execuções ao mesmo tempo (padrão: 2). Checks também contam para esse
          limite.
        </li>
      </ul>
    ),
  },
  {
    title: "Terminal ou Chat: qual usar",
    icon: MessagesSquare,
    body: (
      <>
        <ul>
          <li>
            <b>Terminal</b> mostra a CLI do agente como ela é, com todos os recursos dela. Responda às
            perguntas do agente ali mesmo.
          </li>
          <li>
            <b>Chat</b> (Claude e Codex) mostra a mesma conversa em balões, com Markdown, imagens anexadas e
            pedidos de permissão em cartões. O botão <b>Parar</b> interrompe o agente sem perder a conversa.
          </li>
          <li>
            Os dois têm sessões separadas: o que você fala no Chat o Terminal não sabe, e vice-versa. As
            duas conversas são salvas e retomadas ao reabrir a tarefa.
          </li>
        </ul>
        <p className="help-callout">
          Evite usar Terminal e Chat ao mesmo tempo na mesma tarefa: os dois agentes trabalham na mesma
          pasta e podem mexer nos mesmos arquivos.
        </p>
      </>
    ),
  },
  {
    title: "Aprovações e segurança",
    icon: ShieldCheck,
    body: (
      <ul>
        <li>
          Os agentes pedem permissão antes de rodar comandos ou editar arquivos. No Chat, cada pedido vira
          um cartão: <b>Permitir</b> (só esta vez), <b>Sempre permitir</b> (quando o agente oferece) ou{" "}
          <b>Negar</b> (o agente recebe o aviso e tenta outro caminho).
        </li>
        <li>
          O Golfinho não usa nenhuma opção que pula permissões. Mesmo assim, não há sandbox própria: os
          agentes têm o acesso que as CLIs concedem. Revise sempre o diff.
        </li>
      </ul>
    ),
  },
  {
    title: "Revisão, checks e conclusão",
    icon: GitCompare,
    body: (
      <ul>
        <li>
          Quando o agente termina, a tarefa vai para revisão. Isso não quer dizer que deu certo, só que é a
          sua vez de olhar.
        </li>
        <li>
          Em <b>Diff</b> e <b>Arquivos</b> você vê o que mudou e pode editar qualquer arquivo.
        </li>
        <li>
          Em <b>Checks</b>, rode os comandos que quiser (testes, lint, build). Nenhum check roda sozinho, e
          cada um tem até 10 minutos.
        </li>
        <li>
          <b>Concluir tarefa</b> registra o seu aceite. Os checks precisam estar aprovados para o conteúdo
          atual. Concluir não faz merge.
        </li>
      </ul>
    ),
  },
  {
    title: "Publicar no remoto",
    icon: CloudUpload,
    body: (
      <ul>
        <li>
          <b>Publicar branch</b> faz um push comum, sem <code>--force</code>. Nada é mesclado na branch base.
        </li>
        <li>
          Faça commit antes de publicar: peça ao agente ou use a aba <b>Shell</b>.
        </li>
        <li>
          <b>Excluir tarefa</b> remove a branch, mas é recusado se houver alterações não commitadas, para
          nenhum trabalho ser perdido.
        </li>
      </ul>
    ),
  },
  {
    title: "Outras áreas do app",
    icon: SquareTerminal,
    body: (
      <ul>
        <li>
          <b>Shell</b>: um terminal comum na pasta da tarefa, sem agente e sem fila.
        </li>
        <li>
          <b>+</b> no topo: abre um Shell ou um agente fora de qualquer tarefa.
        </li>
        <li>
          <b>Consumo</b>: a cota de cada agente, lida pela própria CLI.
        </li>
        <li>
          <b>SSH</b>: conexões com servidores, com árvore de arquivos remota e terminal. Senhas ficam no
          cofre do sistema.
        </li>
        <li>
          <b>Histórico</b>: tudo o que aconteceu com a tarefa (fila, checks, aceite, publicação).
        </li>
      </ul>
    ),
  },
];
const SHORTCUTS: [string, string][] = [
  ["Enter", "Envia a mensagem no Chat"],
  ["Shift+Enter", "Quebra linha no Chat"],
  ["Ctrl+V (com imagem)", "Anexa a imagem no Chat"],
  ["Ctrl+C (com seleção)", "Copia no terminal; sem seleção, interrompe a CLI"],
  ["Ctrl+Shift+C / Ctrl+Shift+V", "Copia e cola no terminal"],
  ["Ctrl+Shift+F", "Busca no terminal"],
  ["Ctrl + / Ctrl − / Ctrl 0", "Aumenta, diminui e restaura a fonte do terminal"],
];
const PROBLEMS: [string, string][] = [
  [
    "“Executável não encontrado”",
    "A CLI não está instalada ou o caminho está errado. Ajuste em Configurações.",
  ],
  [
    "A tarefa não sai da fila",
    "A pasta do projeto tem alterações não commitadas, ou o limite de execuções foi atingido. Veja o aviso na tarefa.",
  ],
  [
    "“This conversation is open in another app”",
    "A conversa está aberta em outro programa (por exemplo, o app da Codex). Feche-o e tente de novo.",
  ],
  [
    "O agente pede permissão toda hora",
    "No modo atual cada edição pede aprovação. Use “Sempre permitir” quando o cartão oferecer.",
  ],
];
export function HelpPane() {
  return (
    <section className="help-page" aria-label="Ajuda">
      <header className="help-hero">
        <h1>Como o Golfinho funciona</h1>
        <p>
          Você descreve uma tarefa, um agente de código trabalha nela numa branch própria, e você revisa
          tudo antes de publicar. Nada vai para o remoto sem você pedir.
        </p>
      </header>
      <ol className="help-flow" aria-label="Fluxo de uma tarefa">
        {FLOW.map(({ icon: Icon, title, text }, index) => (
          <li key={title}>
            <span className="help-step-number">{index + 1}</span>
            <Icon size={20} aria-hidden />
            <strong>{title}</strong>
            <span>{text}</span>
          </li>
        ))}
      </ol>
      <div className="help-topics">
        {TOPICS.map(({ title, icon: Icon, body }, index) => (
          <details key={title} className="help-topic" open={index === 0}>
            <summary>
              <Icon size={16} aria-hidden />
              {title}
            </summary>
            <div className="help-topic-body">{body}</div>
          </details>
        ))}
      </div>
      <div className="help-columns">
        <section className="help-box" aria-label="Atalhos">
          <h2>
            <Keyboard size={16} aria-hidden /> Atalhos
          </h2>
          <dl>
            {SHORTCUTS.map(([keys, action]) => (
              <React.Fragment key={keys}>
                <dt>
                  <kbd>{keys}</kbd>
                </dt>
                <dd>{action}</dd>
              </React.Fragment>
            ))}
          </dl>
        </section>
        <section className="help-box" aria-label="Problemas comuns">
          <h2>
            <LifeBuoy size={16} aria-hidden /> Problemas comuns
          </h2>
          <dl>
            {PROBLEMS.map(([problem, fix]) => (
              <React.Fragment key={problem}>
                <dt>{problem}</dt>
                <dd>{fix}</dd>
              </React.Fragment>
            ))}
          </dl>
        </section>
      </div>
    </section>
  );
}
