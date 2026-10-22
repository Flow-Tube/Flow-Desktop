import { getString } from "./i18n/index";
import type { Collaborator } from "../types/video";

/** A collaboration's byline: "KSI and MrBeast", or "CNET and 4 more" past two channels. */
export function collaboratorsByline(collaborators: Collaborator[]): string {
  const [first, second] = collaborators;
  if (!first) return "";
  if (!second) return first.name;
  if (collaborators.length === 2) return getString("watch_collaborators_and", first.name, second.name);
  return getString("card_collaborators_more", first.name, collaborators.length - 1);
}
