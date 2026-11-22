import { useCallback, useState } from 'react';
import {
  clearAiKeyForProvider,
  getActiveExternalProviderInfo,
  loadAiKeys,
  loadAiPreferences,
  saveAiKeyForProvider,
  saveAiPreferences,
} from '../services/aiProvider';
import {
  loadOmdbApiKey,
  loadTmdbApiKey,
  saveOmdbApiKey,
  saveTmdbApiKey,
} from '../services/cinemaApi';

export function useAiConfig() {
  const [keys, setKeys] = useState(() => ({
    ...loadAiKeys(),
    tmdb: loadTmdbApiKey(),
    omdb: loadOmdbApiKey(),
  }));
  const [preferences, setPreferences] = useState(loadAiPreferences);

  const saveProviderKey = useCallback((providerId, rawKey) => {
    if (providerId === 'tmdb') {
      const clean = saveTmdbApiKey(rawKey);
      setKeys((prev) => ({ ...prev, tmdb: clean }));
      return clean;
    }
    if (providerId === 'omdb') {
      const clean = saveOmdbApiKey(rawKey);
      setKeys((prev) => ({ ...prev, omdb: clean }));
      return clean;
    }
    const clean = saveAiKeyForProvider(providerId, rawKey);
    setKeys((prev) => ({ ...prev, [providerId]: clean }));
    return clean;
  }, []);

  const clearProviderKey = useCallback((providerId) => {
    if (providerId === 'tmdb') {
      saveTmdbApiKey('');
      setKeys((prev) => ({ ...prev, tmdb: '' }));
      return;
    }
    if (providerId === 'omdb') {
      saveOmdbApiKey('');
      setKeys((prev) => ({ ...prev, omdb: '' }));
      return;
    }
    clearAiKeyForProvider(providerId);
    setKeys((prev) => ({ ...prev, [providerId]: '' }));
  }, []);

  const updatePreferences = useCallback((nextPrefs) => {
    const saved = saveAiPreferences(nextPrefs);
    setPreferences(saved);
    return saved;
  }, []);

  const hasAnyAiKey = Boolean(keys.gemini || keys.groq || keys.openrouter);
  const activeProvider = getActiveExternalProviderInfo(keys, preferences);

  return {
    keys,
    preferences,
    hasAnyAiKey,
    hasGeminiKey: Boolean(keys.gemini),
    geminiKey: keys.gemini,
    tmdbKey: keys.tmdb,
    omdbKey: keys.omdb,
    activeProvider,
    saveProviderKey,
    clearProviderKey,
    updatePreferences,
  };
}
