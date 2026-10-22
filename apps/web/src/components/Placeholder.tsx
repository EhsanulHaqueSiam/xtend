import { PageHeader } from "./PageHeader";

/** Stands in for a suite screen that is specified but not built. Kept deliberately empty. */
export function Placeholder({
  title,
  detail,
}: {
  readonly title: string;
  readonly detail: string;
}) {
  return (
    <div className="flex h-full flex-col">
      <PageHeader title={title} />
      <div className="flex flex-1 items-center justify-center p-8">
        <p className="max-w-sm text-center text-sm text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}
