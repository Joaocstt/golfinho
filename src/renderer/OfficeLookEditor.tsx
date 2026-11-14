import React, { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { createEditor, type EditorHandle } from "./office3d/editor";
import { createDeskEditor, type DeskEditorHandle } from "./office3d/deskeditor";
import type { Look } from "./office3d/avatar";
import type { DeskStyle } from "./office3d/desk3d";

export type LookTarget =
  | { kind: "personagem"; title: string; look: Look; lockBody?: boolean }
  | { kind: "mesa"; title: string; style: DeskStyle; accent: string; name: string };

// Editores do Golfinho Call (prévia 3D girando e todas as opções, inclusive os itens de apoiador),
// abertos por cima do editor do Escritório. "Aplicar" leva a escolha para a sala em edição; ela
// fica valendo quando o escritório é salvo.
export function OfficeLookEditor({
  target,
  onApply,
  onClose,
}: {
  target: LookTarget;
  onApply: (value: Look | DeskStyle) => void;
  onClose: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const handle = useRef<EditorHandle | DeskEditorHandle | null>(null);
  const [changed, setChanged] = useState(false);

  useEffect(() => {
    const box = host.current;
    if (!box) return;
    let editor: EditorHandle | DeskEditorHandle;
    try {
      editor =
        target.kind === "personagem"
          ? createEditor(target.look, () => setChanged(true), { lockBody: target.lockBody })
          : createDeskEditor(target.style, target.accent, target.name, () => setChanged(true));
    } catch {
      // Sem WebGL (ou nos testes): não há prévia para mostrar.
      return;
    }
    handle.current = editor;
    box.append(editor.element);
    return () => {
      editor.dispose();
      editor.element.remove();
      handle.current = null;
    };
  }, [target]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);

  const apply = () => {
    const h = handle.current;
    if (!h) return onClose();
    onApply("look" in h ? h.look() : h.style());
  };

  return (
    <div className="look-modal" role="dialog" aria-label={target.title} onKeyDown={(e) => e.stopPropagation()}>
      <div className="look-dialog">
        <header>
          <h3>{target.title}</h3>
          <button type="button" className="look-close" aria-label="Fechar" onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        <div className="call-ed look-body" ref={host} />
        <footer>
          <button type="button" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="primary" disabled={!changed} onClick={apply}>
            Aplicar
          </button>
        </footer>
      </div>
    </div>
  );
}
