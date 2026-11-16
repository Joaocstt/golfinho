import { useEffect, useRef } from "react";
import { pluginRequest } from "./plugins";

let requests = 0;

// Editor de um plugin (customEditors do ORCA) num iframe isolado. Ele só conversa com o Golfinho
// por mensagens: lê e altera o arquivo aberto e faz pedidos ao worker do plugin.
export function PluginEditor({
  pluginKey,
  editorId,
  title,
  path,
  value,
  readOnly,
  dark,
  onChange,
  onSave,
}: {
  pluginKey: string;
  editorId: string;
  title: string;
  path: string;
  value: string;
  readOnly: boolean;
  dark: boolean;
  onChange: (value: string) => void;
  onSave: () => Promise<void> | void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  // O último texto que o editor do plugin conhece: mudança vinda de fora vira "replace".
  const known = useRef(value);
  const latest = useRef({ value, readOnly, path, onChange, onSave });
  latest.current = { value, readOnly, path, onChange, onSave };
  const post = (message: Record<string, unknown>) => frame.current?.contentWindow?.postMessage({ golfinho: true, ...message }, "*");

  useEffect(() => {
    const ids = new Map<number, number>();
    const reply = (id: number, ok: boolean, value?: unknown, error?: { code?: string; message: string }) => post({ type: "reply", id, ok, value, error });
    const onMessage = (e: MessageEvent) => {
      if (!frame.current || e.source !== frame.current.contentWindow) return;
      const m = e.data as { golfinho?: boolean; id: number; type: string; [k: string]: unknown };
      if (!m?.golfinho) return;
      const now = latest.current;
      if (m.type === "session") {
        known.current = now.value;
        reply(m.id, true, { value: now.value, readOnly: now.readOnly, path: now.path });
      } else if (m.type === "change" && typeof m.value === "string" && !now.readOnly) {
        known.current = m.value;
        now.onChange(m.value);
      } else if (m.type === "save") {
        Promise.resolve(now.onSave()).then(
          () => reply(m.id, true, null),
          (error: Error) => reply(m.id, false, undefined, { message: error.message }),
        );
      } else if (m.type === "request" && typeof m.name === "string") {
        const id = ++requests;
        ids.set(m.id, id);
        pluginRequest({ action: "request", key: pluginKey, id, name: m.name, input: m.input ?? null })
          .then(
            (value) => reply(m.id, true, value),
            (error: Error & { code?: string }) => reply(m.id, false, undefined, { code: error.code, message: error.message }),
          )
          .finally(() => ids.delete(m.id));
      } else if (m.type === "cancel" && typeof m.target === "number") {
        const id = ids.get(m.target);
        if (id) void pluginRequest({ action: "cancel", id }).catch(() => {});
      }
    };
    window.addEventListener("message", onMessage);
    const unsubscribe = window.golfinho?.plugins?.subscribe((e) => {
      if (e.key === pluginKey) post({ type: "event", event: e.event, data: e.data });
    });
    return () => {
      window.removeEventListener("message", onMessage);
      unsubscribe?.();
      for (const id of ids.values()) void pluginRequest({ action: "cancel", id }).catch(() => {});
    };
  }, [pluginKey]);

  // O arquivo mudou fora do editor do plugin (no modo código, ou recarregado do disco).
  useEffect(() => {
    if (value === known.current) return;
    known.current = value;
    post({ type: "replace", value });
  }, [value]);
  useEffect(() => post({ type: "theme", dark }), [dark]);

  return (
    <iframe
      ref={frame}
      className="plugin-editor-frame"
      title={`${title}: ${path.split(/[\\/]/).pop()}`}
      // Sem allow-same-origin: o código do plugin não alcança o Golfinho nem o disco.
      sandbox="allow-scripts allow-forms"
      src={`golfinho-plugin://${pluginKey}/__golfinho/editor/${editorId}.html?theme=${dark ? "dark" : "light"}`}
    />
  );
}
