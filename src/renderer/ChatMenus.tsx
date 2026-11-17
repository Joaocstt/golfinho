import React, { useEffect, useRef, useState } from "react";
import { Check, ChevronRight } from "lucide-react";
import type { ChatEffort, ChatModelOption, ChatPermissionMode } from "../shared/contracts";
import { EFFORT_LABELS, PERMISSION_MODES } from "../shared/permissionModes";

// Menus do campo de mensagem no estilo do app do Claude: abrem para cima, item marcado com ✓,
// atalhos por número e submenus que abrem ao lado.
function useMenu() {
  const [open, setOpen] = useState(false);
  const [sub, setSub] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  useEffect(() => {
    if (!open) setSub(null);
  }, [open]);
  return { open, setOpen, sub, setSub, ref };
}

function Item({
  label,
  hint,
  selected,
  shortcut,
  disabled,
  onSelect,
}: {
  label: string;
  hint?: string;
  selected?: boolean;
  shortcut?: string;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={Boolean(selected)}
      className="chat-menu-item"
      disabled={disabled}
      title={hint}
      onClick={onSelect}
    >
      <span className="chat-menu-text">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </span>
      {selected ? <Check size={16} className="chat-menu-check" /> : shortcut ? <span className="chat-menu-key">{shortcut}</span> : null}
    </button>
  );
}

function SubmenuRow({
  id,
  label,
  value,
  menu,
  children,
}: {
  id: string;
  label: string;
  value?: string;
  menu: ReturnType<typeof useMenu>;
  children: React.ReactNode;
}) {
  const open = menu.sub === id;
  return (
    <div className="chat-menu-subwrap" onMouseEnter={() => menu.setSub(id)}>
      <button
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        className={`chat-menu-item${open ? " active" : ""}`}
        onClick={() => menu.setSub(open ? null : id)}
      >
        <span className="chat-menu-text">
          <span>{label}</span>
        </span>
        {value && <span className="chat-menu-value">{value}</span>}
        <ChevronRight size={15} className="chat-menu-chevron" />
      </button>
      {open && (
        <div className="chat-menu chat-submenu" role="menu" aria-label={label}>
          {children}
        </div>
      )}
    </div>
  );
}

// Nome curto do modelo no botão: "Padrão (Opus 5.5)" aparece como "Opus 5.5".
function shortName(option: ChatModelOption | undefined, fallback: string) {
  if (!option) return fallback;
  return /^Padrão \((.+)\)$/.exec(option.label)?.[1] ?? option.label;
}

export function ModelMenu({
  models,
  model,
  effort,
  canChangeModel,
  showEffort,
  onModel,
  onEffort,
}: {
  models: ChatModelOption[];
  model: string | null;
  effort: ChatEffort | null;
  canChangeModel: boolean;
  showEffort: boolean;
  onModel: (value: string | null) => void;
  onEffort: (effort: ChatEffort | null) => void;
}) {
  const menu = useMenu();
  const current = models.find((m) => m.value === (model ?? ""));
  // Na lista principal ficam os modelos com nome; o padrão e o que for diferente vão para "Mais modelos".
  const main = models.filter((m) => m.value !== "" && /\d/.test(m.label));
  const more = models.filter((m) => !main.includes(m));
  const efforts = (current?.efforts ?? models.find((m) => m.value === "")?.efforts ?? []) as ChatEffort[];
  const choose = (value: string) => {
    menu.setOpen(false);
    if (value !== (model ?? "")) onModel(value || null);
  };
  useEffect(() => {
    if (!menu.open || !canChangeModel) return;
    const digit = (e: KeyboardEvent) => {
      const n = Number(e.key);
      if (!Number.isInteger(n) || n < 1 || n > main.length) return;
      e.preventDefault();
      choose(main[n - 1].value);
    };
    document.addEventListener("keydown", digit);
    return () => document.removeEventListener("keydown", digit);
  });
  return (
    <div className="chat-menu-anchor" ref={menu.ref}>
      <button
        type="button"
        className="chat-menu-trigger"
        aria-label="Modelo do chat"
        aria-haspopup="menu"
        aria-expanded={menu.open}
        onClick={() => menu.setOpen(!menu.open)}
      >
        <span>{shortName(current, model ?? "Padrão")}</span>
        {showEffort && effort && <span className="chat-menu-trigger-dim">{EFFORT_LABELS[effort]}</span>}
      </button>
      {menu.open && (
        <div className="chat-menu" role="menu" aria-label="Modelos">
          {(main.length ? main : more).map((m, i) => (
            <Item
              key={m.value}
              label={m.label}
              hint={undefined}
              // No padrão, o ✓ fica no modelo que o padrão usa hoje (como no Claude).
              selected={m.value === (model ?? "") || (!model && m.label === shortName(current, ""))}
              shortcut={main.length ? String(i + 1) : undefined}
              disabled={!canChangeModel}
              onSelect={() => choose(m.value)}
            />
          ))}
          {(showEffort && efforts.length > 0) || (main.length > 0 && more.length > 0) ? <hr /> : null}
          {showEffort && efforts.length > 0 && (
            <SubmenuRow id="effort" label="Esforço" value={effort ? EFFORT_LABELS[effort] : "Padrão"} menu={menu}>
              <Item label="Padrão" selected={!effort} onSelect={() => { menu.setOpen(false); onEffort(null); }} />
              {efforts.map((level) => (
                <Item
                  key={level}
                  label={EFFORT_LABELS[level]}
                  selected={effort === level}
                  onSelect={() => {
                    menu.setOpen(false);
                    onEffort(level);
                  }}
                />
              ))}
            </SubmenuRow>
          )}
          {main.length > 0 && more.length > 0 && (
            <SubmenuRow id="more" label="Mais modelos" menu={menu}>
              {more.map((m) => (
                <Item
                  key={m.value}
                  label={m.label}
                  selected={m.value === (model ?? "")}
                  disabled={!canChangeModel}
                  onSelect={() => choose(m.value)}
                />
              ))}
            </SubmenuRow>
          )}
          {!canChangeModel && <p className="chat-menu-note">O modelo muda quando o agente terminar a resposta.</p>}
        </div>
      )}
    </div>
  );
}

export function PermissionMenu({
  mode,
  onMode,
}: {
  mode: ChatPermissionMode;
  onMode: (mode: ChatPermissionMode) => void;
}) {
  const menu = useMenu();
  const current = PERMISSION_MODES.find((m) => m.value === mode) ?? PERMISSION_MODES[0];
  return (
    <div className="chat-menu-anchor" ref={menu.ref}>
      <button
        type="button"
        className={`chat-menu-trigger${mode === "bypassPermissions" ? " chat-permission-danger" : ""}`}
        aria-label="Permissões do chat"
        aria-haspopup="menu"
        aria-expanded={menu.open}
        title={current.hint}
        onClick={() => menu.setOpen(!menu.open)}
      >
        <span>{current.label}</span>
      </button>
      {menu.open && (
        <div className="chat-menu" role="menu" aria-label="Permissões">
          {PERMISSION_MODES.map((m, i) => (
            <Item
              key={m.value}
              label={m.label}
              hint={m.hint}
              selected={m.value === mode}
              shortcut={String(i + 1)}
              onSelect={() => {
                menu.setOpen(false);
                if (m.value !== mode) onMode(m.value);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
