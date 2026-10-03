import { initTRPC } from "@trpc/server";
import { z } from "zod";

const t = initTRPC.create();

export const appRouter = t.router({
  health: t.procedure
    .input(z.object({ name: z.string().trim().min(1).max(80) }))
    .query(({ input }) => ({
      status: "ok" as const,
      message: `Hello, ${input.name}. The local typed API is connected.`,
    })),
});

export type AppRouter = typeof appRouter;
