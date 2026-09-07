import { Suspense } from "react";
import RunsPage from "@/features/runs/runs-page";

// The page reads `?run=<id>` to open one Run directly, so it needs the
// suspense boundary Next requires around `useSearchParams`.
export default function Page() {
  return (
    <Suspense fallback={null}>
      <RunsPage />
    </Suspense>
  );
}
