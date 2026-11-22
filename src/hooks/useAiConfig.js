import { useCallback, useState } from 'react';
import {
  clearAiKeyForProvider,
  getActiveExternalProviderInfo,
  loadAiKeys,
  loadAiPreferences,
  saveAiKeyForProvider,
  saveAiPreferences,
} from '../services/aiProvider';
import { loadTmdbApiKey, saveTmdbApiKey } from '../services/cinemaApi';

export function useAiConfig() {
  const [keys, setKeys] = useState(() => ({
    ...loadAiKeys(),
    tmdb: loadTmdbApiKey(),
  }));
  const [preferences, setPreferences] = useState(loadAiPreferences);

  const saveProviderKey = useCallback((providerId, rawKey) => {
    if (providerId === 'tmdb') {
      const clean = saveTmdbApiKey(rawKey);
      setKeys((prev) => ({ ...prev, tmdb: clean }));
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
    activeProvider,
    saveProviderKey,
    clearProviderKey,
    updatePreferences,
  };
}
