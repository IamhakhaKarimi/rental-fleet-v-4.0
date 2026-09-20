import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Balkan Car Rentals — Fleet Console",
  description: "Fleet Console v4.0",
};

/**
 * There was no viewport export at all — Next's default covers width/scale, but
 * `viewportFit: "cover"` is what makes `env(safe-area-inset-*)` resolve to
 * anything but 0. The bottom nav bar and the burger sheet both pad themselves
 * with it so they clear the home indicator on a notched phone.
 *
 * Note there is no `maximumScale`: pinch-zoom stays available, because taking it
 * away breaks accessibility for anyone who relies on it.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

// Apply the saved night-mode preference before paint to avoid a flash.
const themeBoot = `(function(){try{if(localStorage.getItem('bcr_dark')==='1')document.documentElement.classList.add('dark');}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBoot }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
