// @vitest-environment jsdom
import React from "react";
import { it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { ConfirmProvider, useConfirm } from "../src/renderer/ui";

afterEach(cleanup);
function Probe({ onResult }: { onResult: (ok: boolean) => void }) {
  const confirm = useConfirm();
  return (
    <button
      onClick={async () =>
        onResult(await confirm({ title: "Excluir a nota?", message: "Não dá para desfazer.", confirmLabel: "Excluir", tone: "danger" }))
      }
    >
      pedir
    </button>
  );
}
function mount() {
  const results: boolean[] = [];
  render(
    <ConfirmProvider>
      <Probe onResult={(ok) => results.push(ok)} />
    </ConfirmProvider>,
  );
  return results;
}
it("mostra título, mensagem e o botão da ação, com foco em Cancelar quando é destrutiva", async () => {
  const results = mount();
  fireEvent.click(screen.getByText("pedir"));
  const dialog = await screen.findByRole("alertdialog", { name: "Excluir a nota?" });
  expect(dialog.textContent).toContain("Não dá para desfazer.");
  expect(document.activeElement?.textContent).toBe("Cancelar");
  fireEvent.click(screen.getByRole("button", { name: "Excluir" }));
  await waitFor(() => expect(results).toEqual([true]));
  expect(screen.queryByRole("alertdialog")).toBeNull();
});
it("Esc e Cancelar respondem não", async () => {
  const results = mount();
  fireEvent.click(screen.getByText("pedir"));
  await screen.findByRole("alertdialog");
  fireEvent.keyDown(window, { key: "Escape" });
  await waitFor(() => expect(results).toEqual([false]));
  fireEvent.click(screen.getByText("pedir"));
  fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }));
  await waitFor(() => expect(results).toEqual([false, false]));
});
