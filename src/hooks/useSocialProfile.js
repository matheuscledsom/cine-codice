import { useCallback, useEffect, useState } from 'react';
import { buildPublicProfileLink, domainConfig } from '../config/domainConfig';
import { migrateFavoriteGenresToObjects } from '../lib/genreCatalog';
import { normalizeViewerFocusList } from '../lib/migrations';
import {
  normalizePreferredCriteria,
} from '../utils/readerPreferences';

const PROFILE_KEY = domainConfig.profileStorageKey;
const POSTS_KEY = domainConfig.postsStorageKey;

function normalizePrivacyLevel(value) {
  if (value === 'followers' || value === 'private' || value === 'public') {
    return value;
  }
  return 'public';
}

function getDefaultProfile() {
  const { profile } = domainConfig.ui;
  return {
    id: 'local-primary',
    displayName: profile.displayName,
    handle: profile.handle,
    email: '',
    avatarInitials: profile.avatarInitials,
    avatarUrl: profile.avatarUrl || '',
    coverUrl: profile.coverUrl || '',
    bio: profile.bio,
    linkLabel: profile.linkLabel,
    linkUrl: profile.linkUrl,
    age: '',
    viewerFocus: ['Cinéfilo Curador'],
    readerFocus: 'Cinéfilo Curador',
    annualGoal: 24,
    preferredFormat: 'Streaming',
    preferredCriteria: ['Roteiro & Ritmo'],
    preferredCriterion: 'Roteiro & Ritmo',
    preferredAtmosphere: 'Tinta OLED',
    favoriteGenres: [],
    profileSchemaVersion: 3,
    privacyLevel: 'public',
    allowWallPosts: true,
    allowComments: true,
    allowDms: true,
    gamificationEnabled: true,
    calmMode: false,
    activeTitleBadge: '',
    onboardingCompleted: false,
  };
}

function normalizeProfileObject(rawProfile, fallback) {
  const base = fallback || getDefaultProfile();
  const parsed = rawProfile && typeof rawProfile === 'object' ? rawProfile : {};
  const preferredCriteria = normalizePreferredCriteria(
    parsed.preferredCriteria ?? parsed.preferred_criteria,
    parsed.preferredCriterion ?? parsed.preferred_criterion,
    base.preferredCriteria
  );
  const viewerFocus = normalizeViewerFocusList(
    parsed.viewerFocus ?? parsed.viewer_focus,
    parsed.readerFocus ?? parsed.reader_focus ?? base.readerFocus
  );
  const merged = {
    ...base,
    ...parsed,
    viewerFocus,
    readerFocus: viewerFocus[0] || base.readerFocus,
    annualGoal: Math.max(
      1,
      Number(parsed.annualGoal ?? parsed.annual_goal) || base.annualGoal
    ),
    preferredCriteria,
    preferredCriterion: preferredCriteria.join(', '),
    favoriteGenres: migrateFavoriteGenresToObjects(
      parsed.favoriteGenres ?? parsed.favorite_genres ?? base.favoriteGenres
    ),
    privacyLevel: normalizePrivacyLevel(
      parsed.privacyLevel ?? parsed.privacy_level ?? base.privacyLevel
    ),
    allowWallPosts:
      parsed.allowWallPosts !== undefined
        ? Boolean(parsed.allowWallPosts)
        : parsed.allow_wall_posts !== undefined
          ? Boolean(parsed.allow_wall_posts)
          : base.allowWallPosts,
    allowComments:
      parsed.allowComments !== undefined
        ? Boolean(parsed.allowComments)
        : parsed.allow_comments !== undefined
          ? Boolean(parsed.allow_comments)
          : base.allowComments,
    allowDms:
      parsed.allowDms !== undefined
        ? Boolean(parsed.allowDms)
        : parsed.allow_dms !== undefined
          ? Boolean(parsed.allow_dms)
          : base.allowDms,
    gamificationEnabled:
      parsed.gamificationEnabled !== undefined
        ? Boolean(parsed.gamificationEnabled)
        : parsed.gamification_enabled !== undefined
          ? Boolean(parsed.gamification_enabled)
          : base.gamificationEnabled,
    calmMode:
      parsed.calmMode !== undefined
        ? Boolean(parsed.calmMode)
        : parsed.calm_mode !== undefined
          ? Boolean(parsed.calm_mode)
          : Boolean(base.calmMode),
    activeTitleBadge:
      typeof (parsed.activeTitleBadge ?? parsed.active_title_badge) === 'string'
        ? parsed.activeTitleBadge ?? parsed.active_title_badge
        : base.activeTitleBadge,
    onboardingCompleted:
      parsed.onboardingCompleted !== undefined
        ? Boolean(parsed.onboardingCompleted)
        : Boolean(parsed.displayName && parsed.displayName !== base.displayName),
  };

  if (!merged.linkLabel || /^mlpd\.livros\//i.test(merged.linkLabel)) {
    const publicLink = buildPublicProfileLink(merged.handle);
    merged.linkLabel = publicLink.label;
    merged.linkUrl = publicLink.url;
  }

  return merged;
}

function loadProfile() {
  const fallback = getDefaultProfile();
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return fallback;
    return normalizeProfileObject(parsed, fallback);
  } catch {
    return fallback;
  }
}

function loadPosts() {
  try {
    const raw = localStorage.getItem(POSTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function useSocialProfile({ migrationLocked = false } = {}) {
  const [profile, setProfile] = useState(loadProfile);
  const [posts, setPosts] = useState(loadPosts);

  useEffect(() => {
    if (migrationLocked) return;
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    } catch {
      // Ignora erro caso quota de storage esteja cheia
    }
  }, [profile, migrationLocked]);

  useEffect(() => {
    if (migrationLocked) return;
    try {
      localStorage.setItem(POSTS_KEY, JSON.stringify(posts));
    } catch {
      // Ignora erro caso quota de storage esteja cheia
    }
  }, [posts, migrationLocked]);

  const updateProfile = useCallback((updates) => {
    setProfile((prev) => {
      const next = { ...prev, ...updates };
      if (updates.displayName !== undefined && !updates.avatarInitials) {
        const words = String(updates.displayName || '')
          .trim()
          .split(/\s+/)
          .filter(Boolean);
        next.avatarInitials =
          words.length >= 2
            ? `${words[0][0]}${words[1][0]}`.toUpperCase()
            : String(updates.displayName || 'AK').slice(0, 2).toUpperCase();
      }
      if (updates.handle && !updates.handle.startsWith('@')) {
        next.handle = `@${updates.handle.trim()}`;
      }
      if (
        updates.handle !== undefined &&
        updates.linkLabel === undefined &&
        (!prev.linkLabel || /^codice\.app\/@/i.test(prev.linkLabel))
      ) {
        const publicLink = buildPublicProfileLink(next.handle);
        next.linkLabel = publicLink.label;
        next.linkUrl = publicLink.url;
      }
      if (updates.annualGoal !== undefined) {
        next.annualGoal = Math.max(1, Number(updates.annualGoal) || 12);
      }
      if (
        updates.preferredCriteria !== undefined ||
        updates.preferredCriterion !== undefined
      ) {
        const normalizedCriteria = normalizePreferredCriteria(
          updates.preferredCriteria,
          updates.preferredCriterion,
          prev.preferredCriteria
        );
        next.preferredCriteria = normalizedCriteria;
        next.preferredCriterion = normalizedCriteria.join(', ');
      }
      if (updates.viewerFocus !== undefined || updates.readerFocus !== undefined) {
        const nextFocus = normalizeViewerFocusList(
          updates.viewerFocus ?? updates.viewer_focus,
          updates.readerFocus ?? updates.reader_focus ?? prev.readerFocus
        );
        next.viewerFocus = nextFocus;
        next.readerFocus = nextFocus[0] || 'Cinéfilo Curador';
      }
      if (updates.favoriteGenres !== undefined) {
        next.favoriteGenres = migrateFavoriteGenresToObjects(updates.favoriteGenres);
      }
      if (updates.privacyLevel !== undefined || updates.privacy_level !== undefined) {
        next.privacyLevel = normalizePrivacyLevel(
          updates.privacyLevel ?? updates.privacy_level
        );
      }
      if (updates.allowWallPosts !== undefined) {
        next.allowWallPosts = Boolean(updates.allowWallPosts);
      }
      if (updates.allowComments !== undefined) {
        next.allowComments = Boolean(updates.allowComments);
      }
      if (updates.allowDms !== undefined) {
        next.allowDms = Boolean(updates.allowDms);
      }
      if (updates.gamificationEnabled !== undefined) {
        next.gamificationEnabled = Boolean(updates.gamificationEnabled);
      }
      if (updates.calmMode !== undefined) {
        next.calmMode = Boolean(updates.calmMode);
      }
      return next;
    });
  }, []);

  const addPost = useCallback((postData) => {
    const newPost = {
      id: `post-${Date.now()}`,
      itemId: postData.itemId || null,
      itemTitle: postData.itemTitle || '',
      itemSnapshot: postData.itemSnapshot || null,
      progressMarker: String(postData.progressMarker || '').trim(),
      title: String(postData.title || '').trim(),
      caption: String(postData.caption || '').trim(),
      media: Array.isArray(postData.media) ? postData.media : [],
      visibility: postData.visibility || 'inherit',
      highlightColor: postData.highlightColor || '',
      comments: [],
      createdAt: new Date().toISOString(),
    };

    setPosts((prev) => [newPost, ...prev]);
    return newPost;
  }, []);

  const deletePost = useCallback((postId) => {
    setPosts((prev) => prev.filter((post) => post.id !== postId));
  }, []);

  const addPostComment = useCallback((postId, text) => {
    const cleanText = String(text || '').trim();
    if (!cleanText) return;

    const newComment = {
      id: `comment-${Date.now()}`,
      text: cleanText,
      createdAt: new Date().toISOString(),
    };

    setPosts((prev) =>
      prev.map((post) =>
        post.id === postId
          ? { ...post, comments: [...(post.comments || []), newComment] }
          : post
      )
    );
  }, []);

  const deletePostComment = useCallback((postId, commentId) => {
    setPosts((prev) =>
      prev.map((post) =>
        post.id === postId
          ? {
              ...post,
              comments: (post.comments || []).filter((c) => c.id !== commentId),
            }
          : post
      )
    );
  }, []);

  const restoreSocialBackup = useCallback(
    ({ profile: savedProfile, posts: savedPosts }) => {
      if (savedProfile && typeof savedProfile === 'object') {
        const defaultFallback = getDefaultProfile();
        const normalized = normalizeProfileObject(
          {
            ...savedProfile,
            onboardingCompleted:
              savedProfile.onboardingCompleted !== undefined
                ? Boolean(savedProfile.onboardingCompleted)
                : true,
          },
          defaultFallback
        );
        setProfile(normalized);
      } else {
        setProfile((prev) => ({ ...prev, onboardingCompleted: true }));
      }
      if (Array.isArray(savedPosts)) {
        setPosts(savedPosts);
      }
    },
    []
  );

  return {
    profile,
    posts,
    updateProfile,
    addPost,
    deletePost,
    addPostComment,
    deletePostComment,
    restoreSocialBackup,
  };
}
