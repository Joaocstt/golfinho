import React, { createContext, forwardRef, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, Info } from "lucide-react";

// Componentes base da interface. Usam só as classes ui-* e os tokens de cor do style.css, e
// zeram as margens dos estilos globais de formulário, que foram feitos para os modais antigos.
// Telas novas devem usar estes componentes em vez de estilizar <button>, <input> e <select>.

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  icon?: React.ReactNode;
};
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", icon, className, children, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={`ui-button ui-button--${variant} ui-button--${size}${className ? ` ${className}` : ""}`}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
});

export function Field({
  label,
  hint,
  error,
  htmlFor,
  className,
  children,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  htmlFor?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={"ui-field" + (className ? ` ${className}` : "")}>
      <label className="ui-field-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? <small className="ui-field-error">{error}</small> : hint ? <small className="ui-field-hint">{hint}</small> : null}
    </div>
  );
}

export const TextInput = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function TextInput(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={"ui-input" + (className ? ` ${className}` : "")} {...props} />;
});

export const TextArea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function TextArea({ className, ...props }, ref) {
    return <textarea ref={ref} className={"ui-input ui-textarea" + (className ? ` ${className}` : "")} {...props} />;
  },
);

// <select> nativo com a aparência do app: mantém teclado, leitores de tela e o FormData.
export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...props },
  ref,
) {
  return (
    <span className={"ui-select" + (className ? ` ${className}` : "")}>
      <select ref={ref} {...props}>
        {children}
      </select>
      <ChevronDown size={14} aria-hidden="true" />
    </span>
  );
});

export function Switch({
  checked,
  onChange,
  labelledBy,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  labelledBy?: string;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : label}
      disabled={disabled}
      className={"ui-switch" + (checked ? " on" : "")}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

// Escolha única em botões lado a lado (radiogroup), com setas do teclado.
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
}: {
  value: T;
  options: { value: T; label: React.ReactNode; icon?: React.ReactNode; disabled?: boolean; title?: string }[];
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div
      className={"ui-segmented" + (className ? ` ${className}` : "")}
      role="radiogroup"
      aria-label={label}
      onKeyDown={(e) => {
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
        e.preventDefault();
        const enabled = options.filter((o) => !o.disabled);
        const index = enabled.findIndex((o) => o.value === value);
        const next = enabled[(index + (e.key === "ArrowRight" ? 1 : enabled.length - 1)) % enabled.length];
        if (!next) return;
        onChange(next.value);
        e.currentTarget.querySelector<HTMLButtonElement>(`[data-value="${next.value}"]`)?.focus();
      }}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          data-value={o.value}
          aria-checked={value === o.value}
          tabIndex={value === o.value ? 0 : -1}
          disabled={o.disabled}
          title={o.title}
          className={value === o.value ? "active" : ""}
          onClick={() => onChange(o.value)}
        >
          {o.icon}
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  );
}

export function Card({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={"ui-card" + (className ? ` ${className}` : "")} {...props}>
      {children}
    </div>
  );
}

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "success" | "warning" | "danger" | "brand";
  children: React.ReactNode;
}) {
  return <span className={`ui-badge ui-badge--${tone}`}>{children}</span>;
}

// Confirmação dentro do app, no lugar do window.confirm: título, explicação e um botão que diz
// o que vai acontecer. `await confirm({...})` devolve true só quando a pessoa confirma.
export interface ConfirmOptions {
  title: string;
  message?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
}
type Confirm = (options: ConfirmOptions) => Promise<boolean>;
const ConfirmContext = createContext<Confirm | null>(null);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null);
  const confirm = useCallback<Confirm>(
    (options) =>
      new Promise<boolean>((resolve) => {
        setPending((current) => {
          // Uma pergunta por vez: a anterior, se houver, conta como cancelada.
          current?.resolve(false);
          return { ...options, resolve };
        });
      }),
    [],
  );
  const finish = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && <ConfirmDialog options={pending} onFinish={finish} />}
    </ConfirmContext.Provider>
  );
}

// Fora do provedor (testes de componentes isolados), cai no window.confirm.
export function useConfirm(): Confirm {
  const context = useContext(ConfirmContext);
  return (
    context ??
    (async (options) =>
      window.confirm([options.title, typeof options.message === "string" ? options.message : ""].filter(Boolean).join("\n\n")))
  );
}

function ConfirmDialog({ options, onFinish }: { options: ConfirmOptions; onFinish: (ok: boolean) => void }) {
  const confirmButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const danger = options.tone === "danger";
  useEffect(() => {
    // Em ação destrutiva, o foco começa em Cancelar: Enter por engano não apaga nada.
    (danger ? cancelButton : confirmButton).current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onFinish(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [danger, onFinish]);
  return (
    <div className="ui-dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onFinish(false)}>
      <div
        className={"ui-dialog" + (danger ? " danger" : "")}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="ui-dialog-title"
        aria-describedby={options.message ? "ui-dialog-message" : undefined}
      >
        <div className="ui-dialog-icon" aria-hidden="true">
          {danger ? <AlertTriangle size={18} /> : <Info size={18} />}
        </div>
        <div className="ui-dialog-body">
          <h2 id="ui-dialog-title">{options.title}</h2>
          {options.message && (
            <div id="ui-dialog-message" className="ui-dialog-message">
              {options.message}
            </div>
          )}
        </div>
        <div className="ui-dialog-actions">
          <Button ref={cancelButton} onClick={() => onFinish(false)}>
            {options.cancelLabel ?? "Cancelar"}
          </Button>
          <Button ref={confirmButton} variant={danger ? "danger" : "primary"} onClick={() => onFinish(true)}>
            {options.confirmLabel ?? "Confirmar"}
          </Button>
        </div>
      </div>
    </div>
  );
}
