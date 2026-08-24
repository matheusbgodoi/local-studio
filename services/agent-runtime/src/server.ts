import { serve } from "@hono/node-server";
import { agenticRuntime } from "./agentic/service";
import { startAutomationScheduler } from "./automation-scheduler";
import { createAgentRuntimeApp } from "./http/app";
import { networkService } from "./network";

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

//
// The tunnel is a child of this process and does not die with it on its own.
// Left behind it holds the proxy port, and the next start finds the port taken
// and respawns a tunnel that cannot bind — so shutting it down is not tidiness,
// it is what keeps the next launch working. SIGTERM is what the desktop shell
// sends, so the stop has to happen before the exit rather than in the exit
// handler, where nothing asynchronous would finish.
//
const stopNetwork = async (): Promise<void> => {
  try {
    await networkService().shutdown();
  } catch {
    // a tunnel that will not stop must not keep the process alive
  }
};

process.once("exit", () => litterBridgeGateway.dispose());
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void stopNetwork().then(() => process.exit(0));
  });
}
