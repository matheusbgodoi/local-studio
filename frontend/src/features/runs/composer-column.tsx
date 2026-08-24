"use client";

import type { ReactNode } from "react";
import { cx } from "@/ui/utils";

export function ComposerColumn({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className="px-3 sm:px-5">
      <div
        className={cx("mx-auto w-full max-w-[calc(var(--composer-w)*0.9)] sm:w-[90%]", className)}
      >
        {children}
      </div>
    </div>
  );
}
