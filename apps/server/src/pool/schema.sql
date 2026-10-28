-- The shared pool: what every Xtend install saw on X, pooled in one Neon Postgres so
-- trends come from everyone's timeline instead of one person's. Public posts only.
-- Nothing identifies the viewer: no handle, no account, no DMs, no lists, no bookmarks.
-- An install id exists for rate limiting and is never joined to content; the worker issues it.
--
-- Apply: psql "$XTEND_POOL_URL" -v ON_ERROR_STOP=1 -f apps/server/src/pool/schema.sql
-- The service never holds the pool's credentials; a worker in front of the pool does, and
-- the service pushes batches to it and reads trends from it.

create table if not exists pool_authors (
  user_id    text primary key,
  handle     text not null,
  name       text not null,
  followers  integer,
  verified   boolean not null default false,
  first_seen timestamptz not null default now(),
  last_seen  timestamptz not null default now()
);
create index if not exists pool_authors_handle on pool_authors (lower(handle));

create table if not exists pool_posts (
  post_id    text primary key,
  author_id  text not null references pool_authors (user_id),
  text       text not null,
  lang       text,
  created_at timestamptz not null,
  is_reply   boolean not null default false,
  has_media  boolean not null default false,
  has_link   boolean not null default false,
  first_seen timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  -- How many installs reported it, not how many times: one vote per install per post.
  sightings  integer not null default 0
);
create index if not exists pool_posts_created on pool_posts (created_at desc);
create index if not exists pool_posts_author on pool_posts (author_id, created_at desc);
create index if not exists pool_posts_text on pool_posts using gin (to_tsvector('simple', text));

-- One row per sighting with numbers; the latest row per post is its current metrics and the
-- distance between rows is its velocity.
create table if not exists pool_metrics (
  post_id     text not null references pool_posts (post_id),
  observed_at timestamptz not null,
  views       bigint,
  likes       integer not null,
  reposts     integer not null,
  replies     integer not null,
  quotes      integer not null,
  bookmarks   integer not null,
  primary key (post_id, observed_at)
);
create index if not exists pool_metrics_observed on pool_metrics (observed_at desc);

-- Which install has reported which post, so sightings count installs. Rate limiting reads
-- pool_installs; content never joins to it.
create table if not exists pool_installs (
  install_id uuid primary key,
  created_at timestamptz not null default now(),
  last_push  timestamptz,
  pushes     bigint not null default 0
);
create table if not exists pool_sightings (
  install_id      uuid not null references pool_installs (install_id),
  post_id         text not null references pool_posts (post_id),
  -- One metrics row per install per post per hour, so a single install cannot flood velocity.
  last_metrics_at timestamptz,
  primary key (install_id, post_id)
);
-- Re-applying on an existing database: columns and views change in place.
alter table pool_sightings add column if not exists last_metrics_at timestamptz;

-- Installs are issued here, never self-asserted: the worker calls pool_register once per install
-- and pushes with the id it got back. An unknown id is rejected.
-- The worker limits registrations per address; this cap is only the backstop against a flood
-- and sits far above any honest hour so one actor cannot spend it for everyone.
create or replace function pool_register() returns uuid
language plpgsql as $$
declare id uuid;
begin
  if (select count(*) from pool_installs where created_at > now() - interval '1 hour') >= 5000 then
    raise exception 'registration limit' using errcode = '53400';
  end if;
  insert into pool_installs (install_id) values (gen_random_uuid()) returning install_id into id;
  return id;
end $$;

-- One call per batch from the worker. `batch` is a JSON array of
-- {post:{postId,text,lang,createdAt,isReply,hasMedia,hasLink,author:{userId,handle,name,followers,verified}},
--  metrics:{views,likes,reposts,replies,quotes,bookmarks}}.
-- Sightings are stamped with the server clock, so a client cannot move a post in time.
-- Items that fail the shape checks are skipped, not the batch. Author identity is frozen at
-- first sight apart from followers; a later install cannot rename or verify someone.
-- shortcut: post text, author identity and metrics are taken as reported, until per-install claims
-- with a quorum (majority text, median metrics) exist; the sightings >= 3 floor on the views and the
-- hourly throttle keep a lone install out of trends meanwhile.
create or replace function pool_push(install uuid, batch jsonb) returns integer
language plpgsql as $$
declare
  n integer := 0;
  item jsonb;
  post jsonb;
  author jsonb;
  m jsonb;
begin
  update pool_installs set last_push = now(), pushes = pushes + 1 where install_id = install;
  if not found then
    raise exception 'unknown install' using errcode = '28000';
  end if;
  if jsonb_array_length(batch) > 500 then
    raise exception 'batch too large' using errcode = '22023';
  end if;
  for item in select * from jsonb_array_elements(batch) loop
    post := item->'post';
    author := post->'author';
    m := item->'metrics';
    continue when post->>'postId' !~ '^[0-9]{1,25}$'
      or author->>'userId' !~ '^[0-9]{1,25}$'
      or author->>'handle' !~ '^[A-Za-z0-9_]{1,15}$'
      or length(coalesce(post->>'text', '')) > 10000
      or length(coalesce(author->>'name', '')) > 100
      or (post->>'createdAt')::timestamptz > now() + interval '5 minutes'
      or coalesce((m->>'likes')::bigint, -1) < 0 or coalesce((m->>'reposts')::bigint, -1) < 0
      or coalesce((m->>'replies')::bigint, -1) < 0 or coalesce((m->>'quotes')::bigint, -1) < 0
      or coalesce((m->>'bookmarks')::bigint, -1) < 0 or coalesce((m->>'views')::bigint, 0) < 0
      or coalesce((author->>'followers')::bigint, 0) < 0;
    insert into pool_authors (user_id, handle, name, followers, verified)
      values (author->>'userId', author->>'handle', coalesce(author->>'name', ''),
              (author->>'followers')::integer, coalesce((author->>'verified')::boolean, false))
      on conflict (user_id) do update set
        followers = coalesce(excluded.followers, pool_authors.followers), last_seen = now();
    insert into pool_posts (post_id, author_id, text, lang, created_at, is_reply, has_media, has_link)
      values (post->>'postId', author->>'userId', coalesce(post->>'text', ''), post->>'lang',
              (post->>'createdAt')::timestamptz,
              coalesce((post->>'isReply')::boolean, false),
              coalesce((post->>'hasMedia')::boolean, false),
              coalesce((post->>'hasLink')::boolean, false))
      on conflict (post_id) do update set last_seen = now();
    insert into pool_sightings (install_id, post_id, last_metrics_at)
      values (install, post->>'postId', now())
      on conflict (install_id, post_id) do update set last_metrics_at = now()
      where pool_sightings.last_metrics_at is null
         or pool_sightings.last_metrics_at < now() - interval '1 hour';
    continue when not found;
    update pool_posts set sightings = sightings + 1
      where post_id = post->>'postId'
        and (select count(*) from pool_sightings s where s.post_id = post->>'postId') > sightings;
    insert into pool_metrics (post_id, observed_at, views, likes, reposts, replies, quotes, bookmarks)
      values (post->>'postId', now(), (m->>'views')::bigint, (m->>'likes')::integer,
              (m->>'reposts')::integer, (m->>'replies')::integer, (m->>'quotes')::integer,
              (m->>'bookmarks')::integer)
      on conflict do nothing;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Trends. Hot posts: views gained over the last 24 hours, from the first and last sighting in
-- that window, counted only for posts three or more settled installs saw: an install counts
-- toward trends a day after it registered, so a burst of fresh ids cannot vote. Rising terms:
-- words in the last 24 hours against the week before, from those same posts.
create or replace view pool_settled_posts as
  select s.post_id, count(*) as settled_sightings
  from pool_sightings s
  join pool_installs i on i.install_id = s.install_id
  where i.created_at < now() - interval '24 hours'
  group by s.post_id
  having count(*) >= 3;
drop materialized view if exists pool_hot_posts;
create materialized view pool_hot_posts as
with window_metrics as (
  select post_id,
         max(views) - min(views) as views_24h,
         max(likes) - min(likes) as likes_24h,
         max(reposts) - min(reposts) as reposts_24h,
         max(observed_at) as last_seen
  from pool_metrics
  where observed_at > now() - interval '24 hours'
  group by post_id
  having count(*) >= 2
)
select p.post_id, p.author_id, a.handle, p.text, p.created_at, p.sightings,
       w.views_24h, w.likes_24h, w.reposts_24h, w.last_seen
from window_metrics w
join pool_settled_posts sp on sp.post_id = w.post_id
join pool_posts p on p.post_id = w.post_id
join pool_authors a on a.user_id = p.author_id
order by w.views_24h desc nulls last
limit 500;
create unique index pool_hot_posts_pk on pool_hot_posts (post_id);

drop materialized view if exists pool_rising_terms;
create materialized view pool_rising_terms as
with recent as (
  select word, count(*) as n
  from pool_posts join pool_settled_posts using (post_id), regexp_split_to_table(lower(text), '[^a-z0-9_#@]+') as word
  where created_at > now() - interval '24 hours' and length(word) between 3 and 40
  group by word
),
before as (
  select word, count(*) / 7.0 as n_per_day
  from pool_posts join pool_settled_posts using (post_id), regexp_split_to_table(lower(text), '[^a-z0-9_#@]+') as word
  where created_at between now() - interval '8 days' and now() - interval '24 hours'
    and length(word) between 3 and 40
  group by word
)
select r.word, r.n as today, coalesce(b.n_per_day, 0) as per_day_before,
       r.n / greatest(coalesce(b.n_per_day, 0), 1) as lift
from recent r left join before b using (word)
where r.n >= 5
order by lift desc, r.n desc
limit 500;
create unique index pool_rising_terms_pk on pool_rising_terms (word);
