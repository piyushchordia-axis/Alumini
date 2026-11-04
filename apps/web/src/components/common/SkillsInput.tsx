import { skillKey, tidySkill } from "@illuminize/shared";
import { useRef, useState } from "react";
import { IconClose } from "@/components/icons";
import { Input } from "@/components/ui";

/**
 * Skills as removable chips. Each is typed and added with Enter or a comma, as in `CommaListInput`, so a pasted
 * "Go, SQL" adds both; leaving the box adds what's left in it. A repeat (by `skillKey`) is dropped, and a skill longer than
 * `maxLength` or past `max` stays in the box with a note saying why. Label it with `FormField htmlFor`, which keeps the
 * remove buttons out of the label.
 */
export function SkillsInput({
  id,
  value,
  onChange,
  onBlur,
  max,
  maxLength,
  invalid,
  placeholder,
  "aria-describedby": describedBy,
}: {
  id: string;
  value: string[] | null | undefined;
  onChange: (skills: string[]) => void;
  onBlur?: () => void;
  max: number;
  maxLength: number;
  invalid?: boolean;
  placeholder?: string;
  "aria-describedby"?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [announced, setAnnounced] = useState("");
  const skills = value ?? [];
  const full = skills.length >= max;

  /**
   * Adds every skill in `raw`; with `typing`, the part after the last comma is still being typed and stays in the box. What
   * can't be added stays there too, without a trailing comma, which would add it again (and refuse it again) on every
   * Backspace.
   */
  const add = (raw: string, typing: boolean) => {
    const parts = raw.split(",");
    const typed = typing ? parts.pop()!.trimStart() : "";
    const next = [...skills];
    const left: string[] = [];
    let problem: string | null = null;
    for (const part of parts) {
      const skill = tidySkill(part);
      if (!skill || next.some((s) => skillKey(s) === skillKey(skill))) continue;
      if (skill.length > maxLength) problem = `Keep each skill to ${maxLength} characters`;
      else if (next.length >= max) problem = `Add at most ${max} skills`;
      else {
        next.push(skill);
        continue;
      }
      left.push(skill);
    }
    const added = next.slice(skills.length);
    if (added.length) onChange(next);
    // Said as well as shown, so a screen reader hears why a skill stayed in the box.
    const said = [added.length ? `Added ${added.join(", ")}` : null, problem].filter(Boolean).join(". ");
    if (said) setAnnounced(said);
    setText(typing && typed ? [...left, typed].join(", ") : left.join(", "));
    setNote(problem);
  };

  const remove = (skill: string) => {
    onChange(skills.filter((s) => s !== skill));
    setAnnounced(`Removed ${skill}`);
    setNote(null);
    // The button goes with its chip, so focus goes back to the box rather than to the top of the page.
    input.current?.focus();
  };

  return (
    <div>
      <Input
        ref={input}
        id={id}
        value={text}
        invalid={invalid}
        placeholder={full ? `${max} skills added` : placeholder}
        autoComplete="off"
        enterKeyHint="enter"
        aria-describedby={describedBy}
        onChange={(e) => {
          if (e.target.value.includes(",")) add(e.target.value, true);
          else setText(e.target.value);
        }}
        onKeyDown={(e) => {
          // Enter adds the skill rather than submitting the form; in an empty box it submits as usual.
          if (e.key === "Enter" && text.trim()) {
            e.preventDefault();
            add(text, false);
          }
        }}
        onBlur={() => {
          if (text.trim()) add(text, false);
          onBlur?.();
        }}
      />
      {note && <p className="mt-1 text-xs text-amber-800">{note}</p>}
      {skills.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {skills.map((skill) => (
            <li key={skill} className="inline-flex max-w-full items-center gap-0.5 rounded-full bg-primary/10 py-0.5 pl-3 pr-0.5 text-sm text-primary">
              <span className="min-w-0 [overflow-wrap:anywhere]">{skill}</span>
              {/* 32 pixels drawn and 44 to touch: the ::before pads the target into the gaps around the chip. */}
              <button
                type="button"
                onClick={() => remove(skill)}
                aria-label={`Remove ${skill}`}
                className="relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full before:absolute before:-inset-1.5 hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <IconClose size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <span className="sr-only" role="status">
        {announced}
      </span>
    </div>
  );
}
