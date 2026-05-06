"use client";

import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "council-hud-uplink-url";
const DEFAULT_URL = process.env.NEXT_PUBLIC_NEXUS_HUD_URL || "/api/nexus";

function normalizeUplinkUrl(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.startsWith("/")) {
    return trimmed.replace(/\/+$/, "") || "/";
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return null;
    }
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function isLegacyTunnelUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.hostname.endsWith(".loca.lt");
  } catch {
    return false;
  }
}

export function useUplink() {
  const [url, setUrl] = useState<string>(DEFAULT_URL);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const hydrateUrl = () => {
      const saved = localStorage.getItem(STORAGE_KEY);
      const savedUrl = saved ? normalizeUplinkUrl(saved) : null;
      if (savedUrl && !isLegacyTunnelUrl(savedUrl)) {
        setUrl(savedUrl);
      } else if (saved) {
        localStorage.removeItem(STORAGE_KEY);
        setUrl(DEFAULT_URL);
      } else {
        setUrl(DEFAULT_URL);
      }
      setIsReady(true);
    };

    hydrateUrl();
    window.addEventListener("storage", hydrateUrl);
    window.addEventListener("council-hud-uplink-change", hydrateUrl);

    return () => {
      window.removeEventListener("storage", hydrateUrl);
      window.removeEventListener("council-hud-uplink-change", hydrateUrl);
    };
  }, []);

  const updateUrl = useCallback((newUrl: string) => {
    const formattedUrl = normalizeUplinkUrl(newUrl);
    if (!formattedUrl) return;
    setUrl(formattedUrl);

    if (formattedUrl === DEFAULT_URL) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, formattedUrl);
    }

    window.dispatchEvent(new Event("council-hud-uplink-change"));
  }, []);

  return { url, updateUrl, isReady };
}
