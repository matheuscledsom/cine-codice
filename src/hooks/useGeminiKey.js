import { useCallback, useEffect, useState } from 'react';
import { domainConfig } from '../config/domainConfig';
import { sanitizeGeminiKey } from '../services/geminiApi';

const GEMINI_KEY_STORAGE = domainConfig.geminiStorageKey;

function loadGeminiKey() {
  try {
    return sanitizeGeminiKey(localStorage.getItem(GEMINI_KEY_STORAGE));
  } catch {
    return '';
  }
}

export function useGeminiKey() {
  const [apiKey, setApiKey] = useState(loadGeminiKey);

  useEffect(() => {
    try {
      if (apiKey) {
        localStorage.setItem(GEMINI_KEY_STORAGE, apiKey);
      } else {
        localStorage.removeItem(GEMINI_KEY_STORAGE);
      }
    } catch {
      // Ignora erro caso quota de storage esteja indisponível
    }
  }, [apiKey]);

  const saveApiKey = useCallback((nextKey) => {
    setApiKey(sanitizeGeminiKey(nextKey));
  }, []);

  const clearApiKey = useCallback(() => {
    setApiKey('');
  }, []);

  return {
    apiKey,
    hasGeminiKey: Boolean(apiKey),
    saveApiKey,
    clearApiKey,
  };
}
