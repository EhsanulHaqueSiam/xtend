# Automate

Rules that act for you through X's API, within limits you set. Rules never use your X session.

## A rule

When something happens, then do something, only if conditions hold, within limits.

- **When**: a new follower, a new engager, someone reposts or likes a post, my post crosses a
  threshold, an agent finds a lead, a keyword post appears, or a schedule.
- **Then**: auto like, auto plug a reply, follow them, auto DM, add to a list, evergreen repost,
  undo repost, auto delete, clean profile, notify me, or call a webhook.
- **Only if**: the author's followers, the post's views, language, whether it is a reply, and
  so on.
- **Limits**: price per fire, budget per day and per month, per poll, after hours, and ask
  first.

Name the rule, switch it on, and it polls on its own. Run now fires it once.

## Needs you

Rules with "ask first" queue their action here with the price. Approve runs it, Skip drops it.
A desktop notification tells you when something is waiting.

## Dry run

Replays one rule over the last 7 days of stored posts, engagers and followers, and shows what
would have fired and what it would have cost. Charges nothing.

## Runs

Every fire, with its status (ok, failed, skipped, dry run), its subject, its price and the
rule's reason. Undo where the action supports it.

## Webhooks

A rule can call a webhook with the event. The rule's Webhook view shows the URL, the signing
secret and a sample payload.
