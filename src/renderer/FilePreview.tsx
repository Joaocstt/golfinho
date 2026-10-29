import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Code, Eye, FolderOpen, X } from "lucide-react";
import type { Request } from "../shared/contracts";
const request = <T,>(r: Request) => window.golfinho.request(r) as Promise<T>;
const isMarkdown = (path: string) => /\.(md|markdown|mdx)$/i.test(path);

// Arquivo citado no chat: Markdown abre renderizado, o resto como texto.
// Só lê; para editar, "Abrir em Arquivos" leva ao editor da tarefa.
export function FilePreview({
  taskId,
  path,
  onClose,
  onOpenInFiles,
}: {
  taskId: string;
  path: string;
  onClose: () => void;
  onOpenInFiles?: (path: string) => void;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [source, setSource] = useState(false);
  useEffect(() => {
    let alive = true;
    request<string>({ action: "readTree", taskId, path }).then(
      (text) => alive && setContent(text),
      (e: unknown) => alive && setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(e)),
    );
    return () => {
      alive = false;
    };
  }, [taskId, path]);
  useEffect(() => {
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [onClose]);
  const markdown = isMarkdown(path);
  const name = path.split("/").pop() ?? path;
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal file-preview" role="dialog" aria-modal="true" aria-label={`Arquivo ${name}`}>
        <div className="file-preview-head">
          <strong title={path}>{name}</strong>
          <span className="file-preview-path">{path}</span>
          {markdown && content !== null && (
            <button type="button" title={source ? "Ver renderizado" : "Ver código"} onClick={() => setSource((s) => !s)}>
              {source ? <Eye size={13} /> : <Code size={13} />} {source ? "Preview" : "Código"}
            </button>
          )}
          {onOpenInFiles && (
            <button type="button" title="Abrir no editor da aba Arquivos" onClick={() => onOpenInFiles(path)}>
              <FolderOpen size={13} /> Abrir em Arquivos
            </button>
          )}
          <button type="button" className="file-preview-close" aria-label="Fechar" onClick={onClose}>
            <X size={15} />
          </button>
        </div>
        <div className="file-preview-body">
          {error ? (
            <div className="error" role="alert">{error}</div>
          ) : content === null ? (
            <div className="empty">Carregando…</div>
          ) : markdown && !source ? (
            <div className="chat-text file-preview-md">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            </div>
          ) : (
            <pre className="file-preview-code">{content}</pre>
          )}
        </div>
      </div>
    </div>
  );
}
