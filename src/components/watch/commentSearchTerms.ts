import { createContext } from "react";

/** The words of the comment search in force, folded, so every comment and reply can mark what they found. */
export const CommentSearchTerms = createContext<readonly string[]>([]);
