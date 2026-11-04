import { useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";

import { getString } from "../../../lib/i18n/index";
import { pickCheckPositions, wordMatches } from "../../../lib/linked/recoveryCheck";
import { useLinkedDevicesStore } from "../../../store/useLinkedDevicesStore";
import { Button } from "../../ui/Button";
import { TextInput } from "../../ui/TextInput";
import { Card, Field } from "./Card";

function WordGrid({ words }: { words: string[] }) {
  return (
    <ol className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3 lg:grid-cols-4">
      {words.map((word, i) => (
        <li key={i} className="flex items-baseline gap-2 font-mono text-sm">
          <span className="w-6 text-right text-chrome-neutral-500">{i + 1}</span>
          <span className="text-chrome-neutral-100">{word}</span>
        </li>
      ))}
    </ol>
  );
}

function WordCheck({ words, onBack }: { words: string[]; onBack: () => void }) {
  const { confirmSaved, busy } = useLinkedDevicesStore();
  const positions = useMemo(() => pickCheckPositions(words.length), [words]);
  const [typed, setTyped] = useState<[string, string]>(["", ""]);
  const [wrong, setWrong] = useState(false);
  const check = () => {
    const ok = positions.every((p, i) => wordMatches(words[p] ?? "", typed[i] ?? ""));
    setWrong(!ok);
    if (ok) void confirmSaved();
  };
  return (
    <Card title={getString("linked_check_title")} subtitle={getString("linked_check_subtitle", positions[0] + 1, positions[1] + 1)}>
      <div className="grid grid-cols-12 gap-4">
        {positions.map((p, i) => (
          <div key={p} className="col-span-12 sm:col-span-6">
            <Field label={getString("linked_check_word", p + 1)}>
              <TextInput
                value={typed[i] ?? ""}
                onChange={(value) => setTyped((prev) => (i === 0 ? [value, prev[1]] : [prev[0], value]))}
                spellCheck={false}
                autoComplete="off"
              />
            </Field>
          </div>
        ))}
      </div>
      {wrong && <p className="text-sm text-chrome-red-400">{getString("linked_check_wrong")}</p>}
      <div className="flex gap-2">
        <Button disabled={busy || typed.some((t) => !t.trim())} onClick={check}>
          {getString("linked_check_confirm")}
        </Button>
        <Button variant="ghost" onClick={onBack}>
          {getString("linked_check_back")}
        </Button>
      </div>
    </Card>
  );
}

/** Shows the recovery key once, then asks for two of its words back before counting it as saved. */
export function RecoveryWords({ words }: { words: string }) {
  const list = useMemo(() => words.split(" "), [words]);
  const [checking, setChecking] = useState(false);
  if (checking) return <WordCheck words={list} onBack={() => setChecking(false)} />;
  return (
    <Card title={getString("linked_words_title")} subtitle={getString("linked_words_subtitle")}>
      <div className="grid grid-cols-12 items-center gap-6">
        <div className="col-span-12 lg:col-span-8">
          <WordGrid words={list} />
        </div>
        <div className="col-span-12 flex justify-center lg:col-span-4">
          <div className="rounded-3xl bg-chrome-white p-4">
            <QRCodeSVG value={words} size={176} level="M" marginSize={1} />
          </div>
        </div>
      </div>
      <Button className="self-start" onClick={() => setChecking(true)}>
        {getString("linked_words_continue")}
      </Button>
    </Card>
  );
}
