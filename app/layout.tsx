import type { Metadata, Viewport } from "next";
import { Noto_Sans_Mono } from "next/font/google";
import Script from "next/script";
import { PwaRegistration } from "@/components/PwaRegistration";
import { PwaInstallPrompt } from "@/components/PwaInstallPrompt";
import { PwaIosHint } from "@/components/PwaIosHint";
import { PwaUpdateToast } from "@/components/PwaUpdateToast";
import "katex/dist/katex.min.css";
import "./globals.css";

const notoSansMono = Noto_Sans_Mono({
  subsets: ["latin", "cyrillic"],
  variable: "--font-noto-mono",
  display: "swap",
});

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
    statusBarStyle: "black-translucent",
    title: "Pi Web",
  },
  formatDetection: {
    telephone: false,
  },
  openGraph: {
    type: "website",
    siteName: "Pi Web",
    title: "Pi Web",
    description: "Pi Web interface for the pi coding agent",
    images: [
      {
        url: "/icons/icon-512.png",
        width: 512,
        height: 512,
        alt: "Pi Web",
      },
    ],
  },
  twitter: {
    card: "summary",
    title: "Pi Web",
    description: "Pi Web interface for the pi coding agent",
    images: ["/icons/icon-512.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: [
    // Match manifest.ts theme_color / background_color so the address bar
    // and status bar use the same value as the app body — Chrome's PWA
    // WebAPK builder consults both sources and picks whichever disagrees
    // last.
    { media: "(prefers-color-scheme: light)", color: "#f5f5f5" },
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
        {/* iOS Smart App Banner suggesting Tailscale, so a phone on another
            network can join the tailnet and reach this server. Rendered
            unconditionally: `/` is statically prerendered, so a
            `process.env.PI_WEB_HOSTNAME` check here would be evaluated at build
            time (always undefined) rather than per request. Safari shows "OPEN"
            instead of "VIEW" when Tailscale is already installed, so the banner
            degrades harmlessly for users already on the tailnet. */}
        <meta name="apple-itunes-app" content="app-id=1470499037, app-argument=tailscale://" />
        <Script id="pi-theme-init" strategy="beforeInteractive">
          {`(function(){try{var t=localStorage.getItem("pi-theme");var d=t==="dark"||((t==null||t===""||t==="auto")&&window.matchMedia("(prefers-color-scheme: dark)").matches);if(d)document.documentElement.classList.add("dark")}catch(e){}})();`}
        </Script>
      </head>
      <body translate="no" className="notranslate" suppressHydrationWarning>
        {children}
        <PwaRegistration />
        <PwaInstallPrompt />
        <PwaIosHint />
        <PwaUpdateToast />
      </body>
    </html>
  );
}
