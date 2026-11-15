import {
  Action,
  ActionPanel,
  Color,
  Detail,
  Icon,
  List,
  openExtensionPreferences,
  showToast,
  Toast,
} from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useEffect, useState } from "react";
import { moveToInbox, open, settle, snooze, SNOOZE_OPTIONS, togglePin, unsnooze } from "./lib/actions";
import { relative, shortPath, stateIcon } from "./lib/display";
import { capture } from "./lib/rex";
import { resolveShortcuts, shortcut } from "./lib/shortcuts";
import { Bucket, BUCKET_ORDER, BUCKET_TITLES, Item, paneTitle, stateLabel } from "./lib/triage";
import { useInbox } from "./lib/use-inbox";

type Filter = "all" | Bucket;

export default function Command() {
  const { data, isLoading, revalidate, error } = useInbox(3_000);
  const [filter, setFilter] = useState<Filter>("all");

  // Tell the user once if a shortcut preference was unusable, instead of silently ignoring it.
  useEffect(() => {
    const { problems } = resolveShortcuts();
    if (problems.length === 0) return;
    showToast({
      style: Toast.Style.Failure,
      title: problems.length === 1 ? "Shortcut setting ignored" : `${problems.length} shortcut settings ignored`,
      message: problems.join("\n"),
      primaryAction: { title: "Open Preferences", onAction: () => openExtensionPreferences() },
    });
  }, []);

  const buckets = filter === "all" ? BUCKET_ORDER : [filter];
  const total = data ? BUCKET_ORDER.reduce((n, b) => n + data[b].length, 0) : 0;

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder="Search panes by title, message, session, or folder"
      searchBarAccessory={
        <List.Dropdown tooltip="View" storeValue onChange={(v) => setFilter(v as Filter)}>
          <List.Dropdown.Item title="All" value="all" icon={Icon.List} />
          {BUCKET_ORDER.map((b) => (
            <List.Dropdown.Item
              key={b}
              title={`${BUCKET_TITLES[b]}${data ? ` (${data[b].length})` : ""}`}
              value={b}
              icon={BUCKET_ICONS[b]}
            />
          ))}
        </List.Dropdown>
      }
    >
      {error && !data ? (
        <List.EmptyView
          icon={Icon.Warning}
          title="Couldn't reach Rex"
          description={error.message}
          actions={
            <ActionPanel>
              <Action title="Retry" icon={Icon.ArrowClockwise} onAction={revalidate} />
            </ActionPanel>
          }
        />
      ) : (
        <List.EmptyView
          icon={Icon.Tray}
          title={total === 0 ? "Nothing reporting" : "Inbox zero"}
          description={
            total === 0
              ? "Panes appear here when their program reports a status (OSC 7501), like Claude Code or Codex."
              : "Nothing in this view."
          }
        />
      )}
      {data &&
        buckets.map((b) => (
          <List.Section key={b} title={BUCKET_TITLES[b]} subtitle={data[b].length ? String(data[b].length) : undefined}>
            {data[b].map((item) => (
              <PaneItem key={item.pane.blockId} item={item} onChange={revalidate} />
            ))}
          </List.Section>
        ))}
    </List>
  );
}

const BUCKET_ICONS: Record<Bucket, Icon> = {
  pinned: Icon.Pin,
  inbox: Icon.Tray,
  working: Icon.CircleProgress50,
  snoozed: Icon.Clock,
  settled: Icon.CheckCircle,
};

function PaneItem({ item, onChange }: { item: Item; onChange: () => void }) {
  const { pane, record, mark } = item;
  const title = paneTitle(item);
  const accessories: List.Item.Accessory[] = [];
  if (item.bucket === "pinned" || mark.pinned) accessories.push({ icon: Icon.Pin, tooltip: "Pinned" });
  if (item.bucket === "snoozed" && mark.snoozedUntil) {
    accessories.push({ icon: Icon.Clock, text: relative(mark.snoozedUntil), tooltip: "Snoozed until" });
  }
  accessories.push({ tag: { value: pane.sessionLabel, color: Color.Purple }, tooltip: "Session" });
  if (record?.effective_app) accessories.push({ text: record.effective_app, tooltip: "Program" });
  accessories.push({ text: relative(item.updatedAt), tooltip: item.updatedAt?.toLocaleString() });

  const keywords = [pane.sessionLabel, pane.windowLabel, pane.cwd, record?.effective_app, stateLabel(item)].filter(
    (k): k is string => Boolean(k),
  );

  const run = (fn: () => Promise<unknown>, message: string) => async () => {
    await fn();
    onChange();
    await showToast({ style: Toast.Style.Success, title: message });
  };

  const id = pane.blockId;
  return (
    <List.Item
      icon={{ value: stateIcon(item), tooltip: stateLabel(item) }}
      title={title}
      subtitle={record?.msg ?? stateLabel(item)}
      keywords={keywords}
      accessories={accessories}
      actions={
        <ActionPanel title={title}>
          <ActionPanel.Section>
            <Action
              title="Open in Rex"
              icon={Icon.Terminal}
              onAction={async () => {
                await open(item);
                onChange();
              }}
            />
            <Action.Push
              title="Show Output"
              icon={Icon.Text}
              shortcut={shortcut("showOutput")}
              target={<PaneOutput item={item} />}
            />
          </ActionPanel.Section>
          <ActionPanel.Section title="Triage">
            {item.bucket === "settled" ? (
              <Action
                title="Move to Inbox"
                icon={Icon.Tray}
                shortcut={shortcut("moveToInbox")}
                onAction={run(() => moveToInbox(id), "Moved to inbox")}
              />
            ) : (
              <Action
                title="Settle"
                icon={Icon.CheckCircle}
                shortcut={shortcut("settle")}
                onAction={run(() => settle(id), "Settled")}
              />
            )}
            <Action
              title={mark.pinned ? "Unpin" : "Pin"}
              icon={mark.pinned ? Icon.PinDisabled : Icon.Pin}
              shortcut={shortcut("pin")}
              onAction={run(() => togglePin(id), mark.pinned ? "Unpinned" : "Pinned")}
            />
            {mark.snoozedUntil && Date.parse(mark.snoozedUntil) > Date.now() ? (
              <Action
                title="Unsnooze"
                icon={Icon.Alarm}
                shortcut={shortcut("unsnooze")}
                onAction={run(() => unsnooze(id), "Back in inbox")}
              />
            ) : null}
            <ActionPanel.Submenu title="Snooze" icon={Icon.Clock} shortcut={shortcut("snooze")}>
              {SNOOZE_OPTIONS.map((o) => (
                <Action
                  key={o.title}
                  title={o.title}
                  onAction={() => {
                    const until = o.until();
                    return run(() => snooze(id, until), `Snoozed until ${until.toLocaleString()}`)();
                  }}
                />
              ))}
            </ActionPanel.Submenu>
          </ActionPanel.Section>
          <ActionPanel.Section>
            <Action icon={Icon.ArrowClockwise} title="Refresh" shortcut={shortcut("refresh")} onAction={onChange} />
            {pane.cwd ? (
              <Action.CopyToClipboard title="Copy Folder Path" content={pane.cwd} shortcut={shortcut("copyPath")} />
            ) : null}
            {record?.msg ? <Action.CopyToClipboard title="Copy Status Message" content={record.msg} /> : null}
            <Action.CopyToClipboard title="Copy Rex Pane ID" content={pane.blockId} shortcut={shortcut("copyPaneId")} />
          </ActionPanel.Section>
        </ActionPanel>
      }
    />
  );
}

function PaneOutput({ item }: { item: Item }) {
  const { pane } = item;
  const { data, isLoading, revalidate } = usePromise(capture, [pane.sessionId, pane.blockId]);
  const tail = (data ?? "").split("\n").slice(-200).join("\n").replace(/```/g, "ˋˋˋ");
  return (
    <Detail
      isLoading={isLoading}
      navigationTitle={paneTitle(item)}
      markdown={`\`\`\`\n${tail}\n\`\`\``}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.TagList title="Status">
            <Detail.Metadata.TagList.Item text={stateLabel(item)} />
          </Detail.Metadata.TagList>
          {item.record?.msg ? <Detail.Metadata.Label title="Message" text={item.record.msg} /> : null}
          <Detail.Metadata.Label title="Session" text={pane.sessionLabel} />
          {pane.windowLabel ? <Detail.Metadata.Label title="Tab" text={pane.windowLabel} /> : null}
          {pane.cwd ? <Detail.Metadata.Label title="Folder" text={shortPath(pane.cwd)} /> : null}
          {item.record?.effective_app ? (
            <Detail.Metadata.Label title="Program" text={item.record.effective_app} />
          ) : null}
          <Detail.Metadata.Label title="Updated" text={item.updatedAt?.toLocaleString() ?? "—"} />
        </Detail.Metadata>
      }
      actions={
        <ActionPanel>
          <Action title="Open in Rex" icon={Icon.Terminal} onAction={() => open(item)} />
          <Action title="Refresh" icon={Icon.ArrowClockwise} shortcut={shortcut("refresh")} onAction={revalidate} />
        </ActionPanel>
      }
    />
  );
}
