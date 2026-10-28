import { Copy, Search } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { MediaMenu, type MediaMenuAction } from "../ui/MediaMenu";
import { copyText } from "../../lib/clipboard";
import { getString } from "../../lib/i18n/index";
import { selectionSearchQuery, shortSelectionLabel } from "../../lib/textSelection";
import { useSelectionContextMenu } from "../../lib/useSelectionContextMenu";
import { useUiStore } from "../../store/useUiStore";

/** Copy and Search for whatever text is highlighted, on right-click. */
export function SelectionMenu() {
  const { menu, close } = useSelectionContextMenu();
  const navigate = useNavigate();
  const showToast = useUiStore((state) => state.showToast);

  if (!menu) return null;

  const query = selectionSearchQuery(menu.text);
  const actions: MediaMenuAction[] = [
    {
      id: "copy",
      label: getString("selection_copy"),
      icon: <Copy size={18} />,
      onSelect: async () => {
        const copied = await copyText(menu.text);
        showToast(copied
          ? { message: getString("selection_copied"), variant: "success" }
          : { message: getString("selection_copy_failed"), variant: "error" });
      },
    },
    {
      id: "search",
      label: getString("selection_search", shortSelectionLabel(query)),
      icon: <Search size={18} />,
      onSelect: () => navigate(`/search?q=${encodeURIComponent(query)}`),
    },
  ];

  return <MediaMenu anchor={menu.anchor} onClose={close} actions={actions} className="z-[90]" />;
}
