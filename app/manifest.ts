import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "omp-web",
    short_name: "omp-web",
    description: "Local web view for the omp (oh-my-pi) coding agent",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#151820",
    theme_color: "#151820",
    orientation: "any",
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
    ],
  };
}
