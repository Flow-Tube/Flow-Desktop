import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useConfirmStore, type ConfirmRequest } from "../../store/useConfirmStore";
import { ConfirmHost } from "./ConfirmHost";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DELETE: ConfirmRequest = { title: "Delete?", message: "Gone for good.", confirmLabel: "Delete", destructive: true };
const RESTORE: ConfirmRequest = { title: "Restore?", message: "Into this profile.", confirmLabel: "Restore" };

describe("ConfirmHost", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    useConfirmStore.setState({ pending: null });
    act(() => root.render(createElement(ConfirmHost)));
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const ask = (request: ConfirmRequest) => {
    let answer!: Promise<boolean>;
    act(() => {
      answer = useConfirmStore.getState().ask(request);
    });
    return answer;
  };
  const button = (label: string) =>
    [...host.querySelectorAll("button")].find((item) => item.textContent === label)!;
  const press = (key: string, init: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
    act(() => {
      (document.activeElement ?? document.body).dispatchEvent(event);
    });
    return event;
  };
  const click = (element: Element) => act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

  it("answers yes from the confirm button", async () => {
    const answer = ask(DELETE);
    click(button("Delete"));
    await expect(answer).resolves.toBe(true);
  });

  it("answers no from the cancel button", async () => {
    const answer = ask(DELETE);
    click(button("Cancel"));
    await expect(answer).resolves.toBe(false);
  });

  it("answers no from Escape", async () => {
    const answer = ask(DELETE);
    const event = press("Escape");
    await expect(answer).resolves.toBe(false);
    expect(event.defaultPrevented).toBe(true);
  });

  it("answers no from a click on the backdrop, and not from one inside the card", async () => {
    const answer = ask(DELETE);
    const card = host.querySelector('[role="alertdialog"]')!;
    click(card);
    expect(useConfirmStore.getState().pending).not.toBeNull();

    click(card.parentElement!);
    await expect(answer).resolves.toBe(false);
  });

  it("starts on Cancel for a destructive question and on the action otherwise", async () => {
    const destructive = ask(DELETE);
    expect(document.activeElement).toBe(button("Cancel"));
    click(button("Cancel"));
    await destructive;

    const plain = ask(RESTORE);
    expect(document.activeElement).toBe(button("Restore"));
    click(button("Cancel"));
    await plain;
  });

  it("keeps Tab on the dialog's buttons, both ways", async () => {
    const answer = ask(DELETE);
    press("Tab");
    expect(document.activeElement).toBe(button("Delete"));
    press("Tab");
    expect(document.activeElement).toBe(button("Cancel"));
    press("Tab", { shiftKey: true });
    expect(document.activeElement).toBe(button("Delete"));
    click(button("Cancel"));
    await answer;
  });

  it("hides keys from the page behind but leaves the focused button able to act on them", async () => {
    const behind = vi.fn();
    window.addEventListener("keydown", behind);
    const answer = ask(DELETE);

    const space = press(" ");
    expect(behind).not.toHaveBeenCalled();
    expect(space.defaultPrevented).toBe(false);

    window.removeEventListener("keydown", behind);
    click(button("Cancel"));
    await answer;
  });
});
