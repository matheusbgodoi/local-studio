import { serve } from "@hono/node-server";
import { agenticRuntime } from "./agentic/service";
import { startAutomationScheduler } from "./automation-scheduler";
import { createAgentRuntimeApp } from "./http/app";

startAutomationScheduler();

//
// Constructed at boot, not on first request: this is what reconciles Runs the
// last process left unfinished, and what publishes the control surface the
// model's tools reach for. A chat session that started before it existed could
// not create a Run.
//
agenticRuntime();

const { app, litterBridgeGateway } = createAgentRuntimeApp();
const port = Number(process.env.PORT) > 0 ? Number(process.env.PORT) : 8081;

serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, (info) => {
  litterBridgeGateway.publishMetadata(info.port);
  console.log(
    `[agent-runtime] listening on http://127.0.0.1:${info.port} (pid ${process.pid}, node ${process.version})`,
  );
});

process.once("exit", () => litterBridgeGateway.dispose());
process.once("SIGINT", () => process.exit(0));
process.once("SIGTERM", () => process.exit(0));
