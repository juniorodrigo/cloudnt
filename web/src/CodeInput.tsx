import { useEffect, useRef, useState } from "preact/hooks";
import { CODE_ALPHABET, CODE_LENGTH } from "./api.ts";
import { useT } from "./i18n.ts";

const clean = (raw: string) =>
  raw
    .toLowerCase()
    .split("")
    .filter((ch) => CODE_ALPHABET.includes(ch))
    .join("");

type Props = {
  initial?: string;
  invalid?: boolean;
  disabled?: boolean;
  onComplete: (code: string) => void;
};

/**
 * Five focused slots. This is the path for when the code must be typed manually
 * on a remote keyboard with lag and a foreign layout, where the address bar is
 * elsewhere or out of reach.
 */
export function CodeInput({ initial = "", invalid, disabled, onComplete }: Props) {
  const [slots, setSlots] = useState<string[]>(() =>
    Array.from({ length: CODE_LENGTH }, (_, i) => clean(initial)[i] ?? ""),
  );
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const t = useT();

  useEffect(() => {
    refs.current[slots.findIndex((s) => s === "") === -1 ? CODE_LENGTH - 1 : slots.findIndex((s) => s === "")]?.focus();
    // only on mount: after that the focus is moved by typing
  }, []);

  const commit = (next: string[]) => {
    setSlots(next);
    const code = next.join("");
    if (code.length === CODE_LENGTH && !next.includes("")) onComplete(code);
  };

  const fillFrom = (index: number, chars: string) => {
    const next = [...slots];
    let cursor = index;
    for (const ch of chars) {
      if (cursor >= CODE_LENGTH) break;
      next[cursor++] = ch;
    }
    refs.current[Math.min(cursor, CODE_LENGTH - 1)]?.focus();
    commit(next);
  };

  return (
    <div class={`code-input${invalid ? " invalid" : ""}`}>
      {slots.map((value, index) => (
        <input
          // eslint-disable-next-line react/no-array-index-key
          key={index}
          ref={(el) => {
            refs.current[index] = el;
          }}
          value={value}
          disabled={disabled}
          type="text"
          inputMode="text"
          autoCapitalize="off"
          autoCorrect="off"
          spellcheck={false}
          autocomplete="off"
          maxLength={CODE_LENGTH}
          aria-label={t.app.charOf(index + 1, CODE_LENGTH)}
          onInput={(event) => {
            const field = event.currentTarget;
            const typed = clean(field.value);
            if (!typed) {
              const next = [...slots];
              next[index] = "";
              commit(next);
              return;
            }
            // Typing into a filled slot replaces it instead of appending.
            fillFrom(index, typed.length > 1 ? typed : typed.slice(-1));
          }}
          onKeyDown={(event) => {
            if (event.key === "Backspace" && !slots[index] && index > 0) {
              event.preventDefault();
              const next = [...slots];
              next[index - 1] = "";
              setSlots(next);
              refs.current[index - 1]?.focus();
            }
            if (event.key === "ArrowLeft" && index > 0) refs.current[index - 1]?.focus();
            if (event.key === "ArrowRight" && index < CODE_LENGTH - 1) refs.current[index + 1]?.focus();
          }}
          onPaste={(event) => {
            event.preventDefault();
            fillFrom(0, clean(event.clipboardData?.getData("text") ?? ""));
          }}
          onFocus={(event) => event.currentTarget.select()}
        />
      ))}
    </div>
  );
}
