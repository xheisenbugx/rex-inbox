import { Icon, launchCommand, LaunchType, MenuBarExtra, openExtensionPreferences, Keyboard } from "@raycast/api";
import { open, settle } from "./lib/actions";
import { relative, stateIcon } from "./lib/display";
import { Bucket, BUCKET_TITLES, Item, paneTitle } from "./lib/triage";
import { useInbox } from "./lib/use-inbox";

const SHOWN: Bucket[] = ["pinned", "inbox", "working"];

export default function Command() {
  const { data, isLoading, revalidate } = useInbox();
  const inbox = data?.inbox ?? [];
  const blocked = inbox.filter((i) => i.state === "blocked" || i.state === "error").length;

  return (
    <MenuBarExtra
      isLoading={isLoading}
      icon={blocked > 0 ? Icon.ExclamationMark : inbox.length > 0 ? Icon.Tray : Icon.Terminal}
      title={inbox.length > 0 ? String(inbox.length) : undefined}
      tooltip={blocked > 0 ? `${blocked} Rex pane(s) need you` : `${inbox.length} in Rex inbox`}
    >
      {SHOWN.map((b) =>
        data && data[b].length > 0 ? (
          <MenuBarExtra.Section key={b} title={BUCKET_TITLES[b]}>
            {data[b].map((item) => (
              <PaneEntry key={item.pane.blockId} item={item} onChange={revalidate} />
            ))}
          </MenuBarExtra.Section>
        ) : null,
      )}
      <MenuBarExtra.Section>
        {data && data.snoozed.length + data.settled.length > 0 ? (
          <MenuBarExtra.Item
            title={`${data.snoozed.length} snoozed · ${data.settled.length} settled`}
            icon={Icon.Clock}
          />
        ) : null}
        <MenuBarExtra.Item
          title="Open Rex Inbox"
          icon={Icon.AppWindowList}
          shortcut={Keyboard.Shortcut.Common.Open}
          onAction={() => launchCommand({ name: "inbox", type: LaunchType.UserInitiated })}
        />
        <MenuBarExtra.Item title="Preferences…" icon={Icon.Gear} onAction={openExtensionPreferences} />
      </MenuBarExtra.Section>
    </MenuBarExtra>
  );
}

function PaneEntry({ item, onChange }: { item: Item; onChange: () => void }) {
  const msg = item.record?.msg;
  return (
    <MenuBarExtra.Item
      icon={stateIcon(item)}
      title={paneTitle(item)}
      subtitle={`${item.pane.sessionLabel} · ${relative(item.updatedAt)}`}
      tooltip={msg}
      onAction={async (event) => {
        // Right-click settles without opening, like archiving from a notification.
        if (event.type === "right-click") {
          await settle(item.pane.blockId);
        } else {
          await open(item);
        }
        onChange();
      }}
    />
  );
}
