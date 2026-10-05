import { initTRPC, TRPCError } from "@trpc/server";
import { z } from "zod";
import { RepositoryError } from "../repository/types";
import { HISTORY_CHUNK_SIZE } from "../repository/limits";
import type { RepositoryReader } from "../repository/types";

const t = initTRPC.context<{ reader: () => Promise<RepositoryReader> }>().create();
const revision = z.string().min(1).max(1024).refine(value => !value.startsWith("-") && !/[\x00-\x20\x7f]/.test(value), "Expected a non-option revision.");
const objectId = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
const path = z.string().min(1).max(8192).refine(value => !value.startsWith("/") && !value.includes("\0") && !value.split("/").some(part => !part || part === "." || part === ".."), "Expected a repository-relative path.");

const repositoryProcedure = t.procedure.use(async ({ ctx, next }) =>
  next({ ctx: { reader: await read(ctx.reader) } }),
);

async function read<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof RepositoryError) {
      const code = error.code === "INVALID_INPUT" ? "BAD_REQUEST"
        : error.code === "REVISION_NOT_FOUND" || error.code === "NOT_A_REPOSITORY" ? "NOT_FOUND"
        : error.code === "BUSY" ? "TOO_MANY_REQUESTS"
        : error.code === "CANCELLED" ? "CLIENT_CLOSED_REQUEST" : "INTERNAL_SERVER_ERROR";
      throw new TRPCError({ code, message: error.message, cause: error });
    }
    throw error;
  }
}

export const appRouter = t.router({
  metadata: repositoryProcedure.query(({ ctx, signal }) => read(() => ctx.reader.metadata(signal))),
  references: repositoryProcedure.query(({ ctx, signal }) => read(() => ctx.reader.references(signal))),
  history: repositoryProcedure.input(z.object({
    revision: revision.optional(),
    limit: z.number().int().min(1).max(HISTORY_CHUNK_SIZE).optional(),
    cursor: z.object({ tips: z.array(objectId).max(4096), offset: z.number().int().min(0).max(1_000_000) }).optional(),
  }).optional()).query(({ ctx, input, signal }) => read(() => ctx.reader.history(input, signal))),
  commit: repositoryProcedure.input(z.object({ revision })).query(({ ctx, input, signal }) => read(() => ctx.reader.commit(input.revision, signal))),
  diff: repositoryProcedure.input(z.object({ revision, path: path.optional() })).query(({ ctx, input, signal }) => read(() => ctx.reader.diff(input.revision, input.path, signal))),
  health: t.procedure
    .input(z.object({ name: z.string().trim().min(1).max(80) }))
    .query(({ input }) => ({
      status: "ok" as const,
      message: `Hello, ${input.name}. The local typed API is connected.`,
    })),
});

export type AppRouter = typeof appRouter;
