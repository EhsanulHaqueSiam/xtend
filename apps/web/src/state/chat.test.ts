import { expect, it } from "vite-plus/test";

import {
  type ChatItem,
  type ChatRead,
  type ChatRow,
  emptyChat,
  mergeChat,
  mergeWindow,
} from "./chat";

const ids = (list: ReadonlyArray<{ readonly id: string }>) => list.map((x) => x.id).join(" ");
const of = (names: string) => names.split(" ").map((id) => ({ id }));

it("lays X's window of rows over what it read before: moved rows move, deleted ones go, the rest stays", () => {
  const known = of("a b c d e f g h");
  // A new message lifted g to the top of the rows X draws, above a, b and c.
  expect(ids(mergeWindow(known, of("g a b c")))).toBe("g a b c d e f h");
  // Scrolled down: X draws d to f, then rows past them.
  expect(ids(mergeWindow(known, of("e f h i j")))).toBe("a b c d e f h i j");
  // c was deleted: X draws b right after a now, nothing between them.
  expect(ids(mergeWindow(of("a b c d"), of("a b d")))).toBe("a b d");
  // Older messages X drew above the ones it showed before.
  expect(ids(mergeWindow(of("c d"), of("a b c")))).toBe("a b c d");
  // Nothing shared: X is somewhere else in the list, so its window is all there is.
  expect(ids(mergeWindow(known, of("x y")))).toBe("x y");
});

const row = (id: string): ChatRow => ({
  id,
  href: `/i/chat/${id}`,
  name: id,
  avatars: [],
  preview: "",
  time: "",
  unread: false,
  muted: false,
  pinned: false,
  group: false,
});
const message = (id: string): ChatItem => ({
  kind: "message",
  id,
  mine: false,
  sender: "Ann",
  text: id,
  time: null,
  media: null,
  reactions: [],
  status: "sent",
});
const read = (over: Partial<ChatRead>): ChatRead => ({
  path: "/i/chat",
  locked: false,
  inbox: null,
  requestsRow: null,
  requests: null,
  title: null,
  items: null,
  composer: false,
  request: null,
  search: null,
  ...over,
});

it("keeps a conversation's place as X draws older messages, and the inbox while X shows only the conversation", () => {
  const unread = (id: string) => ({ ...row(id), unread: true });
  const inbox = mergeChat(emptyChat, read({ inbox: [unread("1-2"), unread("1-3")] }));
  const open = mergeChat(
    inbox,
    read({ path: "/i/chat/1-2", items: [message("m3"), message("m4")], title: "Ann" }),
  );
  // X marks the open conversation read; its row in the inbox Xtend keeps says so too.
  expect(open.inbox?.map((r) => [r.id, r.unread])).toEqual([
    ["1-2", false],
    ["1-3", true],
  ]);
  const first = open.conversation!.first;
  const older = mergeChat(
    open,
    read({ path: "/i/chat/1-2", items: [message("m1"), message("m2"), message("m3")] }),
  );
  expect([ids(older.conversation!.items), older.conversation!.first]).toEqual([
    "m1 m2 m3 m4",
    first - 2,
  ]);
  // Another conversation starts its own list.
  const next = mergeChat(older, read({ path: "/i/chat/1-3", items: [message("n1")] }));
  expect([
    ids(next.conversation!.items),
    next.conversation!.first,
    next.conversation!.title,
  ]).toEqual(["n1", first, null]);
});
