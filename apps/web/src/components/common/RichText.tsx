import { parseRichText, type RichBlock, type RichInline } from "@illuminize/shared";
import clsx from "clsx";
import { Fragment, useMemo } from "react";

/** Members write these links, so they pass no referrer, no opener and no search-engine credit. */
export const EXTERNAL_REL = "noopener noreferrer nofollow ugc";

function Inlines({ nodes }: { nodes: RichInline[] }) {
  return nodes.map((node, i) =>
    node.type === "text" ? (
      <Fragment key={i}>{node.text}</Fragment>
    ) : (
      // A mail link opens the mail app, so it has no new tab to open.
      <a
        key={i}
        href={node.href}
        target={node.href.startsWith("mailto:") ? undefined : "_blank"}
        rel={EXTERNAL_REL}
        className="font-medium text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary"
      >
        {node.text}
      </a>
    ),
  );
}

/**
 * dir="auto" on each block: bidi controls are stripped, so a paragraph in Arabic or Hebrew takes its direction from its own
 * text, and a list from its first letter (as the mobile app's `textDirection` does). The list's padding is logical, so its
 * markers sit on the side the list reads from. pre-wrap keeps runs of spaces inside a line, as the mobile app does; the
 * parser has already trimmed each line.
 */
function Block({ block }: { block: RichBlock }) {
  if (block.type === "paragraph")
    return (
      <p dir="auto" className="whitespace-pre-wrap">
        {block.lines.map((line, i) => (
          <Fragment key={i}>
            {i > 0 && <br />}
            <Inlines nodes={line} />
          </Fragment>
        ))}
      </p>
    );
  const items = block.items.map((item, i) => (
    <li key={i} className="whitespace-pre-wrap ps-1">
      <Inlines nodes={item} />
    </li>
  ));
  const list = "space-y-1 ps-5 marker:text-slate-500";
  return block.ordered ? (
    <ol dir="auto" start={block.start} className={clsx("list-decimal", list)}>
      {items}
    </ol>
  ) : (
    <ul dir="auto" className={clsx("list-disc", list)}>
      {items}
    </ul>
  );
}

/**
 * A long description, bio or pitch: paragraphs, bullet and numbered lists, and links, parsed by the shared `parseRichText`.
 * Everything renders as React elements, so nothing a member writes is ever HTML.
 */
export function RichText({ text, className }: { text: string | null | undefined; className?: string }) {
  const blocks = useMemo(() => parseRichText(text), [text]);
  if (blocks.length === 0) return null;
  return (
    <div className={clsx("space-y-3 text-[length:var(--text-body)] leading-relaxed text-slate-800 [overflow-wrap:anywhere]", className)}>
      {blocks.map((block, i) => (
        <Block key={i} block={block} />
      ))}
    </div>
  );
}
