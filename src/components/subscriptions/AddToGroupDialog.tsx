import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "../ui/Button";
import { Checkbox } from "../ui/Checkbox";
import { InfoDialog } from "../ui/InfoDialog";
import { TextInput } from "../ui/TextInput";
import { channelCountLabel } from "../../lib/channelGroupLabels";
import { groupChannelsWith } from "../../lib/channelGroups";
import { getString } from "../../lib/i18n/index";
import { useSubscriptionStore } from "../../store/useSubscriptionStore";

interface AddToGroupDialogProps {
  channelId: string;
  channelName: string;
  onClose: () => void;
}

/** Which of the viewer's groups this channel is in, changed as each box is ticked. */
export function AddToGroupDialog({ channelId, channelName, onClose }: AddToGroupDialogProps) {
  const groups = useSubscriptionStore((state) => state.subscriptionGroups);
  const loadGroups = useSubscriptionStore((state) => state.loadSubscriptionGroups);
  const updateGroup = useSubscriptionStore((state) => state.updateSubscriptionGroup);
  const createGroup = useSubscriptionStore((state) => state.createSubscriptionGroup);
  const [newName, setNewName] = useState("");

  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);

  const submitNew = () => {
    const name = newName.trim();
    if (!name) return;
    void createGroup(name, [channelId]);
    setNewName("");
  };

  return (
    <InfoDialog title={getString("channel_add_to_group")} closeLabel={getString("close")} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <p dir="auto" className="line-clamp-1 text-sm text-chrome-neutral-400">{channelName}</p>

        {groups.length > 0 ? (
          <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-chrome-neutral-800 bg-surface-container-low">
            {groups.map((group) => {
              const member = group.channelIds.includes(channelId);
              return (
                <Checkbox
                  key={group.name}
                  checked={member}
                  onChange={() => void updateGroup(group.name, group.name, groupChannelsWith(group, channelId, !member))}
                  className="px-3 py-2 transition-colors duration-200 ease-out hover:bg-surface-container"
                >
                  <span className="min-w-0 flex-1">
                    <span dir="auto" className="line-clamp-1 text-sm font-medium text-chrome-neutral-100">{group.name}</span>
                    <span className="text-xs text-chrome-neutral-400">{channelCountLabel(group.channelIds.length)}</span>
                  </span>
                </Checkbox>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-chrome-neutral-400">{getString("subscriptions_groups_empty")}</p>
        )}

        <div className="flex items-center gap-2">
          <TextInput
            value={newName}
            onChange={setNewName}
            onKeyDown={(event) => {
              if (event.key === "Enter") submitNew();
            }}
            placeholder={getString("subscriptions_groups_name")}
            className="min-w-0 flex-1"
          />
          <Button variant="tonal" size="sm" disabled={!newName.trim()} onClick={submitNew}>
            <Plus size={15} />
            {getString("subscriptions_groups_create")}
          </Button>
        </div>
      </div>
    </InfoDialog>
  );
}
