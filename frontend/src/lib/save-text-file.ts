export type SaveTextFileOutcome =
  | { kind: "saved"; filePath?: string }
  | { kind: "downloaded"; filename: string }
  | { kind: "canceled" }
  | { kind: "error"; message: string };

function downloadTextFile(filename: string, content: string, mimeType: string): boolean {
  if (typeof document === "undefined") return false;
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return true;
}

export async function saveTextFile(
  filename: string,
  content: string,
  mimeType = "text/plain;charset=utf-8",
): Promise<SaveTextFileOutcome> {
  const dialog =
    typeof window === "undefined" ? undefined : window.localStudioDesktop?.saveTextFile;
  if (dialog) {
    const result = await dialog({ defaultFileName: filename, content });
    if (result.ok) return { kind: "saved", filePath: result.filePath };
    if (result.canceled) return { kind: "canceled" };
    return { kind: "error", message: result.error ?? "The file could not be saved." };
  }
  return downloadTextFile(filename, content, mimeType)
    ? { kind: "downloaded", filename }
    : { kind: "error", message: "This browser cannot save files." };
}
