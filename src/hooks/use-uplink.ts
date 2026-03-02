"use client";

import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "council-hud-uplink-url";
const DEFAULT_URL = "https://great-suits-battle.loca.lt";

export function useUplink() {
  const [url, setUrl] = useState<string>(DEFAULT_URL);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      setUrl(saved);
    } else {
      setUrl(DEFAULT_URL);
    }
    setIsReady(true);
  }, []);

  const updateUrl = useCallback((newUrl: string) => {
    const formattedUrl = newUrl.replace(/\/$/, ""); // Remove trailing slash
    setUrl(formattedUrl);
    localStorage.setItem(STORAGE_KEY, formattedUrl);
    // Trigger a storage event for other components
    window.dispatchEvent(new Event("storage"));
  }, []);

  return { url, updateUrl, isReady };
}
