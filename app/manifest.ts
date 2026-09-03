import type { MetadataRoute } from "next";

const basePath = process.env.PI_WEB_BASE_PATH ?? "";

export default function manifest(): MetadataRoute.Manifest {
    return {
        id: `${basePath}/`,
        name: "Pi Web",
        short_name: "Pi Web",
        description: "Local web interface for the pi coding agent",
        start_url: `${basePath}/`,
        scope: `${basePath}/`,
        display: "standalone",
        background_color: "#1a1a1a",
        theme_color: "#1a1a1a",
        categories: ["developer", "productivity"],
        lang: "en",
        icons: [
            {
                src: `${basePath}/icons/icon-192.png`,
                sizes: "192x192",
                type: "image/png",
                purpose: "any",
            },
            {
                src: `${basePath}/icons/icon-512.png`,
                sizes: "512x512",
                type: "image/png",
                purpose: "any",
            },
        ],
    };
}
