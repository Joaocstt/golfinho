import { describe, expect, it } from "vitest";
import { moveBefore, sortByOrder } from "../src/renderer/projectOrder";

const p = (...ids: string[]) => ids.map((id) => ({ id }));

describe("ordem dos projetos na lateral", () => {
  it("segue a ordem salva; projeto novo vai para o fim", () => {
    expect(sortByOrder(p("a", "b", "c", "d"), ["c", "a"]).map((x) => x.id)).toEqual(["c", "a", "b", "d"]);
    expect(sortByOrder(p("a", "b"), ["sumiu", "b"]).map((x) => x.id)).toEqual(["b", "a"]);
  });
  it("move antes ou depois do projeto onde soltou", () => {
    expect(moveBefore(["a", "b", "c", "d"], "d", "b")).toEqual(["a", "d", "b", "c"]);
    expect(moveBefore(["a", "b", "c", "d"], "a", "c", true)).toEqual(["b", "c", "a", "d"]);
    expect(moveBefore(["a", "b"], "a", "a")).toEqual(["a", "b"]);
  });
});
