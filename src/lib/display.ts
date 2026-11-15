import { Color, Icon, Image } from "@raycast/api";
import type { Item } from "./triage";

export function stateIcon(item: Item): Image.ImageLike {
  switch (item.state) {
    case "blocked":
      return { source: Icon.ExclamationMark, tintColor: Color.Orange };
    case "error":
      return { source: Icon.XMarkCircle, tintColor: Color.Red };
    case "working":
      return { source: Icon.CircleProgress50, tintColor: Color.Blue };
    case "done":
      return { source: Icon.CheckCircle, tintColor: Color.Green };
    case "idle":
      return { source: Icon.Circle, tintColor: Color.SecondaryText };
    default:
      return { source: Icon.Terminal, tintColor: Color.SecondaryText };
  }
}

export function relative(date?: Date | string, now = Date.now()): string {
  if (!date) return "";
  const t = typeof date === "string" ? Date.parse(date) : date.getTime();
  const diff = t - now;
  const abs = Math.abs(diff);
  const units: [number, string][] = [
    [86_400_000, "d"],
    [3_600_000, "h"],
    [60_000, "m"],
  ];
  for (const [ms, u] of units) {
    if (abs >= ms) {
      const n = Math.floor(abs / ms);
      return diff < 0 ? `${n}${u} ago` : `in ${n}${u}`;
    }
  }
  return diff < 0 ? "just now" : "soon";
}

export function shortPath(path?: string): string | undefined {
  if (!path) return undefined;
  const home = process.env.HOME;
  return home && path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}
