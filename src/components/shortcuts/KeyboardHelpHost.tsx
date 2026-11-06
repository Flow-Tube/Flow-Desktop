import { useEffect, useState } from "react";
import { AnimatePresence } from "framer-motion";

import { getString } from "../../lib/i18n/index";
import { keyBelongsToTarget } from "../../lib/musicPlayerKeys";
import { InfoDialog } from "../ui/InfoDialog";
import { KeyMapList } from "./KeyMapList";

/** `?` opens the key list from anywhere, unless the key is being typed into something. */
export function KeyboardHelpHost() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "?" || event.ctrlKey || event.metaKey || event.altKey) return;
      if (keyBelongsToTarget(event.target, event.key)) return;
      event.preventDefault();
      setOpen((value) => !value);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  return (
    <AnimatePresence>
      {open && (
        <InfoDialog title={getString("keyboard_shortcuts_title")} closeLabel={getString("close")} onClose={() => setOpen(false)} wide>
          <KeyMapList />
        </InfoDialog>
      )}
    </AnimatePresence>
  );
}
