import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Noto_Sans_Mono } from "next/font/google";
import { PwaRegistration } from "@/components/PwaRegistration";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import "katex/dist/katex.min.css";
import "./globals.css";
import "./settings.css";

const notoSansMono = Noto_Sans_Mono({
  subsets: ["latin", "cyrillic"],
  variable: "--font-noto-mono",
  display: "swap",
});

const basePath = process.env.PI_WEB_BASE_PATH ?? "";

export const metadata: Metadata = {
  title: "Pi Web",
  description: "Pi Web interface for the pi coding agent",
  applicationName: "Pi Web",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      {
        url: `${basePath}/icons/icon-192.png`,
        sizes: "192x192",
        type: "image/png",
      },
    ],
    apple: [
      {
        url: `${basePath}/icons/apple-touch-icon.png`,
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
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
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
    <html
      lang="en"
      translate="no"
      className={`${notoSansMono.variable} notranslate`}
      suppressHydrationWarning
    >
      <head>
        <meta name="google" content="notranslate" />
        <script
          dangerouslySetInnerHTML={{
            __html: THEME_INIT_SCRIPT,
          }}
        />
        {/* basePath 下,Next.js 只管 Link/router/资源路径,不管代码里裸 fetch("/api/...")
            这种绝对路径(浏览器会解析到域名根 → 404)。这里用 beforeInteractive 同步脚本
            patch window.fetch 和 window.EventSource,在所有业务 module 执行前把 /api/* 统一加上前缀。 */}
        <Script id="pi-web-basepath-api-patch" strategy="beforeInteractive">
          {`(function(){var b=${JSON.stringify(basePath)};if(!b)return;var fix=function(u){return(u==="/api"||u.indexOf("/api/")===0)?b+u:u};var of=window.fetch.bind(window);window.fetch=function(i,n){if(typeof i==="string")i=fix(i);else if(i instanceof URL)i=new URL(fix(i.pathname+i.search),i.origin);return of(i,n)};var OE=window.EventSource;if(OE){window.EventSource=function(u,c){return new OE(typeof u==="string"?fix(u):u,c)};window.EventSource.prototype=OE.prototype}var XO=window.XMLHttpRequest&&window.XMLHttpRequest.prototype.open;if(XO){window.XMLHttpRequest.prototype.open=function(){var a=[].slice.call(arguments);if(typeof a[1]==="string")a[1]=fix(a[1]);return XO.apply(this,a)}}})();`}
        </Script>
      </head>
      <body translate="no" className="notranslate" suppressHydrationWarning>
        {children}
        <PwaRegistration />
      </body>
    </html>
  );
}
