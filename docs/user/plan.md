# Plan

When your posts go out.

## Slots

Slots are the times of week you post. Add a time, pick its days, and every queued draft lands
on the next free one. Best hours, beside the slots, are the hours where your observed posts
drew the most views, each one click from a slot. They need ten observed posts first.

## Queue

Queued drafts in order, the time each posts, and its price. Post now sends one straight away
after confirming the price. Skip moves a draft to the next slot; unschedule returns it to
Drafts. Failed posts sit here too, with the reason.

## Calendar

A week at a time: queued posts on their slots, open slots as gaps. Ready drafts, written by the
Library's daily jobs, are listed to fill them.

## Where the schedule runs

The service runs the schedule, not the window. With the desktop closed, a queued draft still
posts if the service is running on its own (see [CLI](./cli.md), `xtend service install`).
Times are in the time zone from Settings.
