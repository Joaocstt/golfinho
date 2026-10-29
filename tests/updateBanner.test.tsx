// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UpdateStatus } from "../src/shared/contracts";
import { UpdateBanner } from "../src/renderer/UpdateBanner";

afterEach(cleanup);

function api(initial: UpdateStatus = { state: "idle" }) {
  let emit: (s: UpdateStatus) => void = () => {};
  const update = {
    status: vi.fn(async () => initial),
    check: vi.fn(async () => {}),
    download: vi.fn(async () => {}),
    install: vi.fn(async () => {}),
    subscribe: vi.fn((listener: (s: UpdateStatus) => void) => ((emit = listener), () => {})),
  };
  (window as unknown as { golfinho: unknown }).golfinho = { update };
  return { update, emit: (s: UpdateStatus) => act(() => emit(s)) };
}

describe("aviso de atualização", () => {
  it("só verifica quando o usuário pede e só baixa com o clique", async () => {
    const { update, emit } = api();
    const { rerender } = render(<UpdateBanner requested={0} />);
    await act(async () => {});
    expect(update.check).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).toBeNull();

    rerender(<UpdateBanner requested={1} />);
    expect(update.check).toHaveBeenCalledTimes(1);
    emit({ state: "checking" });
    expect(screen.getByRole("status").textContent).toContain("Verificando");
    emit({ state: "available", version: "0.2.0" });
    expect(update.download).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Atualizar" }));
    expect(update.download).toHaveBeenCalledTimes(1);
    emit({ state: "ready", version: "0.2.0" });
    fireEvent.click(screen.getByRole("button", { name: "Reiniciar e atualizar" }));
    expect(update.install).toHaveBeenCalledTimes(1);
  });

  it("avisa quando já está na última versão ou quando a instalação não se atualiza", async () => {
    const { emit } = api({ state: "unsupported" });
    const { rerender } = render(<UpdateBanner requested={0} />);
    await act(async () => {});
    expect(screen.queryByRole("status")).toBeNull();
    rerender(<UpdateBanner requested={1} />);
    expect(screen.getByRole("status").textContent).toContain("não se atualiza por aqui");
    emit({ state: "latest", version: "0.1.32" });
    expect(screen.getByRole("status").textContent).toContain("versão mais recente (0.1.32)");
    fireEvent.click(screen.getByRole("button", { name: "Fechar aviso" }));
    expect(screen.queryByRole("status")).toBeNull();
  });
});
