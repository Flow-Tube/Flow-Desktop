import { initAppLanguage } from "./lib/i18n/index";
import { installGlobalErrorHandlers } from "./lib/diagnostics";

installGlobalErrorHandlers();

// Some modules read strings as they load, so the language has to be in place before the app is imported.
void initAppLanguage().finally(() => import("./bootstrap"));
