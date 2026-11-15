import { getPreferenceValues, Keyboard } from "@raycast/api";

type Mod = "cmd" | "ctrl" | "opt" | "shift";
/** A macOS key combo. Assignable to Combo. */
export interface Combo {
  modifiers: Mod[];
  key: Keyboard.KeyEquivalent;
}

/**
 * Every rebindable action. Defaults are written out (not Combo.Common)
 * so what we document is what Raycast shows.
 */
export const SHORTCUT_ACTIONS = {
  settle: { pref: "shortcutSettle", title: "Settle", default: "cmd+e" },
  moveToInbox: { pref: "shortcutMoveToInbox", title: "Move to Inbox", default: "cmd+i" },
  pin: { pref: "shortcutPin", title: "Pin / Unpin", default: "cmd+shift+p" },
  snooze: { pref: "shortcutSnooze", title: "Snooze", default: "cmd+s" },
  unsnooze: { pref: "shortcutUnsnooze", title: "Unsnooze", default: "opt+cmd+s" },
  showOutput: { pref: "shortcutShowOutput", title: "Show Output", default: "cmd+o" },
  refresh: { pref: "shortcutRefresh", title: "Refresh", default: "cmd+r" },
  copyPath: { pref: "shortcutCopyPath", title: "Copy Folder Path", default: "cmd+shift+." },
  copyPaneId: { pref: "shortcutCopyPaneId", title: "Copy Rex Pane ID", default: "cmd+shift+c" },
} as const;

export type ShortcutAction = keyof typeof SHORTCUT_ACTIONS;

const KEYS = new Set<string>([
  ..."abcdefghijklmnopqrstuvwxyz0123456789",
  ...[".", ",", ";", "=", "+", "-", "[", "]", "{", "}", "«", "»", "(", ")", "/", "\\", "'", "`", "§", "^", "@", "$"],
  ...["return", "delete", "deleteForward", "tab", "arrowUp", "arrowDown", "arrowLeft", "arrowRight"],
  ...["pageUp", "pageDown", "home", "end", "space", "escape", "enter", "backspace"],
]);

const MODIFIER_ALIASES: Record<string, Mod> = {
  cmd: "cmd",
  command: "cmd",
  "⌘": "cmd",
  ctrl: "ctrl",
  control: "ctrl",
  "⌃": "ctrl",
  opt: "opt",
  option: "opt",
  alt: "opt",
  "⌥": "opt",
  shift: "shift",
  "⇧": "shift",
};

const KEY_ALIASES: Record<string, string> = {
  up: "arrowUp",
  down: "arrowDown",
  left: "arrowLeft",
  right: "arrowRight",
  esc: "escape",
  "↑": "arrowUp",
  "↓": "arrowDown",
  "←": "arrowLeft",
  "→": "arrowRight",
  "↵": "return",
};

// Raycast owns these in every list; an action bound to one never fires.
const RESERVED = [
  "cmd+k",
  "cmd+p",
  "cmd+w",
  "cmd+q",
  "cmd+,",
  "cmd+a",
  "cmd+escape",
  "cmd+return",
  "cmd+enter",
  "return",
  "enter",
  "escape",
];

const ORDER: Mod[] = ["ctrl", "opt", "shift", "cmd"];

function canonical(s: Combo): string {
  const mods = [...s.modifiers].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  return [...mods, s.key].join("+");
}

const RESERVED_SET = new Set(
  RESERVED.map((r) => {
    const parsed = parse(r);
    return parsed ? canonical(parsed) : r;
  }),
);

/**
 * Parse "cmd+shift+p", "⌘⇧P" or "ctrl opt up". Returns null for "none"/empty
 * (meaning: no shortcut) and undefined when the text can't be understood.
 */
export function parse(text: string): Combo | null | undefined {
  const raw = text.trim();
  if (raw === "" || raw.toLowerCase() === "none") return null;
  // Split symbol modifiers glued to the key (⌘⇧P), then on "+" or spaces, keeping a literal "+" key.
  const spaced = raw.replace(/([⌘⌃⌥⇧])/g, " $1 ");
  const parts = spaced
    .split(/\s+|(?<=\S)\+(?=\S)/)
    .map((p) => p.trim())
    .filter(Boolean);
  const modifiers = new Set<Mod>();
  let key: string | undefined;
  for (const part of parts) {
    const lower = part.toLowerCase();
    const mod = MODIFIER_ALIASES[lower] ?? MODIFIER_ALIASES[part];
    if (mod) {
      modifiers.add(mod);
      continue;
    }
    if (key !== undefined) return undefined; // two keys
    const alias = KEY_ALIASES[lower] ?? KEY_ALIASES[part];
    const candidate = alias ?? (KEYS.has(part) ? part : KEYS.has(lower) ? lower : undefined);
    // Named keys are camelCase (arrowUp), so also match them case-insensitively.
    key = candidate ?? [...KEYS].find((k) => k.toLowerCase() === lower);
    if (key === undefined) return undefined;
  }
  if (key === undefined) return undefined;
  return { modifiers: [...modifiers], key: key as Keyboard.KeyEquivalent };
}

const SYMBOLS: Record<Mod, string> = { ctrl: "⌃", opt: "⌥", shift: "⇧", cmd: "⌘" };
const KEY_SYMBOLS: Record<string, string> = {
  arrowUp: "↑",
  arrowDown: "↓",
  arrowLeft: "←",
  arrowRight: "→",
  return: "↵",
  enter: "↵",
  escape: "⎋",
  delete: "⌫",
  backspace: "⌫",
  tab: "⇥",
  space: "Space",
};

export function format(s: Combo): string {
  const mods = [...s.modifiers].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)).map((m) => SYMBOLS[m]);
  return mods.join("") + (KEY_SYMBOLS[s.key] ?? s.key.toUpperCase());
}

export interface ResolvedShortcuts {
  shortcuts: Partial<Record<ShortcutAction, Combo>>;
  /** Human-readable problems with the user's settings, to surface once. */
  problems: string[];
}

let cached: ResolvedShortcuts | undefined;

/** Read every shortcut preference, falling back to defaults for anything unusable. */
export function resolveShortcuts(): ResolvedShortcuts {
  if (cached) return cached;
  const prefs = getPreferenceValues<Record<string, string | undefined>>();
  const shortcuts: ResolvedShortcuts["shortcuts"] = {};
  const problems: string[] = [];
  const taken = new Map<string, ShortcutAction>();

  for (const [action, def] of Object.entries(SHORTCUT_ACTIONS) as [
    ShortcutAction,
    (typeof SHORTCUT_ACTIONS)[ShortcutAction],
  ][]) {
    const text = prefs[def.pref];
    let parsed = parse(text ?? def.default);
    if (parsed === undefined) {
      problems.push(`${def.title}: couldn't read “${text}”, using ${def.default}`);
      parsed = parse(def.default);
    }
    if (!parsed) continue; // explicitly disabled
    const key = canonical(parsed);
    if (RESERVED_SET.has(key)) {
      problems.push(`${def.title}: ${format(parsed)} is reserved by Raycast`);
      continue;
    }
    const clash = taken.get(key);
    if (clash) {
      problems.push(`${def.title}: ${format(parsed)} is already used by ${SHORTCUT_ACTIONS[clash].title}`);
      continue;
    }
    taken.set(key, action);
    shortcuts[action] = parsed;
  }
  cached = { shortcuts, problems };
  return cached;
}

export function shortcut(action: ShortcutAction): Combo | undefined {
  return resolveShortcuts().shortcuts[action];
}
