import { getPreferenceValues } from "@raycast/api";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { run } from "./exec";

const REX_BUNDLE_ID = "com.superlogical.rex";

const REX_CANDIDATES = [
  `${homedir()}/Library/Application Support/com.superlogical.rex/RexServer/Versions/Current/Rex Server.app/Contents/MacOS/rex`,
  "/opt/homebrew/bin/rex",
  "/usr/local/bin/rex",
  `${homedir()}/.local/bin/rex`,
];

let cachedRexPath: string | undefined;

export function rexPath(): string {
  if (cachedRexPath) return cachedRexPath;
  const { rexPath: configured } = getPreferenceValues<Preferences>();
  cachedRexPath = configured?.trim() || REX_CANDIDATES.find((p) => existsSync(p)) || "rex";
  return cachedRexPath;
}

export function rex(args: string[], timeout?: number): Promise<string> {
  return run(rexPath(), args, { timeout });
}

/** OSC 7501 states, plus "none" for a pinned pane that has reported nothing. */
export type ProgramState = "idle" | "working" | "done" | "blocked" | "error" | "none";

export interface StatusRecord {
  id?: string;
  state: Exclude<ProgramState, "none">;
  kind?: "permission" | "question" | "auth";
  progress?: number;
  app?: string;
  effective_app?: string;
  title?: string;
  msg?: string;
  updated_at: string;
}

export interface RexPane {
  sessionId: string;
  sessionLabel: string;
  blockId: string;
  blockLabel?: string;
  windowId?: string;
  windowLabel?: string;
  windowIndex?: number;
  title?: string;
  cwd?: string;
  records: StatusRecord[];
}

interface SnapshotBlock {
  block_id: string;
  label?: string;
  window_id?: string;
  window_label?: string;
  window_index?: number;
  title?: string;
  pwd?: string;
  records: StatusRecord[] | Record<string, never>;
}

interface Snapshot {
  sessions: { session_id: string; label: string; blocks: SnapshotBlock[] | Record<string, never> }[];
}

// One `rex do` call gathers every terminal's status, title and cwd, instead of
// spawning a process per pane. Empty Lua tables encode as {}, so callers must
// normalise arrays.
const SNAPSHOT_LUA = `
local out = { sessions = {} }
local list = rex.call("session.list") or { sessions = {} }
for _, s in ipairs(list.sessions or {}) do
  local sess = { session_id = s.session_id, label = s.label, blocks = {} }
  -- Session calls need this connection attached to the session.
  local attached = rex.call("session.attach", { session_id = s.session_id }) ~= nil
  local windows = {}
  local view = rex.call("session.view", { session_id = s.session_id })
  if view then
    for wi, w in ipairs(view.windows or {}) do windows[w.window_id] = { label = w.label, index = wi } end
  end
  local blocks = rex.call("session.list_blocks", { session_id = s.session_id })
  for _, b in ipairs((blocks and blocks.blocks) or {}) do
    if b.creator_name == "com.superlogical.terminal" then
      local function m(name)
        return rex.call("block.method", { session_id = s.session_id, block_id = b.block_id, method = name })
      end
      local st, t, p = m("program_status"), m("title"), m("pwd")
      local w = windows[b.window_id or ""] or {}
      table.insert(sess.blocks, {
        block_id = b.block_id, label = b.label, window_id = b.window_id,
        window_label = w.label, window_index = w.index,
        records = (st and st.records) or {},
        title = t and t.title or nil, pwd = p and p.pwd or nil,
      })
    end
  end
  if attached then rex.call("session.detach", { session_id = s.session_id }) end
  table.insert(out.sessions, sess)
end
return out
`;

function arr<T>(v: T[] | Record<string, never> | undefined): T[] {
  return Array.isArray(v) ? v : [];
}

function cwdFromPwd(pwd?: string): string | undefined {
  if (!pwd) return undefined;
  try {
    return decodeURIComponent(new URL(pwd).pathname);
  } catch {
    return pwd;
  }
}

export async function snapshot(): Promise<RexPane[]> {
  const out = await rex(["do", "-e", SNAPSHOT_LUA, "--json"], 10_000);
  const data = JSON.parse(out) as Snapshot;
  const panes: RexPane[] = [];
  for (const s of arr(data.sessions)) {
    for (const b of arr(s.blocks)) {
      panes.push({
        sessionId: s.session_id,
        sessionLabel: s.label,
        blockId: b.block_id,
        blockLabel: b.label,
        windowId: b.window_id,
        windowLabel: b.window_label,
        windowIndex: b.window_index,
        title: b.title || undefined,
        cwd: cwdFromPwd(b.pwd),
        records: arr(b.records),
      });
    }
  }
  return panes;
}

interface ClientInfo {
  client_id: string;
  info?: { kind?: string; label?: string };
  connection_state?: string;
}

async function findClient(): Promise<string> {
  const { client: preferred } = getPreferenceValues<Preferences>();
  const { clients } = JSON.parse(await rex(["client", "ls", "--json"])) as { clients: ClientInfo[] };
  const apps = (clients ?? []).filter((c) => c.info?.kind === "app" && c.connection_state !== "disconnected");
  const want = preferred?.trim();
  if (want) {
    const match = apps.find((c) => c.info?.label === want || c.client_id === want || c.client_id.endsWith(want));
    if (match) return match.client_id;
    throw new Error(`No connected Rex app matches “${want}”`);
  }
  if (apps.length === 0) throw new Error("No Rex app is connected. Open Rex and try again.");
  return apps[0].client_id;
}

/** Bring Rex to the front, show the pane's session and tab, and focus the pane. */
export async function openPane(pane: Pick<RexPane, "sessionId" | "blockId" | "windowId">) {
  await run("/usr/bin/open", ["-b", REX_BUNDLE_ID]).catch(() => undefined);
  const client = await findClient();
  const args = ["-C", client, "do", "session.select", `session_id=${pane.sessionId}`];
  if (pane.windowId) args.push(`window_id=${pane.windowId}`);
  await rex(args);
  await rex([
    "api",
    "call",
    "-s",
    pane.sessionId,
    "session.focus_block",
    JSON.stringify({ session_id: pane.sessionId, block_id: pane.blockId }),
  ]);
}

export async function capture(sessionId: string, blockId: string): Promise<string> {
  return rex(["capture", "-s", sessionId, "-b", blockId, "--trim", "--unwrap"], 5_000);
}
