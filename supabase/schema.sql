-- ============================================================================
-- Projeto Códice — Schema PostgreSQL / Supabase (RLS + Realtime)
-- Base relacional v3 + camada social, mural, reações, comentários e mensagens.
-- Script idempotente: seguro para executar múltiplas vezes no SQL Editor.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ----------------------------------------------------------------------------
-- 1. PERFIS & PRIVACIDADE
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  handle text NOT NULL UNIQUE,
  display_name text NOT NULL DEFAULT 'Leitor Códice',
  bio text NOT NULL DEFAULT '',
  avatar_url text NOT NULL DEFAULT '',
  banner_url text NOT NULL DEFAULT '',
  privacy_level text NOT NULL DEFAULT 'public'
    CHECK (privacy_level IN ('public', 'followers', 'private')),
  allow_wall_posts boolean NOT NULL DEFAULT true,
  allow_comments boolean NOT NULL DEFAULT true,
  allow_dms boolean NOT NULL DEFAULT true,
  gamification_enabled boolean NOT NULL DEFAULT true,
  active_title_badge text NOT NULL DEFAULT '',
  annual_goal integer NOT NULL DEFAULT 12 CHECK (annual_goal >= 1),
  -- Campos complementares de compatibilidade com Códice v3
  avatar_initials text NOT NULL DEFAULT 'LC',
  link_label text NOT NULL DEFAULT '',
  link_url text NOT NULL DEFAULT '',
  reader_focus text NOT NULL DEFAULT 'Leitor Casual',
  preferred_format text NOT NULL DEFAULT 'Livro Físico',
  preferred_criterion text NOT NULL DEFAULT 'Enredo e Ritmo',
  preferred_atmosphere text NOT NULL DEFAULT 'Tinta OLED',
  favorite_genres jsonb NOT NULL DEFAULT '[]'::jsonb,
  onboarding_completed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profiles_handle_format_chk CHECK (handle ~ '^@[a-z0-9_.-]{2,40}$')
);

CREATE INDEX IF NOT EXISTS idx_profiles_handle_lower
  ON public.profiles (lower(handle));

-- ----------------------------------------------------------------------------
-- 2. CATÁLOGO BIBLIOTECÁRIO & LEITURAS (Relacional SQL-JSON v3)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.works (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  work_type text NOT NULL DEFAULT 'movie'
    CHECK (work_type IN ('movie', 'series', 'anime', 'book', 'manga', 'academic')),
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'playing', 'completed', 'paused', 'rewatching', 'dropped')),
  cdu_cdd text NOT NULL DEFAULT '',
  cutter text NOT NULL DEFAULT '',
  call_number text NOT NULL DEFAULT '',
  isbn text NOT NULL DEFAULT '',
  issn text NOT NULL DEFAULT '',
  doi text NOT NULL DEFAULT '',
  edition text NOT NULL DEFAULT '',
  publisher text NOT NULL DEFAULT '',
  publication_place text NOT NULL DEFAULT '',
  publication_year integer,
  language text NOT NULL DEFAULT '',
  translator text NOT NULL DEFAULT '',
  advisor text NOT NULL DEFAULT '',
  series_name text NOT NULL DEFAULT '',
  series_index text NOT NULL DEFAULT '',
  series_volume text NOT NULL DEFAULT '',
  physical_location text NOT NULL DEFAULT '',
  acquisition_type text NOT NULL DEFAULT '',
  conservation_state text NOT NULL DEFAULT '',
  format text NOT NULL DEFAULT 'Livro Físico',
  access text,
  current_page integer NOT NULL DEFAULT 0 CHECK (current_page >= 0),
  total_pages integer CHECK (total_pages IS NULL OR total_pages > 0),
  current_volume integer NOT NULL DEFAULT 0 CHECK (current_volume >= 0),
  total_volumes integer CHECK (total_volumes IS NULL OR total_volumes > 0),
  current_chapter integer NOT NULL DEFAULT 0 CHECK (current_chapter >= 0),
  total_chapters integer CHECK (total_chapters IS NULL OR total_chapters > 0),
  demographic_origin text NOT NULL DEFAULT '',
  publication_status text NOT NULL DEFAULT '',
  academic_progress_mode text NOT NULL DEFAULT 'pages'
    CHECK (academic_progress_mode IN ('pages', 'fichamento')),
  fichamento_steps jsonb NOT NULL DEFAULT '{}'::jsonb,
  institution text NOT NULL DEFAULT '',
  keywords text NOT NULL DEFAULT '',
  fichamento text NOT NULL DEFAULT '',
  abnt_reference text NOT NULL DEFAULT '',
  synopsis text NOT NULL DEFAULT '',
  genres jsonb NOT NULL DEFAULT '[]'::jsonb,
  atmosphere jsonb NOT NULL DEFAULT '[]'::jsonb,
  tropes jsonb NOT NULL DEFAULT '[]'::jsonb,
  progress integer NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  hype text,
  checkpoint text NOT NULL DEFAULT '',
  is_platinum boolean NOT NULL DEFAULT false,
  is_favorite boolean NOT NULL DEFAULT false,
  is_wishlist boolean NOT NULL DEFAULT false,
  in_backlog boolean NOT NULL DEFAULT true,
  completion_type text,
  drop_reason text,
  start_date date,
  completed_date date,
  completed_year integer,
  drop_date date,
  cover_url text,
  cover_sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  monogram text NOT NULL DEFAULT '',
  reader_state jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_works_user_updated
  ON public.works (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_works_user_status
  ON public.works (user_id, status);

CREATE TABLE IF NOT EXISTS public.authors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  normalized_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT authors_user_normalized_unique UNIQUE (user_id, normalized_name)
);

CREATE TABLE IF NOT EXISTS public.work_authors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  work_id uuid NOT NULL REFERENCES public.works(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES public.authors(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'autor'
    CHECK (role IN ('autor', 'tradutor', 'orientador')),
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT work_authors_unique_role UNIQUE (work_id, author_id, role)
);

CREATE INDEX IF NOT EXISTS idx_work_authors_work
  ON public.work_authors (work_id, position);

CREATE TABLE IF NOT EXISTS public.reading_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  work_id uuid REFERENCES public.works(id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz NOT NULL DEFAULT now(),
  duration_seconds integer NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
  start_position jsonb,
  end_position jsonb,
  pages_read integer NOT NULL DEFAULT 0 CHECK (pages_read >= 0),
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reading_sessions_user_started
  ON public.reading_sessions (user_id, started_at DESC);

CREATE TABLE IF NOT EXISTS public.reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  work_id uuid NOT NULL REFERENCES public.works(id) ON DELETE CASCADE,
  rating integer CHECK (rating IS NULL OR (rating >= 0 AND rating <= 100)),
  verdict text,
  recommended boolean NOT NULL DEFAULT false,
  review_criteria jsonb,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reviews_work_user_unique UNIQUE (work_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.quotes_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  work_id uuid NOT NULL REFERENCES public.works(id) ON DELETE CASCADE,
  text text NOT NULL,
  location text NOT NULL DEFAULT '',
  cfi text NOT NULL DEFAULT '',
  color text NOT NULL DEFAULT 'accent',
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quotes_notes_work
  ON public.quotes_notes (work_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  work_id uuid REFERENCES public.works(id) ON DELETE SET NULL,
  item_title text NOT NULL DEFAULT '',
  item_snapshot jsonb,
  progress_marker text NOT NULL DEFAULT '',
  title text NOT NULL,
  caption text NOT NULL DEFAULT '',
  media jsonb NOT NULL DEFAULT '[]'::jsonb,
  visibility text NOT NULL DEFAULT 'inherit'
    CHECK (visibility IN ('inherit', 'public', 'followers', 'private')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_journal_entries_user_created
  ON public.journal_entries (user_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- 3. CAMADA SOCIAL (Seguidores, Mural, Reações, Comentários e Mensagens)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.follows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  following_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'approved'
    CHECK (status IN ('pending', 'approved')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT follows_no_self_chk CHECK (follower_id <> following_id),
  CONSTRAINT follows_unique_pair UNIQUE (follower_id, following_id)
);

ALTER TABLE public.follows
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'approved'
  CHECK (status IN ('pending', 'approved'));

CREATE INDEX IF NOT EXISTS idx_follows_following
  ON public.follows (following_id);

CREATE TABLE IF NOT EXISTS public.wall_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content text NOT NULL CHECK (char_length(trim(content)) > 0 AND char_length(content) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wall_posts_profile_created
  ON public.wall_posts (profile_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.post_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  journal_entry_id uuid REFERENCES public.journal_entries(id) ON DELETE CASCADE,
  wall_post_id uuid REFERENCES public.wall_posts(id) ON DELETE CASCADE,
  reaction_type text NOT NULL DEFAULT 'like'
    CHECK (reaction_type IN ('like', 'applause', 'insight', 'bookmark')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT post_reactions_single_target_chk CHECK (
    (journal_entry_id IS NOT NULL AND wall_post_id IS NULL) OR
    (journal_entry_id IS NULL AND wall_post_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_post_reactions_journal_unique
  ON public.post_reactions (user_id, journal_entry_id, reaction_type)
  WHERE journal_entry_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_post_reactions_wall_unique
  ON public.post_reactions (user_id, wall_post_id, reaction_type)
  WHERE wall_post_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.post_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  journal_entry_id uuid REFERENCES public.journal_entries(id) ON DELETE CASCADE,
  wall_post_id uuid REFERENCES public.wall_posts(id) ON DELETE CASCADE,
  content text NOT NULL CHECK (char_length(trim(content)) > 0 AND char_length(content) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT post_comments_single_target_chk CHECK (
    (journal_entry_id IS NOT NULL AND wall_post_id IS NULL) OR
    (journal_entry_id IS NULL AND wall_post_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_post_comments_journal
  ON public.post_comments (journal_entry_id, created_at ASC)
  WHERE journal_entry_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_post_comments_wall
  ON public.post_comments (wall_post_id, created_at ASC)
  WHERE wall_post_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.direct_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content text NOT NULL CHECK (char_length(trim(content)) > 0 AND char_length(content) <= 2000),
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT direct_messages_no_self_chk CHECK (sender_id <> recipient_id)
);

CREATE INDEX IF NOT EXISTS idx_direct_messages_conversation
  ON public.direct_messages (sender_id, recipient_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_direct_messages_recipient_unread
  ON public.direct_messages (recipient_id, read_at, created_at DESC);

-- ----------------------------------------------------------------------------
-- 4. FUNÇÕES AUXILIARES & TRIGGERS
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.can_view_profile(target_profile_id uuid, viewer_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN target_profile_id IS NULL THEN false
    WHEN viewer_id = target_profile_id THEN true
    ELSE EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = target_profile_id
        AND (
          p.privacy_level = 'public'
          OR (
            p.privacy_level = 'followers'
            AND viewer_id IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM public.follows f
              WHERE f.follower_id = viewer_id
                AND f.following_id = target_profile_id
                AND f.status = 'approved'
            )
          )
        )
    )
  END;
$$;

CREATE OR REPLACE FUNCTION public.can_view_target(
  p_journal_id uuid,
  p_wall_id uuid,
  p_viewer uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_journal_id IS NOT NULL THEN EXISTS (
      SELECT 1
      FROM public.journal_entries j
      WHERE j.id = p_journal_id
        AND (
          j.user_id = p_viewer
          OR (
            j.visibility = 'public'
            AND public.can_view_profile(j.user_id, p_viewer)
          )
          OR (
            j.visibility = 'followers'
            AND p_viewer IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM public.follows f
              WHERE f.follower_id = p_viewer AND f.following_id = j.user_id AND f.status = 'approved'
            )
          )
          OR (
            j.visibility = 'inherit'
            AND public.can_view_profile(j.user_id, p_viewer)
          )
        )
    )
    WHEN p_wall_id IS NOT NULL THEN EXISTS (
      SELECT 1
      FROM public.wall_posts w
      WHERE w.id = p_wall_id
        AND (
          w.profile_id = p_viewer
          OR w.author_id = p_viewer
          OR public.can_view_profile(w.profile_id, p_viewer)
        )
    )
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION public.can_comment_target(
  p_journal_id uuid,
  p_wall_id uuid,
  p_actor uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p_actor IS NOT NULL
    AND public.can_view_target(p_journal_id, p_wall_id, p_actor)
    AND CASE
      WHEN p_journal_id IS NOT NULL THEN EXISTS (
        SELECT 1
        FROM public.journal_entries j
        JOIN public.profiles p ON p.id = j.user_id
        WHERE j.id = p_journal_id
          AND (j.user_id = p_actor OR p.allow_comments = true)
      )
      WHEN p_wall_id IS NOT NULL THEN EXISTS (
        SELECT 1
        FROM public.wall_posts w
        JOIN public.profiles p ON p.id = w.profile_id
        WHERE w.id = p_wall_id
          AND (w.profile_id = p_actor OR p.allow_comments = true)
      )
      ELSE false
    END;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  raw_handle text;
  cleaned_handle text;
  final_handle text;
  display_name_val text;
BEGIN
  display_name_val := COALESCE(
    NULLIF(trim(NEW.raw_user_meta_data ->> 'display_name'), ''),
    split_part(COALESCE(NEW.email, 'leitor'), '@', 1)
  );

  raw_handle := lower(
    COALESCE(
      NULLIF(NEW.raw_user_meta_data ->> 'handle', ''),
      split_part(COALESCE(NEW.email, 'leitor'), '@', 1)
    )
  );
  raw_handle := regexp_replace(raw_handle, '^@+', '');
  cleaned_handle := regexp_replace(raw_handle, '[^a-z0-9_.-]', '', 'g');
  IF char_length(cleaned_handle) < 2 THEN
    cleaned_handle := 'leitor_' || substr(replace(NEW.id::text, '-', ''), 1, 6);
  END IF;

  final_handle := '@' || left(cleaned_handle, 32);
  IF EXISTS (SELECT 1 FROM public.profiles WHERE handle = final_handle) THEN
    final_handle := '@' || left(cleaned_handle, 24) || '_' || substr(replace(NEW.id::text, '-', ''), 1, 5);
  END IF;

  INSERT INTO public.profiles (
    id,
    handle,
    display_name,
    avatar_initials
  )
  VALUES (
    NEW.id,
    final_handle,
    display_name_val,
    upper(left(regexp_replace(display_name_val, '[^a-zA-Z0-9]', '', 'g'), 2))
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auth_user_created ON auth.users;
CREATE TRIGGER trg_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'profiles',
    'works',
    'authors',
    'work_authors',
    'reading_sessions',
    'reviews',
    'quotes_notes',
    'journal_entries',
    'wall_posts',
    'post_comments'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_updated_at ON public.%I;', tbl, tbl);
    EXECUTE format(
      'CREATE TRIGGER trg_%I_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();',
      tbl,
      tbl
    );
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 5. ROW LEVEL SECURITY (RLS)
-- ----------------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.works ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.authors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_authors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reading_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quotes_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wall_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.direct_messages ENABLE ROW LEVEL SECURITY;

-- profiles
DROP POLICY IF EXISTS profiles_select_policy ON public.profiles;
CREATE POLICY profiles_select_policy ON public.profiles
  FOR SELECT USING (public.can_view_profile(id, auth.uid()));

DROP POLICY IF EXISTS profiles_insert_policy ON public.profiles;
CREATE POLICY profiles_insert_policy ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS profiles_update_policy ON public.profiles;
CREATE POLICY profiles_update_policy ON public.profiles
  FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- works
DROP POLICY IF EXISTS works_select_policy ON public.works;
CREATE POLICY works_select_policy ON public.works
  FOR SELECT USING (public.can_view_profile(user_id, auth.uid()));

DROP POLICY IF EXISTS works_manage_own_policy ON public.works;
CREATE POLICY works_manage_own_policy ON public.works
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- authors
DROP POLICY IF EXISTS authors_select_policy ON public.authors;
CREATE POLICY authors_select_policy ON public.authors
  FOR SELECT USING (public.can_view_profile(user_id, auth.uid()));

DROP POLICY IF EXISTS authors_manage_own_policy ON public.authors;
CREATE POLICY authors_manage_own_policy ON public.authors
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- work_authors
DROP POLICY IF EXISTS work_authors_select_policy ON public.work_authors;
CREATE POLICY work_authors_select_policy ON public.work_authors
  FOR SELECT USING (public.can_view_profile(user_id, auth.uid()));

DROP POLICY IF EXISTS work_authors_manage_own_policy ON public.work_authors;
CREATE POLICY work_authors_manage_own_policy ON public.work_authors
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- reading_sessions
DROP POLICY IF EXISTS reading_sessions_manage_own_policy ON public.reading_sessions;
CREATE POLICY reading_sessions_manage_own_policy ON public.reading_sessions
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- reviews
DROP POLICY IF EXISTS reviews_select_policy ON public.reviews;
CREATE POLICY reviews_select_policy ON public.reviews
  FOR SELECT USING (public.can_view_profile(user_id, auth.uid()));

DROP POLICY IF EXISTS reviews_manage_own_policy ON public.reviews;
CREATE POLICY reviews_manage_own_policy ON public.reviews
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- quotes_notes
DROP POLICY IF EXISTS quotes_notes_select_policy ON public.quotes_notes;
CREATE POLICY quotes_notes_select_policy ON public.quotes_notes
  FOR SELECT USING (public.can_view_profile(user_id, auth.uid()));

DROP POLICY IF EXISTS quotes_notes_manage_own_policy ON public.quotes_notes;
CREATE POLICY quotes_notes_manage_own_policy ON public.quotes_notes
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- journal_entries
DROP POLICY IF EXISTS journal_entries_select_policy ON public.journal_entries;
CREATE POLICY journal_entries_select_policy ON public.journal_entries
  FOR SELECT USING (
    auth.uid() = user_id
    OR (
      visibility = 'public' AND public.can_view_profile(user_id, auth.uid())
    )
    OR (
      visibility = 'followers'
      AND auth.uid() IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.follows f
        WHERE f.follower_id = auth.uid() AND f.following_id = user_id AND f.status = 'approved'
      )
    )
    OR (
      visibility = 'inherit' AND public.can_view_profile(user_id, auth.uid())
    )
  );

DROP POLICY IF EXISTS journal_entries_manage_own_policy ON public.journal_entries;
CREATE POLICY journal_entries_manage_own_policy ON public.journal_entries
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- follows
DROP POLICY IF EXISTS follows_select_policy ON public.follows;
CREATE POLICY follows_select_policy ON public.follows
  FOR SELECT USING (
    auth.uid() = follower_id
    OR auth.uid() = following_id
    OR public.can_view_profile(following_id, auth.uid())
  );

DROP POLICY IF EXISTS follows_insert_policy ON public.follows;
CREATE POLICY follows_insert_policy ON public.follows
  FOR INSERT WITH CHECK (
    auth.uid() = follower_id
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = following_id AND p.privacy_level <> 'private'
    )
  );

DROP POLICY IF EXISTS follows_update_policy ON public.follows;
CREATE POLICY follows_update_policy ON public.follows
  FOR UPDATE USING (auth.uid() = following_id) WITH CHECK (auth.uid() = following_id);

DROP POLICY IF EXISTS follows_delete_policy ON public.follows;
CREATE POLICY follows_delete_policy ON public.follows
  FOR DELETE USING (auth.uid() = follower_id OR auth.uid() = following_id);

-- wall_posts
DROP POLICY IF EXISTS wall_posts_select_policy ON public.wall_posts;
CREATE POLICY wall_posts_select_policy ON public.wall_posts
  FOR SELECT USING (
    auth.uid() = author_id
    OR public.can_view_profile(profile_id, auth.uid())
  );

DROP POLICY IF EXISTS wall_posts_insert_policy ON public.wall_posts;
CREATE POLICY wall_posts_insert_policy ON public.wall_posts
  FOR INSERT WITH CHECK (
    auth.uid() = author_id
    AND (
      auth.uid() = profile_id
      OR (
        public.can_view_profile(profile_id, auth.uid())
        AND EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.id = profile_id AND p.allow_wall_posts = true
        )
      )
    )
  );

DROP POLICY IF EXISTS wall_posts_update_policy ON public.wall_posts;
CREATE POLICY wall_posts_update_policy ON public.wall_posts
  FOR UPDATE USING (auth.uid() = author_id) WITH CHECK (auth.uid() = author_id);

DROP POLICY IF EXISTS wall_posts_delete_policy ON public.wall_posts;
CREATE POLICY wall_posts_delete_policy ON public.wall_posts
  FOR DELETE USING (auth.uid() = author_id OR auth.uid() = profile_id);

-- post_reactions
DROP POLICY IF EXISTS post_reactions_select_policy ON public.post_reactions;
CREATE POLICY post_reactions_select_policy ON public.post_reactions
  FOR SELECT USING (
    public.can_view_target(journal_entry_id, wall_post_id, auth.uid())
  );

DROP POLICY IF EXISTS post_reactions_insert_policy ON public.post_reactions;
CREATE POLICY post_reactions_insert_policy ON public.post_reactions
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND public.can_view_target(journal_entry_id, wall_post_id, auth.uid())
  );

DROP POLICY IF EXISTS post_reactions_delete_policy ON public.post_reactions;
CREATE POLICY post_reactions_delete_policy ON public.post_reactions
  FOR DELETE USING (auth.uid() = user_id);

-- post_comments
DROP POLICY IF EXISTS post_comments_select_policy ON public.post_comments;
CREATE POLICY post_comments_select_policy ON public.post_comments
  FOR SELECT USING (
    public.can_view_target(journal_entry_id, wall_post_id, auth.uid())
  );

DROP POLICY IF EXISTS post_comments_insert_policy ON public.post_comments;
CREATE POLICY post_comments_insert_policy ON public.post_comments
  FOR INSERT WITH CHECK (
    auth.uid() = author_id
    AND public.can_comment_target(journal_entry_id, wall_post_id, auth.uid())
  );

DROP POLICY IF EXISTS post_comments_update_policy ON public.post_comments;
CREATE POLICY post_comments_update_policy ON public.post_comments
  FOR UPDATE USING (auth.uid() = author_id) WITH CHECK (auth.uid() = author_id);

DROP POLICY IF EXISTS post_comments_delete_policy ON public.post_comments;
CREATE POLICY post_comments_delete_policy ON public.post_comments
  FOR DELETE USING (
    auth.uid() = author_id
    OR (
      journal_entry_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.journal_entries j
        WHERE j.id = journal_entry_id AND j.user_id = auth.uid()
      )
    )
    OR (
      wall_post_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.wall_posts w
        WHERE w.id = wall_post_id AND w.profile_id = auth.uid()
      )
    )
  );

-- direct_messages
DROP POLICY IF EXISTS direct_messages_select_policy ON public.direct_messages;
CREATE POLICY direct_messages_select_policy ON public.direct_messages
  FOR SELECT USING (auth.uid() = sender_id OR auth.uid() = recipient_id);

DROP POLICY IF EXISTS direct_messages_insert_policy ON public.direct_messages;
CREATE POLICY direct_messages_insert_policy ON public.direct_messages
  FOR INSERT WITH CHECK (
    auth.uid() = sender_id
    AND EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = recipient_id
        AND p.allow_dms = true
        AND public.can_view_profile(recipient_id, auth.uid())
    )
  );

DROP POLICY IF EXISTS direct_messages_update_policy ON public.direct_messages;
CREATE POLICY direct_messages_update_policy ON public.direct_messages
  FOR UPDATE USING (auth.uid() = recipient_id) WITH CHECK (auth.uid() = recipient_id);

DROP POLICY IF EXISTS direct_messages_delete_policy ON public.direct_messages;
CREATE POLICY direct_messages_delete_policy ON public.direct_messages
  FOR DELETE USING (auth.uid() = sender_id OR auth.uid() = recipient_id);

-- ----------------------------------------------------------------------------
-- 6. REALTIME PUBLICATION
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  rt_tbl text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH rt_tbl IN ARRAY ARRAY[
      'profiles',
      'works',
      'authors',
      'work_authors',
      'reading_sessions',
      'reviews',
      'quotes_notes',
      'journal_entries',
      'follows',
      'wall_posts',
      'post_reactions',
      'post_comments',
      'direct_messages'
    ]
    LOOP
      IF NOT EXISTS (
        SELECT 1
        FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = rt_tbl
      ) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I;', rt_tbl);
      END IF;
    END LOOP;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 7. EXTENSÕES DE COMPATIBILIDADE SOCIAL (Bloco 3)
-- ----------------------------------------------------------------------------
ALTER TABLE public.follows
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'approved'
  CHECK (status IN ('pending', 'approved'));

ALTER TABLE public.wall_posts
  ADD COLUMN IF NOT EXISTS pinned boolean NOT NULL DEFAULT false;

ALTER TABLE public.direct_messages
  ADD COLUMN IF NOT EXISTS attached_work_snapshot jsonb;

-- ----------------------------------------------------------------------------
-- 8. DISCRIMINADOR @HANDLE#XXXX & ÍNDICES DE BUSCA (Fase 6)
-- ----------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS discriminator text;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS user_tag text;

CREATE INDEX IF NOT EXISTS idx_profiles_user_tag_lower
  ON public.profiles (lower(user_tag));

CREATE INDEX IF NOT EXISTS idx_profiles_display_name_lower
  ON public.profiles (lower(display_name));
