import { applicationsClosed, applicationsLine, type JobDto } from "@illuminize/shared";
import clsx from "clsx";
import { ContactLink } from "@/components/common/ContactLink";
import { IconEvents, IconExternalLink, IconMail, IconPhone } from "@/components/icons";

/**
 * How to apply for a job: Apply (its link), its email and its phone. Once the job stops taking applications they go, for
 * everyone, and the line saying so takes their place; the API already keeps them from other members by then.
 *
 * `plain` is the admin's preview: the contacts as text, never links, whether the job is open or not, so an admin reads
 * where they lead without following them.
 */
export function JobApplyArea({ job, now, plain = false, className }: { job: JobDto; now: number; plain?: boolean; className?: string }) {
  const ended = applicationsClosed(job, now);
  const closedLine = ended ? (
    <p className="flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700">
      <IconEvents size={16} className="text-slate-500" />
      {applicationsLine(job, now)}
    </p>
  ) : null;

  if (plain) {
    const contacts = [
      { label: "Apply link", value: job.applyUrl, Icon: IconExternalLink },
      { label: "Email", value: job.contactEmail, Icon: IconMail },
      { label: "Phone", value: job.contactPhone, Icon: IconPhone },
    ].filter((c) => c.value);
    return (
      <div className={clsx("space-y-2", className)}>
        {closedLine}
        {contacts.length > 0 ? (
          <dl className="grid gap-2 text-sm sm:grid-cols-3">
            {contacts.map(({ label, value, Icon }) => (
              <div key={label} className="flex min-w-0 gap-2">
                <Icon size={16} className="mt-0.5 text-slate-400" />
                <div className="min-w-0">
                  <dt className="text-xs text-slate-500">{label}</dt>
                  <dd className="text-slate-800 [overflow-wrap:anywhere]">{value}</dd>
                </div>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-sm text-slate-500">No apply link, email or phone.</p>
        )}
      </div>
    );
  }

  if (closedLine) return <div className={className}>{closedLine}</div>;
  if (!job.applyUrl && !job.contactEmail && !job.contactPhone) return null;
  return (
    <div className={clsx("flex flex-wrap gap-2", className)}>
      {job.applyUrl && (
        <ContactLink kind="website" address={job.applyUrl} primary Icon={IconExternalLink} iconAfter>
          Apply
        </ContactLink>
      )}
      {job.contactEmail && <ContactLink kind="email" address={job.contactEmail} />}
      {job.contactPhone && <ContactLink kind="phone" address={job.contactPhone} />}
    </div>
  );
}
