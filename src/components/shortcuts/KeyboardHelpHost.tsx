import { useEffect, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";

import { getString } from "../../lib/i18n/index";
import { TOGGLE_SHORTCUT_HELP_EVENT } from "../../lib/shortcuts/useAppShortcuts";
import { Button } from "../ui/Button";
import { InfoDialog } from "../ui/InfoDialog";
import { KeyMapList } from "./KeyMapList";

/** The key list, which `?` opens from anywhere (see useAppShortcuts). */
export function KeyboardHelpHost() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const toggle = () => setOpen((value) => !value);
    window.addEventListener(TOGGLE_SHORTCUT_HELP_EVENT, toggle);
    return () => window.removeEventListener(TOGGLE_SHORTCUT_HELP_EVENT, toggle);
  }, []);

  return (
    <AnimatePresence>
      {open && (
        <InfoDialog
          title={getString("keyboard_shortcuts_title")}
          closeLabel={getString("close")}
          onClose={() => setOpen(false)}
          wide
          footer={
            <Button
              variant="tonal"
              onClick={() => {
                setOpen(false);
                navigate("/settings", { state: { settingsCategory: "keyboard" } });
              }}
            >
              {getString("keyboard_shortcuts_customize")}
            </Button>
          }
        >
          <KeyMapList />
        </InfoDialog>
      )}
    </AnimatePresence>
  );
}
