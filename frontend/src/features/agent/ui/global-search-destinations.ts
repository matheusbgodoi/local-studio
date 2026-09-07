export type GlobalSearchDestination = {
  href: string;
  label: string;
  keywords: string;
  description: string;
};

export const GLOBAL_SEARCH_DESTINATIONS: GlobalSearchDestination[] = [
  [
    "/",
    "Status",
    "dashboard controller gpu metrics energy throughput",
    "Live controller and hardware status.",
  ],
  [
    "/models",
    "Models",
    "model library local served downloads",
    "Models reported by the active controller.",
  ],
  [
    "/runs",
    "Runs",
    "durable tasks agents activity progress",
    "Durable goals, tasks, agents, and activity.",
  ],
  [
    "/agent/automations",
    "Automations",
    "schedule cron recurring workflows",
    "Scheduled and manual automations.",
  ],
  [
    "/configure",
    "Configure",
    "workspace controller overview",
    "Workspace capabilities and controller tools.",
  ],
  [
    "/configure?section=integrations#integrations",
    "Integrations",
    "plugins connectors mcp accounts skills",
    "Plugins, connectors, accounts, and skills.",
  ],
  [
    "/configure?section=server#server",
    "Server",
    "health runtime logs api docs controller",
    "Controller health, runtime details, and diagnostics.",
  ],
  [
    "/agent",
    "Workbench",
    "agent chat projects browser terminal tools files",
    "Project-aware conversations and tools.",
  ],
  [
    "/usage",
    "Usage",
    "tokens requests analytics efficiency sessions",
    "Token, request, and model usage analytics.",
  ],
  ["/settings", "Settings", "preferences configuration", "Application and controller preferences."],
  [
    "/settings#profile",
    "Profile & phone",
    "identity avatar mobile pairing phone",
    "Identity and mobile access.",
  ],
  [
    "/settings#connection",
    "General settings",
    "controller connection api access advanced",
    "Active controller and connection settings.",
  ],
  [
    "/settings#system",
    "System settings",
    "engines services storage hardware compatibility",
    "Engines, services, storage, and hardware.",
  ],
  [
    "/settings#appearance",
    "Appearance",
    "theme typography colors scale",
    "Theme, typography, and interface scale.",
  ],
  [
    "/settings#terminal",
    "Shortcuts",
    "keyboard hotkey dictation terminal quick panel",
    "Global, dictation, and terminal shortcuts.",
  ],
  [
    "/settings#archive",
    "Archived chats",
    "archive restore delete conversations",
    "Conversations hidden from the project list.",
  ],
  [
    "/settings#setup",
    "Setup",
    "prerequisites first run checks",
    "Local prerequisites and first-run checks.",
  ],
].map(([href, label, keywords, description]) => ({ href, label, keywords, description }));
