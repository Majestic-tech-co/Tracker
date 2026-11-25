import { lazy, Suspense, useEffect, useState } from "react";
import type { WalkMapProps } from "./WalkMap";

// Leaflet touches `window` on import, so it must never load during SSR.
const WalkMap = lazy(() => import("./WalkMap").then((m) => ({ default: m.WalkMap })));

export function LazyWalkMap(props: WalkMapProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const placeholder = <div className="h-full w-full rounded-xl bg-muted" />;
  if (!mounted) return placeholder;
  return (
    <Suspense fallback={placeholder}>
      <WalkMap {...props} />
    </Suspense>
  );
}
