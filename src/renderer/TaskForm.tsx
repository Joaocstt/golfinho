import React, { useEffect, useMemo, useState } from "react";
import { GitBranch, GitBranchPlus, Info, Settings2 } from "lucide-react";
import type { CreateTask, ProjectRefs, Provider, Request, Snapshot, WslAgents } from "../shared/contracts";
import { AgentIcon } from "./agentIcons";
import { FileTypeIcon } from "./fileIcons";
import { Badge, Button, Field, Segmented, Select, TextInput } from "./ui";
const request = <T,>(r: Request) => window.golfinho.request(r) as Promise<T>;

const PROVIDERS: Provider[] = ["codex", "claude", "antigravity"];

// Regras do git check-ref-format que mais pegam na prática. Devolve o problema ou "" quando o
// nome serve; o backend continua sendo quem decide.
export function branchProblem(name: string): string {
  if (!name) return "";
  if (/\s/.test(name)) return "Sem espaços no nome da branch.";
  if (/[~^:?*[\\]/.test(name)) return "Não use ~ ^ : ? * [ ou \\ no nome.";
  if (name.includes("..")) return "Não use dois pontos seguidos (..).";
  if (name.includes("//")) return "Não use duas barras seguidas (//).";
  if (name.includes("@{")) return "Não use @{ no nome.";
  if (/^[-/.]/.test(name)) return "O nome não pode começar com - / ou ponto.";
  if (/[/.]$/.test(name) || name.endsWith(".lock")) return "O nome não pode terminar com / ponto ou .lock.";
  return "";
}

// Nova tarefa: onde (projeto e agente), qual branch e um resumo do que vai ser criado. Sem
// título e instruções: o título vira o nome da branch e a CLI abre vazia, pronta para conversar.
export function TaskForm({
  snapshot,
  projectId,
  busy,
  onSubmit,
}: {
  snapshot: Snapshot;
  projectId: string;
  busy: boolean;
  onSubmit: (input: CreateTask) => void;
}) {
  const [p, setP] = useState(projectId || snapshot.projects[0]?.id || "");
  const project = snapshot.projects.find((x) => x.id === p);
  const [refs, setRefs] = useState<ProjectRefs | null>(null);
  const [refsFailed, setRefsFailed] = useState(false);
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [provider, setProvider] = useState<Provider>("codex");
  const [branch, setBranch] = useState("");
  const [base, setBase] = useState("");
  const [existing, setExisting] = useState("");
  const [remote, setRemote] = useState("");
  const [timeout, setTimeoutMinutes] = useState(60);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!p) return;
    let alive = true;
    setRefs(null);
    setRefsFailed(false);
    request<ProjectRefs>({ action: "branches", projectId: p })
      .then((result) => {
        if (!alive) return;
        setRefs(result);
        setBase(result.current || result.branches[0] || "");
        setExisting(result.current || result.branches[0] || "");
      })
      .catch(() => {
        if (!alive) return;
        setRefsFailed(true);
        setBase("main");
      });
    return () => {
      alive = false;
    };
  }, [p]);
  useEffect(() => setRemote(project?.remotes[0] ?? ""), [project]);

  // Sem lista utilizável o campo volta a aceitar texto, em vez de travar a criação.
  // Pasta sem Git: a tarefa roda direto nela, sem branch, base nem remoto.
  const folder = project?.kind === "folder";
  // Pasta do WSL aberta no Windows: o agente roda dentro da distro, então a CLI instalada no Windows não importa.
  const wslDistro = /^[\\/]{2}wsl(?:\$|\.localhost)[\\/]([^\\/]+)/i.exec(project?.path ?? "")?.[1] ?? null;
  // Quais CLIs existem dentro da distro: o aviso de "não encontrada" passa a valer para elas.
  const [wslAgents, setWslAgents] = useState<WslAgents | null>(null);
  useEffect(() => {
    setWslAgents(null);
    if (!wslDistro || !p) return;
    let alive = true;
    request<WslAgents | null>({ action: "wslAgents", projectId: p })
      .then((result) => alive && setWslAgents(result))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [wslDistro, p]);
  const missingInWsl = wslDistro && wslAgents ? wslAgents.available[provider] === false : false;
  const typedBase = refsFailed || refs?.branches.length === 0;
  const loadingRefs = !refs && !refsFailed;
  const agent = snapshot.agents.find((a) => a.provider === provider);
  const name = branch.trim();
  const problem = branchProblem(name);
  const taken = mode === "new" && !!name && !!refs?.branches.includes(name);
  const branchError = problem || (taken ? "Essa branch já existe. Use \"Branch existente\" para trabalhar nela." : "");
  const target = mode === "new" ? name : existing;
  const ready = folder
    ? !busy && !!project
    : !busy &&
      !loadingRefs &&
      // Sem remoto a tarefa funciona; só não publica.
      (!project?.remotes.length || !!remote) &&
      (mode === "new" ? !!name && !!base.trim() && !branchError : !!existing);
  const others = useMemo(
    () => snapshot.tasks.filter((t) => t.projectId === p && ["running", "waiting", "queued"].includes(t.status)).length,
    [snapshot.tasks, p],
  );

  function submit() {
    setTouched(true);
    if (!ready) return;
    if (folder)
      return onSubmit({ projectId: p, title: "", prompt: "", provider, branch: "", base: "", remote: "", timeoutMinutes: timeout });
    onSubmit({
      projectId: p,
      title: "",
      prompt: "",
      provider,
      branch: target,
      base: mode === "new" ? base.trim() : existing,
      remote,
      timeoutMinutes: timeout,
      ...(mode === "existing" ? { adopt: true } : {}),
    });
  }

  return (
    <form
      className="task-form-v2"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          submit();
        }
      }}
    >
      <p className="task-form-intro">
        {folder
          ? "Esta pasta não usa Git: a tarefa roda direto nela, e o agente recebe um mapa dos projetos que estão dentro. Depois, converse com ele pelo Terminal ou pelo Chat."
          : "A tarefa nasce como rascunho numa branch própria. Depois, converse com o agente pelo Terminal ou pelo Chat."}
      </p>

      <section className="task-form-section">
        <h3>Onde</h3>
        <div className="task-form-grid">
          <Field label="Projeto" htmlFor="task-project">
            <Select id="task-project" value={p} onChange={(e) => setP(e.target.value)}>
              {snapshot.projects.map((x) => (
                <option value={x.id} key={x.id}>
                  {x.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Agente"
            error={
              missingInWsl
                ? `CLI não encontrada dentro da distro ${wslDistro}. Instale e faça login nela pelo terminal do WSL.`
                : agent?.available === false && !wslDistro
                  ? "CLI não encontrada. Configure o caminho em Configurações."
                  : undefined
            }
            hint={wslDistro && !missingInWsl ? `Projeto no WSL: o agente instalado na distro ${wslDistro} é usado.` : undefined}
          >
            <Segmented
              label="Agente"
              value={provider}
              onChange={setProvider}
              options={PROVIDERS.map((option) => {
                const info = snapshot.agents.find((a) => a.provider === option);
                return {
                  value: option,
                  label: info?.label ?? option,
                  icon: <AgentIcon provider={option} size={15} />,
                  title: info && !info.available ? "CLI não encontrada. Configure o caminho em Configurações." : info?.label,
                };
              })}
            />
          </Field>
        </div>
      </section>

      {!folder && (
      <section className="task-form-section">
        <h3>Branch</h3>
        <Segmented
          label="Tipo de branch"
          value={mode}
          onChange={setMode}
          className="task-form-mode"
          options={[
            { value: "new", label: "Nova branch", icon: <GitBranchPlus size={14} /> },
            { value: "existing", label: "Branch que já existe", icon: <GitBranch size={14} /> },
          ]}
        />
        <div className="task-form-grid">
          {mode === "new" ? (
            <>
              <Field
                label="Branch da tarefa"
                htmlFor="task-branch"
                error={touched || name ? branchError : undefined}
                hint="Criada só no seu computador; publicar exige sua ação."
              >
                <TextInput
                  id="task-branch"
                  name="branch"
                  required
                  autoFocus
                  spellCheck={false}
                  placeholder="golfinho/minha-tarefa"
                  value={branch}
                  aria-invalid={!!(name && branchError)}
                  onChange={(e) => setBranch(e.target.value)}
                />
              </Field>
              <Field label="Branch base" htmlFor="task-base" hint="A nova branch parte do código desta.">
                {typedBase ? (
                  <TextInput id="task-base" name="base" required value={base} onChange={(e) => setBase(e.target.value)} />
                ) : (
                  <Select
                    key={`${p}:${refs ? "pronto" : "carregando"}`}
                    id="task-base"
                    name="base"
                    required
                    value={base}
                    onChange={(e) => setBase(e.target.value)}
                  >
                    {refs ? (
                      refs.branches.map((b) => (
                        <option key={b} value={b}>
                          {b}
                          {b === refs.current ? " · atual" : ""}
                        </option>
                      ))
                    ) : (
                      <option value="">Lendo branches…</option>
                    )}
                  </Select>
                )}
              </Field>
            </>
          ) : (
            <Field
              label="Branch existente"
              htmlFor="task-existing"
              className="task-form-wide"
              hint="A tarefa trabalha direto nesta branch. Ela não pode estar aberta em outra pasta, e excluir a tarefa nunca a apaga."
            >
              <Select
                key={`existing:${p}`}
                id="task-existing"
                name="existing"
                required
                value={existing}
                onChange={(e) => setExisting(e.target.value)}
              >
                {(refs?.branches ?? []).map((b) => (
                  <option key={b} value={b}>
                    {b}
                    {b === refs?.current ? " · atual" : ""}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
      </section>
      )}

      <details className="task-form-advanced">
        <summary>
          <Settings2 size={14} /> Opções avançadas
        </summary>
        <div className="task-form-grid">
          {!!project?.remotes.length && (
            <Field label="Remoto" htmlFor="task-remote" hint="Para onde a branch vai quando você publicar.">
              <Select id="task-remote" name="remote" required value={remote} onChange={(e) => setRemote(e.target.value)}>
                {project.remotes.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </Select>
            </Field>
          )}
          <Field
            label="Encerrar se parado (minutos)"
            htmlFor="task-timeout"
            hint="Sem saída do agente e sem você digitar por esse tempo, a execução é encerrada. 0 desativa."
          >
            <TextInput
              id="task-timeout"
              name="timeout"
              type="number"
              min={0}
              max={1440}
              required
              value={timeout}
              onChange={(e) => setTimeoutMinutes(Math.max(0, Math.min(1440, Number(e.target.value) || 0)))}
            />
          </Field>
        </div>
      </details>

      {folder ? (
        <p className={"task-form-note" + (others ? " warn" : "")} role="note">
          <Info size={14} />
          {others
            ? `${others} tarefa(s) desta pasta em execução. Uma tarefa por vez trabalha na pasta: esta começa quando a outra terminar.`
            : "Sem Git, não há branch nem commit pelo Golfinho. A revisão mostra o que mudou nos projetos com Git que estão dentro."}
        </p>
      ) : !project?.remotes.length ? (
        <p className="task-form-note" role="note">
          <Info size={14} /> Este repositório não tem remoto. A tarefa funciona normalmente; só não dá para publicar a branch até você adicionar um.
        </p>
      ) : (
        <p className={"task-form-note" + (others ? " warn" : "")} role="note">
          <Info size={14} />
          {others
            ? `${others} tarefa(s) deste projeto em execução. As tarefas compartilham a pasta do projeto: encerre a outra antes de iniciar esta, para não misturar alterações.`
            : "As tarefas deste projeto compartilham a mesma pasta: ao iniciar, o app pode trocar a branch dela."}
        </p>
      )}

      <div className="task-form-summary" aria-live="polite">
        <div className="task-form-summary-text">
          {project && <FileTypeIcon name={project.name} kind="directory" size={16} />}
          <span>
            {folder ? (
              <>
                Trabalha direto na pasta <code>{project?.name}</code>
              </>
            ) : target ? (
              <>
                {mode === "new" ? "Cria " : "Trabalha em "}
                <code>{target}</code>
                {mode === "new" && base && (
                  <>
                    {" "}a partir de <code>{base}</code>
                  </>
                )}
                {remote && <> · {remote}</>}
              </>
            ) : (
              "Dê um nome à branch da tarefa"
            )}
          </span>
          <Badge tone="brand">
            <AgentIcon provider={provider} size={12} /> {agent?.label ?? provider}
          </Badge>
        </div>
        <Button type="submit" variant="primary" disabled={!ready} title="Ctrl+Enter">
          {busy ? "Criando…" : "Criar tarefa"}
        </Button>
      </div>
    </form>
  );
}
