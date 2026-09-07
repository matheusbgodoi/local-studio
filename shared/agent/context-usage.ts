export type RuntimeContextUsage = {
  readonly tokens: number | null;
  readonly contextWindow: number;
  readonly percent: number | null;
  readonly shouldCompact: boolean;
  readonly estimated?: boolean;
};
