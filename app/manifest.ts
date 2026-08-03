import type { MetadataRoute } from "next";
import { withBasePath } from "@/lib/base-path";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: withBasePath("/"),
    name: "Pi Web",
    short_name: "Pi Web",
    description: "Local web interface for the pi coding agent",
    start_url: withBasePath("/"),
    scope: withBasePath("/"),
    display: "standalone",
    background_color: "#1a1a1a",
    theme_color: "#1a1a1a",
    orientation: "any",
    categories: ["developer", "productivity"],
    lang: "en",
    icons: [
      {
        src: withBasePath("/icons/icon-192.png"),
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: withBasePath("/icons/icon-512.png"),
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
