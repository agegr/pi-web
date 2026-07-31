import type { Metadata, Viewport } from "next";
import { PwaRegistration } from "@/components/PwaRegistration";
import "katex/dist/katex.min.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "omp-web",
  description: "Web view for the omp (oh-my-pi) coding agent",
  applicationName: "omp-web",
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
    title: "omp-web",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  // Matches --bg in app/globals.css: omp's `light` page surface and the
  // `titanium` brushed-titanium surface.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#151820" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" translate="no" className="notranslate" suppressHydrationWarning>
      <head>
        <meta name="google" content="notranslate" />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var r=document.documentElement,m=localStorage.getItem("omp-theme")==="dark"?"dark":"light",c=JSON.parse(localStorage.getItem("omp-theme-config")||"null"),p=c&&c.palettes&&c.palettes[m];r.dataset.ompThemeMode=m;if(p){Object.keys(p.variables).forEach(function(k){r.style.setProperty(k,p.variables[k])});r.dataset.ompThemeName=p.name;r.style.colorScheme=p.colorScheme;r.classList.toggle("dark",p.colorScheme==="dark")}else{r.classList.toggle("dark",m==="dark")}}catch(e){}})();`,
          }}
        />
      </head>
      <body translate="no" className="notranslate" style={{ height: "100dvh", display: "flex", flexDirection: "column" }}>
        {children}
        <PwaRegistration />
      </body>
    </html>
  );
}
