import type { Router } from "express";
import type { PluginContext } from "@termix-ssh/plugin-sdk/backend";
import { createInterfaces } from "./interfaces.js";
import { createRemote } from "./remote.js";
import { registerRoutes } from "./routes.js";
import { createService } from "./service.js";

export async function activate(ctx: PluginContext) {
  const remote = createRemote(ctx);
  registerRoutes(ctx.http.router<Router>(), ctx, {
    service: createService(remote),
    interfaces: createInterfaces(remote),
  });
  ctx.log.info("WireGuard routes mounted at /plugin-api/wireguard");
}

export async function deactivate() {
  // Everything above was registered through ctx and is disposed by core.
}
