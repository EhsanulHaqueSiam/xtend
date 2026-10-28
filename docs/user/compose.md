# Compose

Compose is drafts first. The section open in the sidebar picks which drafts you see; a row or
**New draft** opens the composer. Press `c` anywhere in the app to start a draft.

## Sections

| section   | what is there                                                                                                                            |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Drafts    | what you wrote and have not sent                                                                                                         |
| Queued    | drafts waiting for their slot, with the time                                                                                             |
| Automatic | drafts written for you by Library's morning run and by Automate, each with its source, and ask-first automation runs waiting for a click |
| Failed    | posts that did not go through, with why; a row opens the draft to retry                                                                  |
| Posted    | what went out from Xtend, with the link on X                                                                                             |

Each row shows the first line, how many posts the thread has, its price to post and its time.

## The thread

A draft is one or more posts on a rail, each with its own `n/280` count in mono: amber in the
last 20 characters, red past the limit. The post you are writing shows its tools: media, who
can reply, move up or down, remove, add below.

- Paste plain text with blank lines between paragraphs and each paragraph becomes a post.
- Up to four images or a video per post, with alt text. Drag to reorder.
- A link to an x.com post as its own line becomes a quote. The quoted post shows as a card
  when the Library has it; otherwise the bare link, which is what X will get. The quote rides
  on the first post and counts against its 280.
- **Options** holds the rest: a poll on the first post, who can reply to every post, seconds
  between thread posts.

The preview beside the editor shows the thread as X will render it, with your avatar and name.

## Sending

Every send button carries its price. The rate is per post, and a post with a link costs more
than one without; the price on the button is what you will pay.

- **Post now** sends the thread through the X API.
- **Queue** puts it on the next free slot from [Plan](./plan.md). The button names the slot.
- **Schedule** picks a time of your own.
- Posts with media go through your x.com session when **Post media through X** is on in
  Settings, and are then not billed.

A thread posts one post at a time. If a later post fails, the draft lands in Failed with what
went out marked, and a retry continues from there.

## Replies and quotes

`r` anywhere, or Reply with AI on a post in X, opens Compose on a reply. The post you are
answering shows beside the editor, read from the Library when it is saved there, otherwise
from what the session view showed. Remix in the Library opens Compose with the post it was
inspired by beside it and linked on the draft.

## Assist

At the foot of the writing column the model's help is one row of actions on the draft and a
topic box for thread ideas. Each action is one model call and shows its price. Answers open
above the row, each with **Use** and **Dismiss**; nothing changes your draft until you click Use.

- **Rewrite** reworks the current post.
- **Voice match** scores the draft against your recent posts (0 to 1, shown in the header). It
  reads your recent posts from X first, so it is priced as a read plus a model call.
- **Thread ideas** writes a thread on the topic in the box and adds it after your last post.
- **Where this lands** is free: the next free slot, your best hours, and three Library posts
  like your first line.

Your voice notes and keywords from Settings go with every call. See [Costs](./costs.md).
