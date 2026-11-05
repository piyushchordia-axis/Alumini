import clsx from "clsx";
import type { ComponentType, ReactNode } from "react";
import { EXTERNAL_REL } from "@/components/common/RichText";
import { IconGlobe, IconMail, IconPhone, type IconProps } from "@/components/icons";

type ContactKind = "website" | "email" | "phone";

/** `prefix` is read before an address shown as it is; a website shows "Website" instead. */
const KINDS: Record<ContactKind, { Icon: ComponentType<IconProps>; href: (address: string) => string; prefix?: string }> = {
  website: { Icon: IconGlobe, href: (address) => address },
  email: { Icon: IconMail, href: (address) => `mailto:${address}`, prefix: "Email " },
  phone: { Icon: IconPhone, href: (address) => `tel:${address}`, prefix: "Call " },
};

const action =
  "inline-flex min-h-11 min-w-0 items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition [overflow-wrap:anywhere] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

/**
 * One way to get in touch, as a 44px link with its icon: a website (in a new tab, with the rel member-entered links get),
 * an email address or a phone number. It shows the address itself, read as "Email …" or "Call …", unless `children` says
 * something else ("Get in touch"); a website says "Website". Apply passes its own `Icon`, drawn after the text.
 */
export function ContactLink({
  kind,
  address,
  children,
  primary = false,
  Icon = KINDS[kind].Icon,
  iconAfter = false,
}: {
  kind: ContactKind;
  address: string;
  children?: ReactNode;
  primary?: boolean;
  Icon?: ComponentType<IconProps>;
  iconAfter?: boolean;
}) {
  const external = kind === "website";
  const icon = <Icon size={16} className={primary ? undefined : "text-slate-500"} />;
  const text =
    children ??
    (external ? (
      "Website"
    ) : (
      <>
        <span className="sr-only">{KINDS[kind].prefix}</span>
        {address}
      </>
    ));
  return (
    <a
      href={KINDS[kind].href(address)}
      target={external ? "_blank" : undefined}
      rel={external ? EXTERNAL_REL : undefined}
      className={clsx(action, primary ? "bg-primary text-white shadow-sm hover:opacity-90" : "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50")}
    >
      {!iconAfter && icon}
      {text}
      {iconAfter && icon}
      {external && <span className="sr-only"> (opens in a new tab)</span>}
    </a>
  );
}
