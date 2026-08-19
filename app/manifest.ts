import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    // No `id` field — let Chrome derive it from `start_url`. Setting an
    // explicit id (e.g. "/") causes Chrome to reuse any prior WebAPK
    // metadata for this origin, including failed/successful install
    // state. A failed WebAPK install leaves an entry that makes every
    // subsequent install fall back to a home-screen shortcut instead of
    // rebuilding the APK. Dropping the id forces Chrome to mint a fresh
    // entry on the next install.
    name: "Pi Web",
    short_name: "Pi Web",
    description: "Local web interface for the pi coding agent",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#ffffff",
    theme_color: "#f5f5f5",
    categories: ["developer", "productivity"],
    lang: "en",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    screenshots: [
      {
        src: "/screenshots/desktop-wide.png",
        sizes: "1280x720",
        type: "image/png",
        form_factor: "wide",
        label: "Pi Web desktop session",
      },
      {
        src: "/screenshots/mobile-narrow.png",
        sizes: "750x1334",
        type: "image/png",
        form_factor: "narrow",
        label: "Pi Web mobile chat",
      },
    ],
    shortcuts: [
      {
        name: "New session",
        short_name: "New",
        description: "Start a fresh Pi coding session",
        url: "/?action=new",
        icons: [
          {
            src: "/icons/shortcut-new.png",
            sizes: "96x96",
            type: "image/png",
          },
        ],
      },
    ],
  };
}
