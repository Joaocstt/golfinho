// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Node, type PanelNode } from "../src/renderer/PluginPanel";
import { linkOrca } from "../src/main/plugins/frame";

afterEach(cleanup);

const el = (type: string, props: Record<string, unknown> = {}, ...children: (PanelNode | string)[]): PanelNode => ({ type, props, children });

it("desenha a árvore do plugin e devolve cliques e digitação para as funções dele", () => {
  const invoke = vi.fn();
  const tree = el(
    "Tabs",
    { label: "Seções", defaultValue: "vars" },
    el("Tab", { value: "vars", label: "Vars" }, el("Stack", { gap: "sm" },
      el("Input", { label: "Nome", value: "", onChange: { $fn: 1 }, onSubmit: { $fn: 2 } }),
      el("Button", { icon: "add", onPress: { $fn: 3 } }, "Salvar variável"),
      el("Select", { label: "Ambiente", value: "b", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }], onChange: { $fn: 4 } }),
    )),
    el("Tab", { value: "hist", label: "Histórico" }, el("EmptyState", { title: "Sem histórico" })),
  );
  render(<Node node={tree} invoke={invoke} />);
  fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "baseUrl" } });
  expect(invoke).toHaveBeenCalledWith({ $fn: 1 }, "baseUrl");
  fireEvent.keyDown(screen.getByLabelText("Nome"), { key: "Enter" });
  expect(invoke).toHaveBeenCalledWith({ $fn: 2 });
  fireEvent.click(screen.getByRole("button", { name: "Salvar variável" }));
  expect(invoke).toHaveBeenCalledWith({ $fn: 3 });
  expect((screen.getByLabelText("Ambiente") as HTMLSelectElement).value).toBe("b");
  fireEvent.change(screen.getByLabelText("Ambiente"), { target: { value: "a" } });
  expect(invoke).toHaveBeenCalledWith({ $fn: 4 }, "a");
  // A aba é estado da tela: troca sem perguntar ao plugin.
  fireEvent.click(screen.getByRole("tab", { name: "Histórico" }));
  expect(screen.getByText("Sem histórico")).toBeTruthy();
});

it("o import de orca no código do painel aponta para o runtime do Golfinho", () => {
  const code = 'import { Stack, atom } from "orca";\nimport { jsx as _jsx } from "orca/jsx-runtime";\nimport "./protocol";';
  const out = linkOrca(code, "local.http-client");
  expect(out).toContain('from "golfinho-plugin://local.http-client/__golfinho/orca.js"');
  expect(out.match(/__golfinho\/orca\.js/g)).toHaveLength(2);
  expect(out).toContain('import "./protocol"');
});
