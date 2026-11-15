import { getPreferenceValues, LocalStorage } from "@raycast/api";
import type { ProgramState, RexPane, StatusRecord } from "./rex";

/** What the user has decided about a pane. Keyed by block ID. */
export interface PaneMark {
  pinned?: boolean;
  /** ISO time the user settled the pane. New activity after this un-settles it. */
  settledAt?: string;
  /** ISO time the pane was snoozed, and until when. */
  snoozedAt?: string;
  snoozedUntil?: string;
  /** ISO time the user moved the pane back to the inbox, restarting its auto-settle clock. */
  inboxAt?: string;
}

export type Marks = Record<string, PaneMark>;

export type Bucket = "pinned" | "inbox" | "working" | "snoozed" | "settled";

export const BUCKET_ORDER: Bucket[] = ["pinned", "inbox", "working", "snoozed", "settled"];

export const BUCKET_TITLES: Record<Bucket, string> = {
  pinned: "Pinned",
  inbox: "Inbox",
  working: "Working",
  snoozed: "Snoozed",
  settled: "Settled",
};

export interface Item {
  pane: RexPane;
  mark: PaneMark;
  bucket: Bucket;
  /** The record that decides the pane's state: the most urgent one. */
  record?: StatusRecord;
  state: ProgramState;
  updatedAt?: Date;
}

const STORAGE_KEY = "marks.v1";

export async function loadMarks(): Promise<Marks> {
  const raw = await LocalStorage.getItem<string>(STORAGE_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Marks;
  } catch {
    return {};
  }
}

export async function saveMarks(marks: Marks) {
  await LocalStorage.setItem(STORAGE_KEY, JSON.stringify(marks));
}

/** Apply a change to one pane's mark, dropping it once it holds nothing. */
export async function updateMark(blockId: string, change: (m: PaneMark) => PaneMark): Promise<Marks> {
  const marks = await loadMarks();
  const next = change({ ...(marks[blockId] ?? {}) });
  const cleaned = Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined && v !== false));
  if (Object.keys(cleaned).length === 0) delete marks[blockId];
  else marks[blockId] = cleaned as PaneMark;
  await saveMarks(marks);
  return marks;
}

/** Forget marks for panes that no longer exist, so storage doesn't grow forever. */
export async function pruneMarks(liveBlockIds: Set<string>, marks: Marks): Promise<Marks> {
  const stale = Object.keys(marks).filter((id) => !liveBlockIds.has(id));
  if (stale.length === 0) return marks;
  const next = { ...marks };
  for (const id of stale) delete next[id];
  await saveMarks(next);
  return next;
}

const URGENCY: Record<StatusRecord["state"], number> = { blocked: 5, error: 4, working: 3, done: 2, idle: 1 };

function leadingRecord(records: StatusRecord[]): StatusRecord | undefined {
  return [...records].sort(
    (a, b) => URGENCY[b.state] - URGENCY[a.state] || Date.parse(b.updated_at) - Date.parse(a.updated_at),
  )[0];
}

function latestUpdate(records: StatusRecord[]): Date | undefined {
  const t = Math.max(...records.map((r) => Date.parse(r.updated_at)).filter((n) => !Number.isNaN(n)));
  return Number.isFinite(t) ? new Date(t) : undefined;
}

interface Settings {
  autoSettleMs: number;
  wakeOnBlocked: boolean;
  includeIdle: boolean;
}

function settings(): Settings {
  const p = getPreferenceValues<Preferences>();
  const hours = Number.parseFloat(p.autoSettleHours ?? "24");
  return {
    autoSettleMs: Number.isFinite(hours) && hours > 0 ? hours * 3_600_000 : 0,
    wakeOnBlocked: p.wakeOnBlocked ?? true,
    includeIdle: p.includeIdle ?? true,
  };
}

/**
 * Sort a pane into a bucket, following T3 Code's sidebar model:
 * - Pinned panes stay on top whatever they are doing.
 * - Snoozed panes hide until their time, or until they need input again.
 * - Working panes are running on their own.
 * - Inbox holds what needs you: blocked, failed, or finished and unseen.
 * - Settled holds what you've seen, or what has been quiet long enough.
 *   Any new activity after settling brings a pane back.
 */
export function classify(pane: RexPane, mark: PaneMark, now = Date.now(), cfg = settings()): Item | undefined {
  const record = leadingRecord(pane.records);
  const state: ProgramState = record?.state ?? "none";
  const updatedAt = latestUpdate(pane.records);
  const updated = updatedAt?.getTime() ?? 0;
  const item = (bucket: Bucket): Item => ({ pane, mark, bucket, record, state, updatedAt });

  if (mark.pinned) return item("pinned");
  if (!record) return undefined;
  if (state === "idle" && !cfg.includeIdle) return undefined;

  if (mark.snoozedUntil && Date.parse(mark.snoozedUntil) > now) {
    const needsYou = state === "blocked" || state === "error";
    const changedSinceSnooze = updated > Date.parse(mark.snoozedAt ?? mark.snoozedUntil);
    if (!(cfg.wakeOnBlocked && needsYou && changedSinceSnooze)) return item("snoozed");
  }

  if (state === "working") return item("working");

  const settled = mark.settledAt !== undefined && Date.parse(mark.settledAt) >= updated;
  if (settled) return item("settled");

  if (state === "blocked" || state === "error") return item("inbox");

  // done or idle: unseen work belongs in the inbox until it goes stale.
  const lastTouched = Math.max(updated, mark.inboxAt ? Date.parse(mark.inboxAt) : 0);
  if (cfg.autoSettleMs > 0 && now - lastTouched > cfg.autoSettleMs) return item("settled");
  return item("inbox");
}

export function triage(panes: RexPane[], marks: Marks): Record<Bucket, Item[]> {
  const now = Date.now();
  const cfg = settings();
  const out: Record<Bucket, Item[]> = { pinned: [], inbox: [], working: [], snoozed: [], settled: [] };
  for (const pane of panes) {
    const item = classify(pane, marks[pane.blockId] ?? {}, now, cfg);
    if (item) out[item.bucket].push(item);
  }
  const recent = (a: Item, b: Item) => (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0);
  // Inbox: blocked first (they're stuck on you), then errors, then newest finished work.
  out.inbox.sort(
    (a, b) => URGENCY[b.state as StatusRecord["state"]] - URGENCY[a.state as StatusRecord["state"]] || recent(a, b),
  );
  out.working.sort(recent);
  out.pinned.sort(recent);
  out.snoozed.sort((a, b) => Date.parse(a.mark.snoozedUntil ?? "") - Date.parse(b.mark.snoozedUntil ?? ""));
  out.settled.sort(
    (a, b) =>
      Date.parse(b.mark.settledAt ?? b.updatedAt?.toISOString() ?? "") -
      Date.parse(a.mark.settledAt ?? a.updatedAt?.toISOString() ?? ""),
  );
  return out;
}

/** A label for the pane: its terminal title, else the folder it's in, else the block label. */
export function paneTitle(item: Item): string {
  const r = item.record;
  if (r?.title) return r.title;
  if (item.pane.title) return item.pane.title;
  if (item.pane.cwd) return item.pane.cwd.split("/").filter(Boolean).pop() ?? item.pane.cwd;
  return item.pane.blockLabel ?? item.pane.blockId;
}

export function stateLabel(item: Item): string {
  const r = item.record;
  switch (item.state) {
    case "blocked":
      return r?.kind === "permission"
        ? "Needs approval"
        : r?.kind === "question"
          ? "Has a question"
          : r?.kind === "auth"
            ? "Needs login"
            : "Blocked";
    case "error":
      return "Failed";
    case "working":
      return r?.progress !== undefined ? `Working ${r.progress}%` : "Working";
    case "done":
      return "Done";
    case "idle":
      return "Idle";
    default:
      return "No status";
  }
}
