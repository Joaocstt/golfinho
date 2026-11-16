import React, { useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  CircleAlert,
  CircleCheck,
  Download,
  File,
  FileText,
  Folder,
  Globe,
  Info,
  Plug,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { pluginRequest } from "./plugins";

// Painel de um plugin com ui: "components" (formato do ORCA). O código do plugin roda num iframe
// escondido e isolado e manda uma árvore de componentes; aqui ela vira a interface do Golfinho.
// Clique e digitação voltam ao iframe, que chama a função do plugin e manda a árvore nova.

export interface PanelNode {
  type: string;
  props: Record<string, unknown>;
  children: (PanelNode | string)[];
}
type Fn = { $fn: number };
const isFn = (v: unknown): v is Fn => Boolean(v && typeof v === "object" && "$fn" in (v as object));

const ICONS: Record<string, React.ComponentType<{ size?: number }>> = {
  activity: Activity,
  add: Plus,
  plus: Plus,
  check: Check,
  success: CircleCheck,
  error: CircleAlert,
  warning: AlertTriangle,
  info: Info,
  collapse: ChevronLeft,
  back: ChevronLeft,
  expand: ChevronDown,
  "chevron-right": ChevronRight,
  delete: Trash2,
  trash: Trash2,
  close: X,
  download: Download,
  upload: Upload,
  folder: Folder,
  file: File,
  "file-text": FileText,
  globe: Globe,
  plug: Plug,
  refresh: RefreshCw,
  search: Search,
  settings: Settings,
};
export function PanelIcon({ name, size = 13 }: { name?: unknown; size?: number }) {
  const Icon = (typeof name === "string" && ICONS[name]) || Circle;
  return <Icon size={size} />;
}

const text = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v) : "");

export function PluginPanel({ pluginKey, panelId, title }: { pluginKey: string; panelId: string; title: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [tree, setTree] = useState<PanelNode | string | null>(null);
  const [failure, setFailure] = useState("");
  const storageKey = `golfinho.plugin.${pluginKey}.atoms`;

  const post = (message: Record<string, unknown>) => frame.current?.contentWindow?.postMessage({ golfinho: true, ...message }, "*");
  const invoke = (fn: unknown, ...args: unknown[]) => {
    if (isFn(fn)) post({ type: "invoke", fn: fn.$fn, args });
  };

  useEffect(() => {
    const ids = new Map<number, number>();
    let requests = 0;
    const reply = (id: number, ok: boolean, value?: unknown, error?: { code?: string; message: string }) => post({ type: "reply", id, ok, value, error });
    const readAtoms = (): Record<string, unknown> => {
      try {
        return JSON.parse(localStorage.getItem(storageKey) ?? "{}");
      } catch {
        return {};
      }
    };
    const onMessage = (e: MessageEvent) => {
      if (!frame.current || e.source !== frame.current.contentWindow) return;
      const m = e.data as { golfinho?: boolean; id: number; type: string; [k: string]: unknown };
      if (!m?.golfinho) return;
      if (m.type === "tree") {
        setFailure("");
        setTree(m.tree as PanelNode);
      } else if (m.type === "failed") setFailure(String(m.message));
      else if (m.type === "atoms") reply(m.id, true, readAtoms());
      else if (m.type === "persist" && typeof m.key === "string") {
        try {
          localStorage.setItem(storageKey, JSON.stringify({ ...readAtoms(), [m.key]: m.value }));
        } catch {
          /* sem armazenamento: o valor vale só enquanto o painel estiver aberto */
        }
      } else if (m.type === "request" && typeof m.name === "string") {
        const id = Date.now() * 1000 + ++requests;
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
    };
  }, [pluginKey, panelId]);

  return (
    <div className="plugin-panel" aria-label={title}>
      <iframe
        ref={frame}
        className="plugin-panel-frame"
        title={`${title} (código do plugin)`}
        aria-hidden="true"
        tabIndex={-1}
        sandbox="allow-scripts"
        src={`golfinho-plugin://${pluginKey}/__golfinho/panel/${panelId}.html`}
      />
      {failure && (
        <p className="error" role="alert">
          {failure}
        </p>
      )}
      {tree ? <Node node={tree} invoke={invoke} /> : !failure && <p className="plugins-muted">Carregando…</p>}
    </div>
  );
}

type Invoke = (fn: unknown, ...args: unknown[]) => void;

function Children({ nodes, invoke }: { nodes: (PanelNode | string)[]; invoke: Invoke }) {
  return (
    <>
      {nodes.map((n, i) => (
        <Node key={i} node={n} invoke={invoke} />
      ))}
    </>
  );
}

const GAP: Record<string, number> = { none: 0, xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };
const gap = (v: unknown) => (typeof v === "number" ? v : GAP[String(v ?? "sm")] ?? 8);
const JUSTIFY: Record<string, string> = { start: "flex-start", end: "flex-end", center: "center", between: "space-between", around: "space-around" };
const ALIGN: Record<string, string> = { start: "flex-start", end: "flex-end", center: "center", stretch: "stretch", baseline: "baseline" };
const HEIGHT: Record<string, number> = { sm: 120, md: 220, lg: 360, xl: 520 };

export function Node({ node, invoke }: { node: PanelNode | string; invoke: Invoke }) {
  if (typeof node === "string") return <>{node}</>;
  const p = node.props;
  const kids = <Children nodes={node.children} invoke={invoke} />;
  const tone = typeof p.tone === "string" ? ` tone-${p.tone}` : "";
  switch (node.type) {
    case "Fragment":
      return kids;
    case "Stack":
      return <div className="pp-stack" style={{ gap: gap(p.gap), alignItems: ALIGN[String(p.align)] }}>{kids}</div>;
    case "Row":
      return (
        <div
          className="pp-row"
          style={{ gap: gap(p.gap), justifyContent: JUSTIFY[String(p.justify)], alignItems: ALIGN[String(p.align)] ?? "center", flexWrap: p.wrap ? "wrap" : undefined }}
        >
          {kids}
        </div>
      );
    case "Box": {
      const max = typeof p.maxHeight === "number" ? p.maxHeight : HEIGHT[String(p.maxHeight)];
      return (
        <div className="pp-box" style={{ maxHeight: max, overflowY: p.scroll === "y" || p.scroll === true ? "auto" : undefined, padding: gap(p.padding ?? "none") }}>
          {kids}
        </div>
      );
    }
    case "Text":
    case "Heading": {
      const cls = `pp-text size-${String(p.size ?? (node.type === "Heading" ? "md" : "sm"))}${p.muted ? " muted" : ""}${p.truncate ? " truncate" : ""}${tone} weight-${String(p.weight ?? (node.type === "Heading" ? "semibold" : "normal"))}`;
      return <span className={cls} title={p.truncate ? node.children.filter((c) => typeof c === "string").join("") : undefined}>{kids}</span>;
    }
    case "Badge":
      return <span className={`pp-badge${tone}`}>{kids}</span>;
    case "Divider":
      return <hr className="pp-divider" />;
    case "Button":
      return (
        <button
          type="button"
          className={`pp-button variant-${String(p.variant ?? "solid")} size-${String(p.size ?? "md")}${tone}`}
          disabled={Boolean(p.disabled)}
          onClick={() => invoke(p.onPress)}
        >
          {p.icon ? <PanelIcon name={p.icon} /> : null}
          {kids}
        </button>
      );
    case "IconButton":
      return (
        <button
          type="button"
          className={`pp-button pp-icon-button variant-${String(p.variant ?? "ghost")} size-${String(p.size ?? "md")}${tone}`}
          aria-label={text(p.label)}
          title={text(p.label)}
          disabled={Boolean(p.disabled)}
          onClick={() => invoke(p.onPress)}
        >
          <PanelIcon name={p.icon} />
        </button>
      );
    case "Link":
      return (
        <button type="button" className="pp-link" onClick={() => invoke(p.onPress)}>
          {kids}
        </button>
      );
    case "Input":
    case "TextArea":
      return <PanelInput node={node} invoke={invoke} />;
    case "Select":
      return (
        <label className="pp-field">
          {p.label ? <span>{text(p.label)}</span> : null}
          <select value={text(p.value)} disabled={Boolean(p.disabled)} onChange={(e) => invoke(p.onChange, e.target.value)}>
            {(Array.isArray(p.options) ? p.options : []).map((o: { value?: unknown; label?: unknown }) => (
              <option key={text(o.value)} value={text(o.value)}>
                {text(o.label ?? o.value)}
              </option>
            ))}
          </select>
        </label>
      );
    case "Switch":
    case "Checkbox":
      return (
        <label className="pp-check">
          <input type="checkbox" checked={Boolean(p.value ?? p.checked)} disabled={Boolean(p.disabled)} onChange={(e) => invoke(p.onChange, e.target.checked)} />
          <span>{text(p.label)}</span>
        </label>
      );
    case "Card":
      return (
        <section className="pp-card">
          {p.title ? <strong>{text(p.title)}</strong> : null}
          {p.description ? <span className="pp-text size-xs muted">{text(p.description)}</span> : null}
          {kids}
        </section>
      );
    case "Callout":
      return (
        <div className={`pp-callout${tone}`} role={p.tone === "danger" ? "alert" : "note"}>
          {p.title ? <strong>{text(p.title)}</strong> : null}
          <div>{kids}</div>
        </div>
      );
    case "Collapsible":
      return <PanelCollapsible node={node} invoke={invoke} />;
    case "Tabs":
      return <PanelTabs node={node} invoke={invoke} />;
    case "Tab":
      return kids;
    case "EmptyState":
      return (
        <div className="pp-empty">
          <PanelIcon name={p.icon} size={20} />
          <strong>{text(p.title)}</strong>
          {p.description ? <span className="pp-text size-xs muted">{text(p.description)}</span> : null}
          {kids}
        </div>
      );
    case "KeyValue":
      return (
        <dl className="pp-keyvalue">
          {(Array.isArray(p.items) ? p.items : []).map((item: { label?: unknown; value?: unknown }, i: number) => (
            <React.Fragment key={i}>
              <dt>{text(item.label)}</dt>
              <dd>{text(item.value)}</dd>
            </React.Fragment>
          ))}
        </dl>
      );
    case "List":
      return (
        <ul className="pp-list" aria-label={text(p.label) || undefined}>
          {node.children.map((c, i) => (
            <li key={i}>
              <Node node={c} invoke={invoke} />
            </li>
          ))}
        </ul>
      );
    case "ListItem":
      return (
        <button type="button" className="pp-list-item" disabled={!isFn(p.onPress)} onClick={() => invoke(p.onPress)}>
          {p.icon ? <PanelIcon name={p.icon} /> : null}
          <span>
            <span className="pp-text size-sm truncate">{text(p.title)}</span>
            {p.description ? <span className="pp-text size-xs muted truncate">{text(p.description)}</span> : null}
          </span>
        </button>
      );
    case "CodeView": {
      const max = typeof p.maxHeight === "number" ? p.maxHeight : HEIGHT[String(p.maxHeight ?? "md")];
      return (
        <div className="pp-field">
          {p.label ? <span>{text(p.label)}</span> : null}
          <pre className={"pp-code" + (p.wrap ? " wrap" : "")} style={{ maxHeight: max }}>
            {text(p.code)}
          </pre>
        </div>
      );
    }
    case "Progress":
      return <progress className="pp-progress" value={typeof p.value === "number" ? p.value : undefined} max={typeof p.max === "number" ? p.max : 1} />;
    case "Spinner":
      return <span className="pp-text size-xs muted">Carregando…</span>;
    default:
      return <div className="pp-unknown">{kids}</div>;
  }
}

// Campo de texto com estado local: a ida e volta ao iframe não pode mexer no cursor.
function PanelInput({ node, invoke }: { node: PanelNode; invoke: Invoke }) {
  const p = node.props;
  const [value, setValue] = useState(text(p.value ?? p.defaultValue));
  const sent = useRef(value);
  useEffect(() => {
    const incoming = text(p.value);
    if (p.value !== undefined && incoming !== sent.current) {
      sent.current = incoming;
      setValue(incoming);
    }
  }, [p.value]);
  const change = (v: string) => {
    setValue(v);
    sent.current = v;
    invoke(p.onChange, v);
  };
  const common = {
    value,
    placeholder: text(p.placeholder) || undefined,
    disabled: Boolean(p.disabled),
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => change(e.target.value),
  };
  return (
    <label className="pp-field">
      {p.label ? <span>{text(p.label)}</span> : null}
      {node.type === "TextArea" ? (
        <textarea rows={4} {...common} />
      ) : (
        <input
          type={p.type === "password" ? "password" : p.type === "number" ? "number" : "text"}
          {...common}
          onKeyDown={(e) => {
            if (e.key === "Enter") invoke(p.onSubmit);
          }}
        />
      )}
      {p.description ? <small className="pp-text size-xs muted">{text(p.description)}</small> : null}
    </label>
  );
}

function PanelCollapsible({ node, invoke }: { node: PanelNode; invoke: Invoke }) {
  const p = node.props;
  const [open, setOpen] = useState(Boolean(p.defaultOpen));
  return (
    <section className="pp-collapsible">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <span>
          <strong>{text(p.title)}</strong>
          {p.description ? <span className="pp-text size-xs muted">{text(p.description)}</span> : null}
        </span>
      </button>
      {open && <Children nodes={node.children} invoke={invoke} />}
    </section>
  );
}

function PanelTabs({ node, invoke }: { node: PanelNode; invoke: Invoke }) {
  const tabs = node.children.filter((c): c is PanelNode => typeof c !== "string" && c.type === "Tab");
  const [active, setActive] = useState(text(node.props.value ?? node.props.defaultValue) || text(tabs[0]?.props.value));
  const current = tabs.find((t) => text(t.props.value) === active) ?? tabs[0];
  return (
    <div className="pp-tabs">
      <div role="tablist" aria-label={text(node.props.label) || undefined}>
        {tabs.map((t) => (
          <button
            key={text(t.props.value)}
            type="button"
            role="tab"
            aria-selected={t === current}
            onClick={() => {
              setActive(text(t.props.value));
              invoke(node.props.onChange, text(t.props.value));
            }}
          >
            {text(t.props.label)}
          </button>
        ))}
      </div>
      {current && (
        <div role="tabpanel">
          <Children nodes={current.children} invoke={invoke} />
        </div>
      )}
    </div>
  );
}
