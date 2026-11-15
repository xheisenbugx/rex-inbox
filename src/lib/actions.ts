import { closeMainWindow, getPreferenceValues, PopToRootType, showHUD } from "@raycast/api";
import { openPane } from "./rex";
import { Item, updateMark } from "./triage";

export interface SnoozeOption {
  title: string;
  until: () => Date;
}

function at(daysAhead: number, hour: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  d.setHours(hour, 0, 0, 0);
  return d;
}

export const SNOOZE_OPTIONS: SnoozeOption[] = [
  { title: "30 Minutes", until: () => new Date(Date.now() + 30 * 60_000) },
  { title: "1 Hour", until: () => new Date(Date.now() + 60 * 60_000) },
  { title: "3 Hours", until: () => new Date(Date.now() + 3 * 60 * 60_000) },
  { title: "Tomorrow Morning", until: () => at(1, 9) },
  {
    title: "Next Monday",
    until: () => {
      const day = new Date().getDay();
      return at((8 - day) % 7 || 7, 9);
    },
  },
];

const nowIso = () => new Date().toISOString();

export const settle = (id: string) =>
  updateMark(id, (m) => ({
    ...m,
    settledAt: nowIso(),
    inboxAt: undefined,
    snoozedAt: undefined,
    snoozedUntil: undefined,
  }));

export const moveToInbox = (id: string) =>
  updateMark(id, (m) => ({
    ...m,
    settledAt: undefined,
    snoozedAt: undefined,
    snoozedUntil: undefined,
    inboxAt: nowIso(),
  }));

export const togglePin = (id: string) => updateMark(id, (m) => ({ ...m, pinned: !m.pinned }));

export const snooze = (id: string, until: Date) =>
  updateMark(id, (m) => ({ ...m, snoozedAt: nowIso(), snoozedUntil: until.toISOString(), settledAt: undefined }));

export const unsnooze = (id: string) =>
  updateMark(id, (m) => ({ ...m, snoozedAt: undefined, snoozedUntil: undefined, inboxAt: nowIso() }));

/** Jump to the pane in Rex. Seeing finished work settles it, like reading an email. */
export async function open(item: Item) {
  // Hide Raycast right away so Rex comes forward without waiting on the CLI.
  await closeMainWindow({ clearRootSearch: true, popToRootType: PopToRootType.Immediate });
  try {
    await openPane(item.pane);
    const { settleOnOpen } = getPreferenceValues<Preferences>();
    if ((settleOnOpen ?? true) && (item.state === "done" || item.state === "idle") && item.bucket === "inbox") {
      await settle(item.pane.blockId);
    }
  } catch (e) {
    // Raycast's window is gone, so a toast wouldn't be seen; a HUD is.
    await showHUD(`Couldn't open pane: ${e instanceof Error ? e.message : String(e)}`);
  }
}
