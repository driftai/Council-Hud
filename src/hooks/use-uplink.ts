"use client";

import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "council-hud-uplink-url";
const DEFAULT_URL = "https://great-suits-battle.loca.lt";

function normalizeUplinkUrl(value: string): string | null {
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return null;
    }
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function useUplink() {
  const [url, setUrl] = useState<string>(DEFAULT_URL);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    const savedUrl = saved ? normalizeUplinkUrl(saved) : null;
    if (savedUrl) {
      setUrl(savedUrl);
    } else if (saved) {
      localStorage.removeItem(STORAGE_KEY);
      setUrl(DEFAULT_URL);
    } else {
      setUrl(DEFAULT_URL);
    }
    setIsReady(true);
  }, []);

  const updateUrl = useCallback((newUrl: string) => {
    const formattedUrl = normalizeUplinkUrl(newUrl);
    if (!formattedUrl) return;
    setUrl(formattedUrl);
    localStorage.setItem(STORAGE_KEY, formattedUrl);
    // Trigger a storage event for other components
    window.dispatchEvent(new Event("storage"));
  }, []);

  return { url, updateUrl, isReady };
}
