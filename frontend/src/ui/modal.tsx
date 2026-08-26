"use client";

import {
  createContext,
  useContext,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { X } from "@/ui/icon-registry";
import { POPOVER_PANEL_CLASS } from "./popover";
import { cx } from "./utils";

interface UiModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  maxWidth?: string;
  returnFocusRef?: RefObject<HTMLElement | null>;
}

const UiModalTitleIdContext = createContext<string | null>(null);

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function focusableElements(dialog: HTMLDivElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector)).filter(
    (element) =>
      element.getClientRects().length > 0 && element.getAttribute("aria-hidden") !== "true",
  );
}

function UiModal({
  isOpen,
  onClose,
  children,
  className,
  maxWidth = "max-w-lg",
  returnFocusRef,
}: UiModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [callbacks] = useState(() => ({ onClose }));
  callbacks.onClose = onClose;

  useMountSubscription(() => {
    if (!isOpen) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus = document.activeElement;
    const modalRoot = dialog.parentElement;
    const inerted = Array.from(document.body.children).flatMap((element) => {
      if (element === modalRoot || !(element instanceof HTMLElement) || element.inert) return [];
      element.inert = true;
      return [element];
    });
    const previousBodyOverflow = document.body.style.overflow;
    const previousDocumentOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    const focusables = focusableElements(dialog);
    (focusables[0] ?? dialog).focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        callbacks.onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const current = focusableElements(dialog);
      if (!current.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = current[0];
      const last = current[current.length - 1];
      if (!dialog.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const containFocus = (event: FocusEvent) => {
      if (dialog.contains(event.target as Node)) return;
      const current = focusableElements(dialog);
      (current[0] ?? dialog).focus();
    };
    const blockOutsidePaste = (event: ClipboardEvent) => {
      if (dialog.contains(event.target as Node)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("focusin", containFocus, true);
    document.addEventListener("paste", blockOutsidePaste, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("focusin", containFocus, true);
      document.removeEventListener("paste", blockOutsidePaste, true);
      inerted.forEach((element) => {
        element.inert = false;
      });
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousDocumentOverflow;
      const returnTarget = returnFocusRef?.current ?? previousFocus;
      if (returnTarget instanceof HTMLElement && returnTarget.isConnected) returnTarget.focus();
    };
  }, [isOpen, returnFocusRef]);

  if (!isOpen || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[1100] flex items-center justify-center overflow-y-auto bg-black/45 px-4 py-6 backdrop-blur-[2px] sm:px-6">
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        className="absolute inset-0 z-0 cursor-default"
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cx(
          `relative z-10 max-h-[calc(100dvh-3rem)] w-full overflow-y-auto outline-none ${POPOVER_PANEL_CLASS}`,
          maxWidth,
          className,
        )}
      >
        <UiModalTitleIdContext.Provider value={titleId}>{children}</UiModalTitleIdContext.Provider>
      </div>
    </div>,
    document.body,
  );
}

interface UiModalHeaderProps {
  title: string;
  icon?: ReactNode;
  onClose?: () => void;
  actions?: ReactNode;
  closeLabel?: string;
  className?: string;
  showCloseButton?: boolean;
  closeIcon?: ReactNode;
}

function UiModalHeader({
  title,
  icon,
  onClose,
  actions,
  closeLabel = "Close",
  className,
  showCloseButton = true,
  closeIcon,
}: UiModalHeaderProps) {
  const titleId = useContext(UiModalTitleIdContext);

  return (
    <div
      className={cx(
        "flex min-h-13 items-center justify-between gap-3 border-b border-(--border) bg-(--color-popover-header) px-5 py-3.5",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        {icon}
        <h2
          id={titleId ?? undefined}
          className="text-[length:var(--fs-md)] font-medium tracking-[-0.01em] text-(--ui-fg)"
        >
          {title}
        </h2>
      </div>
      <div className="flex items-center gap-2">
        {actions}
        {showCloseButton && onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-full text-(--ui-muted) transition-colors hover:bg-(--ui-hover) hover:text-(--ui-fg) active:scale-[0.98]"
            aria-label={closeLabel}
          >
            {closeIcon ?? <X className="h-3.5 w-3.5" />}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export { UiModal, UiModalHeader };
export type { UiModalProps, UiModalHeaderProps };
