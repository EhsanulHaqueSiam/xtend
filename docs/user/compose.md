# Compose

Compose is drafts first. The section open in the sidebar picks which drafts you see; a card,
a row or **New draft** opens the composer. Press `c` anywhere in the app to open Compose.

## Sections

| section   | what is there                                                                                                                            |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Drafts    | the board of every draft, or what you wrote and have not sent as a list                                                                  |
| Queued    | drafts waiting for their slot, with the time                                                                                             |
| Automatic | drafts written for you by Library's morning run and by Automate, each with its source, and ask-first automation runs waiting for a click |
| Failed    | posts that did not go through, with why; a row opens the draft to retry                                                                  |
| Posted    | what went out from Xtend, with the link on X                                                                                             |

In a list each row shows the first line, how many posts the thread has, its price to post and
its time.

## The drafts board

Drafts opens as four columns: Automatic, Drafts, Queued, Posted. Each card shows its first
line, how many posts, its time and its price. **Board** and **List** in the header switch
between the board and the list, and the choice is kept.

Drag a card to the right to move it on: an automatic draft becomes yours, and a draft dropped
on Queued takes the next free slot. Drag a queued card back to Drafts to unschedule it, or a
draft back to Automatic. A queued draft goes back to Drafts before it can go further. Each move
is one toast with Undo. Failed drafts sit in Drafts, marked failed. Posted cards do not move.

## The thread

A draft is one or more posts on a rail, each with its own `n/280` count in mono: amber in the
last 20 characters, red past the limit. The post you are writing shows its tools: media, who
can reply, move up or down, remove, add below.

- Paste plain text with blank lines between paragraphs and each paragraph becomes a post.
- Up to four images or a video per post. Drag to reorder. Alt text cannot reach X yet.
- A link to an x.com post as its own line becomes a quote. The quoted post shows as a card
  when the Library has it; otherwise the bare link, which is what X will get. The quote rides
  on the first post and counts against its 280.
- **Options** holds the rest: a poll on the first post, who can reply to every post, seconds
  between thread posts.

The preview beside the editor shows the thread as X will render it, with your avatar and name.

## Sending

Every send carries its price. The rate is per post, and a post with a link costs more than one
without.

- **Post now** shows the total, with the posts that carry a link or media counted apart, and
  sends the thread once you **Confirm and post**.
- **Queue** puts it on the next free slot from [Plan](./plan.md). The button beside it shows
  that slot; open it to pick a time of your own and **Schedule**.
- Posts with media go through your x.com session and are not billed (see
  [x.com inside Xtend](./x-view.md)).

A thread posts one post at a time. If a later post fails, the draft lands in Failed with what
went out marked, and a retry continues from there.

## Replies and quotes

Reply with AI on a post in X opens Compose on a reply. The post you are
answering shows beside the editor, read from the Library when it is saved there, otherwise
from what the session view showed. Remix in the Library opens Compose with the post it was
inspired by beside it and linked on the draft. A post dropped on Compose in the sidebar starts
a draft that quotes it.

## Assist

At the foot of the writing column the model's help is one row of actions on the draft and a
topic box for thread ideas. Each action is one model call. Answers open
above the row, each with **Use** and **Dismiss**; nothing changes your draft until you click
Use.

- **Improve hook** offers new first lines.
- **Rewrite** reworks the current post.
- **Continue thread** writes the next posts after your last one.
- **Voice match** scores the draft against your recent posts. It reads your recent posts from
  X first, so it is priced as a read.
- **Ideas** writes thread outlines on the topic in the box; Use replaces the draft with one.

Beside the editor, the Context card shows the next free slot and your best hours for free, and
**Find similar** runs a priced X search for three posts like your first line.

Your voice notes and keywords from Settings go with every call. Model calls run on the model set
in Settings, Writing, and cost nothing through Xtend. See [Costs](./costs.md).
