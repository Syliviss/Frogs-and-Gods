import { initTRPC } from "@trpc/server";
import superjson from "superjson";
import type { User } from "../../drizzle/schema";
import type { TrpcContext } from "./context";

const t = initTRPC.context<TrpcContext>().create({ transformer: superjson });

export const router = t.router;
export const publicProcedure = t.procedure;

// In dev-test-bed mode there is no auth; these procedures are identical to
// publicProcedure but narrow ctx.user to User so existing router code compiles.
const castUser = t.middleware(opts =>
  opts.next({ ctx: { ...opts.ctx, user: opts.ctx.user as User } })
);

export const protectedProcedure = t.procedure.use(castUser);
export const adminProcedure = t.procedure.use(castUser);
