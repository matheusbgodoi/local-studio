"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import type { ToolBlock } from "@/features/agent/messages";
import { Button, UiModal, UiModalHeader } from "@/ui";
import { Check, Copy, Download, RefreshCw, X } from "@/ui/icon-registry";

export type GeneratedImageDecision = "approve" | "reject" | "regenerate";

export type GeneratedImageDecisionHandler = (
  decision: GeneratedImageDecision,
  block: ToolBlock,
  selection: { imageIndex: number; imageCount: number },
  note?: string,
) => void | Promise<void>;

export function isImageGenerationTool(block: ToolBlock): boolean {
  return /(?:run_workflow(?:_stream)?|generate_image|transform_image|inpaint_image|upscale_image)$/i.test(
    block.name,
  );
}

function dimensionsFrom(value: unknown): { width: number; height: number } | null {
  const queue: unknown[] = [value];
  let visited = 0;
  while (queue.length > 0 && visited < 500) {
    const current = queue.shift();
    visited += 1;
    if (!current || typeof current !== "object") continue;
    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }
    const record = current as Record<string, unknown>;
    const width = Number(record.width);
    const height = Number(record.height);
    if (
      Number.isFinite(width) &&
      Number.isFinite(height) &&
      width >= 64 &&
      height >= 64 &&
      width <= 16_384 &&
      height <= 16_384
    ) {
      return { width, height };
    }
    queue.push(...Object.values(record));
  }
  return null;
}

function blockDimensions(block: ToolBlock): { width: number; height: number } {
  const direct = dimensionsFrom(block.args);
  if (direct) return direct;
  if (block.argsText) {
    try {
      const parsed = dimensionsFrom(JSON.parse(block.argsText) as unknown);
      if (parsed) return parsed;
    } catch {
      return { width: 1, height: 1 };
    }
  }
  return { width: 1, height: 1 };
}

function imageUrl(image: { data: string; mimeType: string }): string {
  return `data:${image.mimeType};base64,${image.data}`;
}

async function copyImage(url: string): Promise<void> {
  const response = await fetch(url);
  const blob = await response.blob();
  if (typeof ClipboardItem === "undefined") throw new Error("Image copy is unavailable");
  await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
}

function downloadImage(url: string, mimeType: string): void {
  const extension = mimeType.split("/")[1]?.replace("jpeg", "jpg") || "png";
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `crias-ai-${Date.now()}.${extension}`;
  anchor.click();
}

export function GeneratedImageBlock({
  block,
  onDecision,
}: {
  block: ToolBlock;
  onDecision?: GeneratedImageDecisionHandler;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [note, setNote] = useState("");
  const [pending, setPending] = useState<GeneratedImageDecision | null>(null);
  const [copied, setCopied] = useState(false);
  const [decisionStatus, setDecisionStatus] = useState<string | null>(null);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const dimensions = useMemo(() => blockDimensions(block), [block]);
  const aspectRatio = `${dimensions.width} / ${dimensions.height}`;
  const images = block.resultImages ?? [];

  const decide = async (decision: GeneratedImageDecision, decisionNote?: string) => {
    if (!onDecision || pending) return;
    setPending(decision);
    setDecisionError(null);
    try {
      await onDecision(
        decision,
        block,
        { imageIndex: activeIndex, imageCount: images.length },
        decisionNote,
      );
      setDecisionStatus(
        decision === "approve"
          ? "Approval queued"
          : decision === "reject"
            ? "Rejection queued"
            : "Regeneration queued",
      );
      if (decision === "regenerate") {
        setRegenerating(false);
        setNote("");
      }
    } catch (error) {
      setDecisionError(error instanceof Error ? error.message : "The image action failed");
    } finally {
      setPending(null);
    }
  };

  if (images.length === 0) {
    return (
      <section className="generated-image-shell" aria-live="polite">
        <div className="generated-image-loading" style={{ aspectRatio }}>
          <span className="generated-image-orbit" aria-hidden="true" />
          <div className="text-center">
            <div className="text-[length:var(--fs-base)] font-medium text-(--fg)">
              {block.status === "error" ? "Image generation failed" : "Generating image"}
            </div>
            <div className="mt-1 text-[length:var(--fs-sm)] text-(--dim)">
              {dimensions.width === 1
                ? "Preparing the canvas"
                : `${dimensions.width} × ${dimensions.height}`}
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="generated-image-shell">
      <div className={images.length > 1 ? "grid grid-cols-2 gap-2" : undefined}>
        {images.map((image, index) => {
          const url = imageUrl(image);
          return (
            <button
              key={`${block.id}-${index}`}
              type="button"
              className={`generated-image-preview ${
                images.length > 1 && activeIndex === index ? "ring-2 ring-(--accent)" : ""
              }`}
              style={{ aspectRatio }}
              onClick={() => {
                setActiveIndex(index);
                setLightboxIndex(index);
              }}
              aria-label={`Open generated image ${index + 1}`}
            >
              <Image
                unoptimized
                src={url}
                alt="Generated result"
                width={dimensions.width}
                height={dimensions.height}
              />
            </button>
          );
        })}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {onDecision ? (
          <>
            <Button
              size="sm"
              variant="secondary"
              disabled={Boolean(pending)}
              icon={<Check className="h-3.5 w-3.5" />}
              onClick={() => void decide("approve")}
            >
              Approve
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={Boolean(pending)}
              icon={<X className="h-3.5 w-3.5" />}
              onClick={() => void decide("reject")}
            >
              Reject
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={Boolean(pending)}
              icon={<RefreshCw className="h-3.5 w-3.5" />}
              onClick={() => setRegenerating((value) => !value)}
            >
              Regenerate
            </Button>
          </>
        ) : null}
        <span className="flex-1" />
        <Button
          size="sm"
          variant="icon"
          aria-label="Copy image"
          onClick={() =>
            void copyImage(imageUrl(images[activeIndex]!)).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1_500);
            })
          }
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
        <Button
          size="sm"
          variant="icon"
          aria-label="Download image"
          onClick={() =>
            downloadImage(imageUrl(images[activeIndex]!), images[activeIndex]!.mimeType)
          }
        >
          <Download className="h-3.5 w-3.5" />
        </Button>
      </div>

      {images.length > 1 ? (
        <p className="mt-1.5 text-[length:var(--fs-sm)] text-(--dim)">
          Image {activeIndex + 1} of {images.length} selected
        </p>
      ) : null}
      {decisionStatus ? (
        <p className="mt-1.5 text-[length:var(--fs-sm)] text-(--accent)" role="status">
          {decisionStatus}
        </p>
      ) : null}
      {decisionError ? (
        <p className="mt-1.5 text-[length:var(--fs-sm)] text-(--danger)" role="alert">
          {decisionError}
        </p>
      ) : null}

      {regenerating ? (
        <form
          className="mt-2 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void decide("regenerate", note.trim() || undefined);
          }}
        >
          <input
            autoFocus
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Optional change; blank uses a new seed"
            className="h-8 min-w-0 flex-1 rounded-lg border border-(--border) bg-(--color-input) px-3 text-[length:var(--fs-sm)] text-(--fg) outline-none placeholder:text-(--dim) focus:border-(--accent)"
          />
          <Button size="sm" type="submit" disabled={Boolean(pending)}>
            Generate
          </Button>
        </form>
      ) : null}

      <UiModal
        isOpen={lightboxIndex !== null}
        onClose={() => setLightboxIndex(null)}
        maxWidth="max-w-6xl"
        className="generated-image-lightbox overflow-hidden"
      >
        <UiModalHeader
          title="Generated image"
          onClose={() => setLightboxIndex(null)}
          actions={
            lightboxIndex !== null ? (
              <Button
                size="sm"
                variant="ghost"
                icon={<Download className="h-3.5 w-3.5" />}
                onClick={() => {
                  const image = images[lightboxIndex];
                  if (image) downloadImage(imageUrl(image), image.mimeType);
                }}
              >
                Download
              </Button>
            ) : null
          }
        />
        {lightboxIndex !== null && images[lightboxIndex] ? (
          <div className="flex max-h-[calc(100dvh-8rem)] items-center justify-center overflow-auto bg-black/35 p-3">
            <Image
              unoptimized
              src={imageUrl(images[lightboxIndex]!)}
              alt="Generated result enlarged"
              width={dimensions.width}
              height={dimensions.height}
              className="max-h-[calc(100dvh-10rem)] max-w-full rounded-lg object-contain"
            />
          </div>
        ) : null}
      </UiModal>
    </section>
  );
}
