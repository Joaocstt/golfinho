import { z } from "zod";
const id = z.uuid();
const provider = z.enum(["codex", "claude", "antigravity"]);
const settings = z
  .object({
    concurrency: z.number().int().min(1).max(8),
    executables: z
      .object({
        codex: z.string().trim().min(1).max(4096),
        claude: z.string().trim().min(1).max(4096),
        antigravity: z.string().trim().min(1).max(4096),
      })
      .strict(),
    setup: z.record(id, z.string().trim().max(2000)),
    ssh: z
      .array(
        z
          .object({
            id,
            name: z.string().trim().min(1).max(80),
            host: z.string().regex(/^[A-Za-z0-9._-]{1,253}$/, "Endereço inválido."),
            user: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/, "Usuário inválido."),
            port: z.number().int().min(1).max(65535),
            identityFile: z
              .string()
              .max(4096)
              .refine((p) => p.startsWith("/"), "Use o caminho absoluto da chave.")
              .nullable(),
          })
          .strict(),
      )
      .max(100)
      .default([]),
  })
  .strict();
export const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("readClipboard") }).strict(),
  z.object({ action: z.literal("pasteImage") }).strict(),
  z.object({ action: z.literal("writeClipboard"), text: z.string().max(2*1024*1024).refine(text => Buffer.byteLength(text,"utf8") <= 2*1024*1024, "Seleção excede 2 MiB.") }).strict(),
  z.object({ action: z.literal("snapshot") }).strict(),
  z
    .object({ action: z.literal("addProject"), path: z.string().min(1).max(4096).optional() })
    .strict(),
  z.object({ action: z.literal("removeProject"), projectId: id }).strict(),
  z.object({ action: z.literal("branches"), projectId: id }).strict(),
  z.object({ action: z.literal("quota"), provider, refresh: z.boolean().optional() }).strict(),
  z.object({ action: z.literal("deleteInfo"), taskId: id }).strict(),
  z.object({ action: z.literal("deleteTask"), taskId: id }).strict(),
  z
    .object({
      action: z.literal("createTask"),
      input: z
        .object({
          projectId: id,
          adopt: z.boolean().optional(),
          // Título e instruções são opcionais: sem título, a tarefa usa o nome da branch.
          title: z.string().trim().max(200),
          prompt: z.string().trim().max(16000),
          provider,
          branch: z.string().min(1).max(200),
          base: z.string().min(1).max(200),
          remote: z.string().min(1).max(200),
          timeoutMinutes: z.number().int().min(0).max(1440),
        })
        .strict(),
    })
    .strict(),
  ...(
    [
      "queue",
      "cancel",
      "review",
      "events",
      "checks",
      "terminal",
      "publish",
      "finish",
      "activate",
      "stashPending",
      "retryStart",
    ] as const
  ).map((action) => z.object({ action: z.literal(action), taskId: id }).strict()),
  z.object({ action: z.literal("input"), taskId: id, data: z.string().max(65536) }).strict(),
  z
    .object({
      action: z.literal("resize"),
      taskId: id,
      cols: z.number().int().min(2).max(500),
      rows: z.number().int().min(2).max(200),
    })
    .strict(),
  z
    .object({ action: z.literal("readFile"), taskId: id, path: z.string().min(1).max(4096) })
    .strict(),
  z
    .object({ action: z.literal("tree"), taskId: id, path: z.string().max(4096) })
    .strict(),
  z
    .object({ action: z.literal("readTree"), taskId: id, path: z.string().min(1).max(4096) })
    .strict(),
  z.object({ action: z.literal("changes"), taskId: id }).strict(),
  z.object({ action: z.literal("changeDiff"), taskId: id, path: z.string().min(1).max(4096) }).strict(),
  z
    .object({
      action: z.literal("commitFiles"),
      taskId: id,
      paths: z.array(z.string().min(1).max(4096)).min(1).max(1000),
      message: z.string().max(5000),
      push: z.boolean(),
    })
    .strict(),
  z
    .object({
      action: z.literal("shellOpen"),
      taskId: id,
      provider: provider.optional(),
      prompt: z.string().trim().max(16000).optional(),
    })
    .strict(),
  z.object({ action: z.literal("uncommitted"), taskId: id }).strict(),
  z.object({ action: z.literal("shellInput"), shellId: id, data: z.string().max(65536) }).strict(),
  z
    .object({
      action: z.literal("shellResize"),
      shellId: id,
      cols: z.number().int().min(1).max(500),
      rows: z.number().int().min(1).max(200),
    })
    .strict(),
  z.object({ action: z.literal("shellClose"), shellId: id }).strict(),
  z
    .object({
      action: z.literal("chatSend"),
      taskId: id,
      text: z.string().max(64 * 1024),
      images: z.array(z.string().min(1).max(4096)).max(8).optional(),
    })
    .strict(),
  z.object({ action: z.literal("chatPickImages") }).strict(),
  z.object({ action: z.literal("chatImage"), path: z.string().min(1).max(4096) }).strict(),
  z
    .object({
      action: z.literal("chatDecide"),
      taskId: id,
      id,
      behavior: z.enum(["allow", "deny"]),
      always: z.boolean().optional(),
    })
    .strict(),
  z.object({ action: z.literal("chatStop"), taskId: id }).strict(),
  z.object({ action: z.literal("chatReset"), taskId: id }).strict(),
  z.object({ action: z.literal("setChatModel"), taskId: id, model: z.string().min(1).max(200).nullable() }).strict(),
  z.object({ action: z.literal("chatCompact"), taskId: id }).strict(),
  z.object({ action: z.literal("chatInterrupt"), taskId: id }).strict(),
  z.object({ action: z.literal("chatHistory"), taskId: id }).strict(),
  z.object({ action: z.literal("endSession"), taskId: id }).strict(),
  z.object({ action: z.literal("testActivate"), taskId: id }).strict(),
  z.object({ action: z.literal("testRestore"), taskId: id }).strict(),
  z.object({ action: z.literal("sshList"), connectionId: id, path: z.string().max(4096) }).strict(),
  z.object({ action: z.literal("sshTerminal"), connectionId: id }).strict(),
  z
    .object({
      action: z.literal("sshSavePassword"),
      connectionId: id,
      password: z.string().min(1).max(1024),
    })
    .strict(),
  z.object({ action: z.literal("sshForgetPassword"), connectionId: id }).strict(),
  z.object({ action: z.literal("sshRoots"), connectionId: id }).strict(),
  z.object({ action: z.literal("sshStat"), connectionId: id, path: z.string().min(1).max(4096) }).strict(),
  z
    .object({
      action: z.literal("sshWrite"),
      connectionId: id,
      path: z.string().min(1).max(4096),
      content: z.string().max(512 * 1024),
      expectedMtime: z.number().int().nonnegative(),
    })
    .strict(),
  z.object({ action: z.literal("sshRead"), connectionId: id, path: z.string().min(1).max(4096) }).strict(),
  z
    .object({ action: z.literal("shellOpenGeneral"), projectId: id.optional(), provider: provider.optional() })
    .strict(),
  z
    .object({
      action: z.literal("saveFile"),
      taskId: id,
      path: z.string().min(1).max(4096),
      content: z.string().max(2 * 1024 * 1024),
    })
    .strict(),
  z
    .object({
      action: z.literal("runCheck"),
      taskId: id,
      command: z.string().trim().min(1).max(8192),
    })
    .strict(),
  z.object({ action: z.literal("summary"), taskId: id, summary: z.string().max(16000) }).strict(),
  z.object({ action: z.literal("settings"), settings }).strict(),
]);
