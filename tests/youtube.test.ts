import { it, expect, vi } from "vitest";
vi.mock("electron", () => ({}));
import { allowedUrl } from "../src/main/youtube";

it("deixa a aba do YouTube navegar só pelo YouTube e pelo login do Google", () => {
  for (const url of [
    "https://www.youtube.com/watch?v=abc",
    "https://m.youtube.com/",
    "https://youtu.be/abc",
    "https://accounts.google.com/signin",
    "https://www.google.com.br/",
  ])
    expect(allowedUrl(url)).toBe(true);
  for (const url of [
    "http://www.youtube.com/",
    "https://youtube.com.evil.example/",
    "https://evilyoutube.com/",
    "https://github.com/",
    "javascript:alert(1)",
    "não é url",
  ])
    expect(allowedUrl(url)).toBe(false);
});
