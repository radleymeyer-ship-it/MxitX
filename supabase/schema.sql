-- MxitX chat room and message schema
create extension if not exists pgcrypto;

create table if not exists public.chat_rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,
  created_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.chat_rooms(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  sender_handle text not null,
  sender_mx_pin text not null,
  text text not null,
  is_ping boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.contact_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  requester_pin text not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  unique (requester_id, recipient_id, status)
);

create table if not exists public.contacts (
  user_id uuid not null references auth.users(id) on delete cascade,
  contact_id uuid not null references auth.users(id) on delete cascade,
  room_id uuid not null references public.chat_rooms(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, contact_id),
  check (user_id <> contact_id)
);

create index if not exists contact_requests_recipient_status_idx
  on public.contact_requests(recipient_id, status);

alter table public.contact_requests enable row level security;
alter table public.contacts enable row level security;

create policy "Users can send contact requests"
  on public.contact_requests for insert
  with check (auth.uid() = requester_id);
create policy "Users can view their contact requests"
  on public.contact_requests for select
  using (auth.uid() = requester_id or auth.uid() = recipient_id);
create policy "Recipients can respond to contact requests"
  on public.contact_requests for update
  using (auth.uid() = recipient_id)
  with check (auth.uid() = recipient_id);
create policy "Users can view their contacts"
  on public.contacts for select
  using (auth.uid() = user_id);
create policy "Users can create contact links"
  on public.contacts for insert
  with check (auth.uid() = user_id or auth.uid() = contact_id);

create index if not exists messages_room_id_created_at_idx
  on public.messages(room_id, created_at);

-- Repair existing installations without changing the message payload contract.
alter table public.messages
  alter column id set default gen_random_uuid();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.messages'::regclass
      and contype = 'p'
  ) then
    alter table public.messages add primary key (id);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.messages'::regclass
      and conname = 'messages_room_id_fkey'
  ) then
    alter table public.messages add constraint messages_room_id_fkey
      foreign key (room_id) references public.chat_rooms(id) on delete cascade;
  end if;
end $$;
