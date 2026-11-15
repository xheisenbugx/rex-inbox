# Rex Inbox

A Raycast extension that brings T3 Code's thread workflow to [Rex](https://www.superlogical.com/rex) panes.
Every terminal that reports a status through the
[Program Status Protocol](https://www.superlogical.com/rex/docs/build/program-status) (OSC 7501), such as
Claude Code or Codex, shows up as a thread you can triage.

## Buckets

| Bucket   | What lands there |
| -------- | ---------------- |
| Pinned   | Panes you pinned. They stay on top whatever they're doing. |
| Inbox    | Panes that need you: `blocked` (approval, question, login), `error`, or `done`/`idle` work you haven't seen. Blocked sorts first. |
| Working  | Panes whose program reports `working`. |
| Snoozed  | Hidden until the snooze ends. A snoozed pane comes back early if it becomes blocked or fails (configurable). |
| Settled  | Panes you settled or opened, plus finished work that's been quiet for the auto-settle window (default 24 h). Any new status after settling un-settles the pane. |

## Commands

- **Rex Inbox**: the list, refreshed every 3 s. Filter by bucket from the dropdown.
  - `↵` Open in Rex: hides Raycast, switches the app to the pane's session and tab, focuses the pane, and
    settles finished work.
  - Default shortcuts: `⌘E` Settle · `⌘I` Move to Inbox · `⇧⌘P` Pin/Unpin · `⌘S` Snooze · `⌥⌘S` Unsnooze ·
    `⌘O` Show Output · `⌘R` Refresh · `⇧⌘.` Copy Folder Path · `⇧⌘C` Copy Rex Pane ID.
  - Every shortcut can be changed in the command's preferences. Write combos as `cmd+shift+p`, `⌘⇧P`, or
    `ctrl opt up` (modifiers: cmd, ctrl, opt, shift), or `none` to remove one. Unreadable values fall back to the
    default, and shortcuts that Raycast reserves (⌘K, ⌘P, ⌘W…) or that clash with another action are dropped. Either
    way, a notification tells you which setting was ignored.
- **Rex Inbox Menu Bar**: inbox count in the menu bar (an alert icon when something is blocked), with
  pinned, inbox, and working panes. Click to open; right-click to settle.

## How it works

One `rex do` Lua script per refresh collects every terminal block's `program_status`, title, and working
directory across all sessions. Pins, settle times, and snoozes live in Raycast's local storage, keyed by
block ID, and are pruned when the pane goes away. Nothing is written to your terminals.

## Development

```sh
npm install
npm run dev
```

Before publishing to the Raycast Store, set `author` in `package.json` to your Raycast username.
