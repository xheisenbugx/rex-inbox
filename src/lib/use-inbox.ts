import { useCachedPromise } from "@raycast/utils";
import { useEffect } from "react";
import { snapshot } from "./rex";
import { loadMarks, pruneMarks, triage } from "./triage";

async function load() {
  const [panes, marks] = await Promise.all([snapshot(), loadMarks()]);
  const live = await pruneMarks(new Set(panes.map((p) => p.blockId)), marks);
  return triage(panes, live);
}

/** Rex panes sorted into buckets, refreshed every few seconds while the view is open. */
export function useInbox(pollMs?: number) {
  const result = useCachedPromise(load, [], { keepPreviousData: true });
  const { revalidate } = result;
  useEffect(() => {
    if (!pollMs) return;
    const timer = setInterval(revalidate, pollMs);
    return () => clearInterval(timer);
  }, [pollMs, revalidate]);
  return result;
}
