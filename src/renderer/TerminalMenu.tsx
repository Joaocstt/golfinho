import { useEffect } from "react";
export interface MenuItem {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  onSelect: () => void;
}
// Menu do clique direito no terminal. O xterm não tem menu próprio.
export function TerminalMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  return (
    <>
      <div
        className="ctx-backdrop"
        onMouseDown={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div className="ctx-menu" role="menu" style={{ left: x, top: y }}>
        {items.map((item) => (
          <button
            key={item.label}
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
          >
            <span>{item.label}</span>
            {item.shortcut && <kbd>{item.shortcut}</kbd>}
          </button>
        ))}
      </div>
    </>
  );
}
