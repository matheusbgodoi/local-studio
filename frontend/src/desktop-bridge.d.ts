interface Window {
  localStudioDesktop?: {
    openExternal?(url: string): Promise<boolean>;
    revealPath?(target: string): Promise<boolean>;
    openPath?(target: string): Promise<boolean>;
    getRuntime?(): Promise<{
      appVersion: string;
      platform: string;
      packaged: boolean;
      releaseChannel: "dev" | "stable";
      distribution: "owner-fork";
      updatePolicy: "manual-merge" | "owner-feed";
    }>;
    getUpdateStatus?(): Promise<{
      status: string;
      version?: string;
      message?: string;
      progress?: number;
    }>;
    startUpdate?(): Promise<{
      status: string;
      version?: string;
      message?: string;
      progress?: number;
    }>;
    saveTextFile?(
      request: import("../desktop/interfaces").SaveTextFileRequest,
    ): Promise<import("../desktop/interfaces").SaveTextFileResult>;
    generateSessionTitle?(
      excerpt: string,
      locale: string,
    ): Promise<import("../desktop/interfaces").SessionTitleResult>;
    getRemoteAccessInfo?(): Promise<import("../desktop/interfaces").RemoteAccessInfo>;
    copyRemoteAccessToken?(): Promise<{ ok: boolean }>;
    getKittylitterPairingJson?(): Promise<import("../desktop/interfaces").KittylitterPairingResult>;
    copyKittylitterPairingJson?(pairingJson: string): Promise<{
      ok: boolean;
      error?: string;
    }>;
  };
}
