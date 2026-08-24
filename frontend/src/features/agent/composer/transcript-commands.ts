import type { ChatMessage } from "@/features/agent/messages";
import {
  exportFilenameFromTitle,
  sessionToMarkdown,
} from "@/features/agent/messages/export-markdown";
import { assistantContentCopyText } from "@/features/agent/ui/timeline/activity-grouping";
import { writeClipboardText } from "@/lib/clipboard";
import { saveTextFile } from "@/lib/save-text-file";
import type {
  ComposerCommand,
  ComposerCommandOutcome,
  ComposerCommandProvider,
} from "./command-types";

const MARKDOWN_MIME = "text/markdown;charset=utf-8";

export type TranscriptCommandActions = {
  messages: () => ChatMessage[];
  title: () => string;
  notify: (text: string) => void;
};

export function lastAssistantResponseText(messages: ChatMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant") continue;
    const text = assistantContentCopyText(message.blocks ?? []);
    if (text.trim()) return text;
  }
  return "";
}

function reason(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function transcriptCommandProvider(
  actions: TranscriptCommandActions,
): ComposerCommandProvider {
  const copy = (text: string, done: string): ComposerCommandOutcome => {
    writeClipboardText(text).then(
      () => actions.notify(done),
      (error: unknown) =>
        actions.notify(`Copy failed · ${reason(error, "the clipboard is unavailable")}`),
    );
    return { kind: "handled" };
  };

  const markdown = (): { filename: string; content: string } => {
    const title = actions.title();
    return {
      filename: exportFilenameFromTitle(title),
      content: sessionToMarkdown(actions.messages(), title),
    };
  };

  const exportToFile = (): ComposerCommandOutcome => {
    const { filename, content } = markdown();
    saveTextFile(filename, content, MARKDOWN_MIME).then(
      (outcome) => {
        if (outcome.kind === "saved") actions.notify(`Exported to ${outcome.filePath ?? filename}`);
        if (outcome.kind === "downloaded") {
          actions.notify(`Exported ${outcome.filename} to your downloads.`);
        }
        if (outcome.kind === "error") actions.notify(`Export failed · ${outcome.message}`);
      },
      (error: unknown) =>
        actions.notify(`Export failed · ${reason(error, "the file could not be saved")}`),
    );
    return { kind: "handled" };
  };

  return {
    id: "transcript",
    commands: (): ComposerCommand[] => [
      {
        id: "transcript:copy",
        name: "copy",
        title: "Copy",
        description: "Copy the last response to the clipboard",
        source: "core",
        icon: "command",
        run: () => {
          const text = lastAssistantResponseText(actions.messages());
          if (!text.trim()) {
            actions.notify("Nothing to copy · this chat has no assistant response yet.");
            return { kind: "handled" };
          }
          return copy(text, "Copied the last response to the clipboard.");
        },
      },
      {
        id: "transcript:export",
        name: "export",
        title: "Export",
        description: "Choose a Markdown file or the clipboard",
        source: "core",
        icon: "command",
        run: () => ({ kind: "set-input", input: "/export:" }),
      },
      {
        id: "transcript:export-file",
        name: "export:file",
        title: "Save Markdown file",
        description: "Choose a folder and filename",
        source: "core",
        icon: "command",
        run: exportToFile,
      },
      {
        id: "transcript:export-clipboard",
        name: "export:clipboard",
        title: "Copy Markdown",
        description: "Copy the whole conversation to the clipboard",
        source: "core",
        icon: "command",
        run: () => copy(markdown().content, "Copied this chat as Markdown."),
      },
    ],
  };
}
