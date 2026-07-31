import type { Metadata, Viewport } from "next";
import { Noto_Sans_Mono } from "next/font/google";
import Script from "next/script";
import { PwaRegistration } from "@/components/PwaRegistration";
import "katex/dist/katex.min.css";
import "./globals.css";

const notoSansMono = Noto_Sans_Mono({
  subsets: ["latin", "cyrillic"],
  variable: "--font-noto-mono",
  display: "swap",
});

const DEV_PWA_CLEANUP_SCRIPT = `(function(){
  if (!("serviceWorker" in navigator)) return;
  Promise.all([
    navigator.serviceWorker.getRegistrations().then(function(registrations){
      return Promise.all(registrations.map(function(registration){ return registration.unregister(); }));
    }),
    ("caches" in window) ? caches.keys().then(function(keys){
      return Promise.all(keys.filter(function(key){ return key.indexOf("pi-web-") === 0; }).map(function(key){ return caches.delete(key); }));
    }) : Promise.resolve()
  ]).then(function(){
    if (navigator.serviceWorker.controller && !sessionStorage.getItem("pi-web-dev-sw-cleaned")) {
      sessionStorage.setItem("pi-web-dev-sw-cleaned", "1");
      location.reload();
    } else {
      sessionStorage.removeItem("pi-web-dev-sw-cleaned");
    }
  }).catch(function(error){ console.error("PWA 开发缓存清理失败", error); });
})();`;

export const metadata: Metadata = {
  title: "Pi Web",
  description: "Pi Web interface for the pi coding agent",
  applicationName: "Pi Web",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      {
        url: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
    ],
    apple: [
      {
        url: "/icons/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Pi Web",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#1a1a1a" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" translate="no" className={`${notoSansMono.variable} notranslate`} suppressHydrationWarning>
      <head>
        <meta name="google" content="notranslate" />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("pi-theme");if(t==="dark")document.documentElement.classList.add("dark")}catch(e){}})();`,
          }}
        />
        {process.env.NODE_ENV !== "production" && (
          <Script id="dev-pwa-cleanup" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: DEV_PWA_CLEANUP_SCRIPT }} />
        )}
      </head>
      <body translate="no" className="notranslate" style={{ height: "100dvh", display: "flex", flexDirection: "column" }}>
        {children}
        <PwaRegistration />
      </body>
    </html>
  );
}
