import type { Metadata } from "next";
import { Noto_Sans_Mono } from "next/font/google";
import "katex/dist/katex.min.css";
import "./globals.css";
import { I18nProvider } from "@/hooks/useI18n";

const notoSansMono = Noto_Sans_Mono({
  subsets: ["latin", "cyrillic"],
  variable: "--font-noto-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Pi Web",
  description: "Pi Web interface for the pi coding agent",
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
            __html: `(function(){var t="system";try{var s=localStorage.getItem("pi-theme");if(s==="light"||s==="dark"||s==="system")t=s}catch(e){}var d=t==="dark";if(t==="system")try{d=!!(window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches)}catch(e){d=false}if(d)document.documentElement.classList.add("dark")})();`,
          }}
        />
      </head>
      <body translate="no" className="notranslate" style={{ height: "100dvh", display: "flex", flexDirection: "column" }}>
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  );
}
