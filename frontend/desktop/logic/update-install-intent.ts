import type { DesktopUpdateSnapshot } from "../types";

export type UpdateInstallAction = "check" | "download" | "wait" | "install";

export class UpdateInstallIntent {
  private requested = false;

  request(status: DesktopUpdateSnapshot["status"]): UpdateInstallAction {
    this.requested = true;
    if (status === "downloaded") {
      this.requested = false;
      return "install";
    }
    if (status === "available") return "download";
    if (status === "checking" || status === "downloading") {
      return "wait";
    }
    return "check";
  }

  shouldDownload(): boolean {
    return this.requested;
  }

  downloadCompleted(): boolean {
    if (!this.requested) return false;
    this.requested = false;
    return true;
  }

  clear(): void {
    this.requested = false;
  }
}
