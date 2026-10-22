/** Looks like an X post card: avatar circle, name, handle, then each block as a thread. */
export function PostPreview({
  blocks,
  name,
  handle,
}: {
  readonly blocks: ReadonlyArray<string>;
  readonly name: string;
  readonly handle: string | null;
}) {
  return (
    <div className="rounded-md border border-border bg-card">
      {blocks.map((text, i) => (
        <div key={i} className="flex gap-3 px-4 py-3">
          <div className="flex flex-col items-center">
            <div className="size-10 shrink-0 rounded-full bg-muted" />
            {i < blocks.length - 1 ? <div className="mt-1 w-0.5 flex-1 bg-border" /> : null}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-1.5 text-sm">
              <span className="truncate font-semibold">{name}</span>
              <span className="truncate text-muted-foreground">@{handle ?? "you"} · now</span>
            </div>
            <p className="mt-0.5 whitespace-pre-wrap break-words text-[15px] leading-normal">
              {text === "" ? <span className="text-placeholder">Your post</span> : text}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
