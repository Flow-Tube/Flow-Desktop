import { AnimatePresence } from "framer-motion";
import { CircleAlert, Trash2 } from "lucide-react";
import { getString } from "../../lib/i18n/index";
import { useProxiedImageUrl } from "../../lib/useProxiedImageUrl";
import { useConfirmStore } from "../../store/useConfirmStore";
import { ConfirmDialog } from "../ui/ConfirmDialog";

/** Shows the question `confirmAction` is waiting on. Mounted once app-wide. */
export function ConfirmHost() {
  const pending = useConfirmStore((state) => state.pending);
  const answer = useConfirmStore((state) => state.answer);
  const image = useProxiedImageUrl(pending?.item?.image);

  return (
    <AnimatePresence>
      {pending && (
        <ConfirmDialog
          key={pending.id}
          icon={pending.icon ?? (pending.destructive ? Trash2 : CircleAlert)}
          title={pending.title}
          message={pending.message}
          item={pending.item && { ...pending.item, image }}
          confirmLabel={pending.confirmLabel ?? getString("ok")}
          cancelLabel={getString("cancel")}
          destructive={pending.destructive}
          onConfirm={() => answer(true)}
          onCancel={() => answer(false)}
        />
      )}
    </AnimatePresence>
  );
}
