// @vitest-environment jsdom
import React from "react";
import { it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import { SshPanel } from "../src/renderer/SshPanel";
import { ConfirmProvider } from "../src/renderer/ui";

afterEach(cleanup);
const connection = { id: "c1", name: "Produção", host: "172.17.107.240", user: "suporte", port: 22, identityFile: null };
function mount(passwords: string[] = []) {
  const props = {
    onSave: vi.fn(async () => {}),
    onSavePassword: vi.fn(async () => {}),
    onForgetPassword: vi.fn(async () => {}),
    onTerminal: vi.fn(),
    onExpand: vi.fn(),
    onError: vi.fn(),
  };
  render(
    <ConfirmProvider>
      <SshPanel connections={[connection]} passwords={passwords} {...props} />
    </ConfirmProvider>,
  );
  return props;
}
it("mostra o perfil num cartão, guarda a senha e remove só depois de confirmar", async () => {
  const props = mount(["c1"]);
  expect(screen.getByText("Produção")).toBeTruthy();
  expect(screen.getByText("suporte@172.17.107.240")).toBeTruthy();
  expect(screen.getByText("Senha guardada")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Conectar Produção" }));
  expect(props.onTerminal).toHaveBeenCalledWith(connection);
  fireEvent.click(screen.getByRole("button", { name: "Senha de Produção" }));
  fireEvent.change(screen.getByLabelText("Nova senha"), { target: { value: "segredo" } });
  fireEvent.click(screen.getByRole("button", { name: "Guardar no cofre" }));
  await waitFor(() => expect(props.onSavePassword).toHaveBeenCalledWith("c1", "segredo"));
  fireEvent.click(screen.getByRole("button", { name: "Remover Produção" }));
  const dialog = await screen.findByRole("alertdialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Remover perfil" }));
  await waitFor(() => expect(props.onSave).toHaveBeenCalledWith([]));
});
it("cria uma conexão nova pelo formulário", async () => {
  const props = mount();
  fireEvent.click(screen.getByRole("button", { name: "Nova conexão" }));
  fireEvent.change(screen.getByLabelText("Servidor"), { target: { value: " 10.0.0.5 " } });
  fireEvent.change(screen.getByLabelText("Usuário"), { target: { value: "root" } });
  fireEvent.click(screen.getByRole("button", { name: "Salvar conexão" }));
  await waitFor(() =>
    expect(props.onSave).toHaveBeenCalledWith([
      connection,
      expect.objectContaining({ name: "root@10.0.0.5", host: "10.0.0.5", user: "root", port: 22, identityFile: null }),
    ]),
  );
});
