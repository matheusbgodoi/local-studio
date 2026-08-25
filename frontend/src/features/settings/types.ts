export interface ApiConnectionSettings {
  backendUrl: string;
  apiKey: string;
  hasApiKey: boolean;
  controllers: Array<{ url: string; name?: string; hasApiKey: boolean }>;
}

export type ConnectionStatus = "unknown" | "connected" | "error";
