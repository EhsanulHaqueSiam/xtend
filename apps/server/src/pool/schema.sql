-- The shared pool: what every Xtend install saw on X, pooled in one Neon Postgres so
-- trends come from everyone's timeline instead of one person's. Public posts only.
-- Nothing identifies the viewer: no handle, no account, no DMs, no lists, no bookmarks.
-- An install id exists for rate limiting and is never joined to content.
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
  install_id uuid not null references pool_installs (install_id),
  post_id    text not null references pool_posts (post_id),
  primary key (install_id, post_id)
);

-- One call per batch from the worker. `batch` is a JSON array of
-- {post:{postId,text,lang,createdAt,isReply,hasMedia,hasLink,author:{userId,handle,name,followers,verified}},
--  metrics:{views,likes,reposts,replies,quotes,bookmarks}, observedAt}.
create or replace function pool_push(install uuid, batch jsonb) returns integer
language plpgsql as $$
declare
  n integer := 0;
  item jsonb;
begin
  insert into pool_installs (install_id) values (install)
    on conflict (install_id) do update set last_push = now(), pushes = pool_installs.pushes + 1;
  for item in select * from jsonb_array_elements(batch) loop
    insert into pool_authors (user_id, handle, name, followers, verified)
      values (item->'post'->'author'->>'userId', item->'post'->'author'->>'handle',
              item->'post'->'author'->>'name', (item->'post'->'author'->>'followers')::integer,
              coalesce((item->'post'->'author'->>'verified')::boolean, false))
      on conflict (user_id) do update set handle = excluded.handle, name = excluded.name,
        followers = coalesce(excluded.followers, pool_authors.followers),
        verified = excluded.verified, last_seen = now();
    insert into pool_posts (post_id, author_id, text, lang, created_at, is_reply, has_media, has_link)
      values (item->'post'->>'postId', item->'post'->'author'->>'userId', item->'post'->>'text',
              item->'post'->>'lang', (item->'post'->>'createdAt')::timestamptz,
              coalesce((item->'post'->>'isReply')::boolean, false),
              coalesce((item->'post'->>'hasMedia')::boolean, false),
              coalesce((item->'post'->>'hasLink')::boolean, false))
      on conflict (post_id) do update set last_seen = now();
    insert into pool_sightings (install_id, post_id) values (install, item->'post'->>'postId')
      on conflict do nothing;
    if found then
      update pool_posts set sightings = sightings + 1 where post_id = item->'post'->>'postId';
    end if;
    insert into pool_metrics (post_id, observed_at, views, likes, reposts, replies, quotes, bookmarks)
      values (item->'post'->>'postId', (item->>'observedAt')::timestamptz,
              (item->'metrics'->>'views')::bigint, (item->'metrics'->>'likes')::integer,
              (item->'metrics'->>'reposts')::integer, (item->'metrics'->>'replies')::integer,
              (item->'metrics'->>'quotes')::integer, (item->'metrics'->>'bookmarks')::integer)
      on conflict do nothing;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Trends. Hot posts: views gained over the last 24 hours, from the first and last sighting in
-- that window. Rising terms: words in the last 24 hours against the week before.
create materialized view if not exists pool_hot_posts as
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
join pool_posts p on p.post_id = w.post_id
join pool_authors a on a.user_id = p.author_id
order by w.views_24h desc nulls last
limit 500;
create unique index if not exists pool_hot_posts_pk on pool_hot_posts (post_id);

create materialized view if not exists pool_rising_terms as
with recent as (
  select word, count(*) as n
  from pool_posts, regexp_split_to_table(lower(text), '[^a-z0-9_#@]+') as word
  where created_at > now() - interval '24 hours' and length(word) between 3 and 40
  group by word
),
before as (
  select word, count(*) / 7.0 as n_per_day
  from pool_posts, regexp_split_to_table(lower(text), '[^a-z0-9_#@]+') as word
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
create unique index if not exists pool_rising_terms_pk on pool_rising_terms (word);
