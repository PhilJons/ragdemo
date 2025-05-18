import type { Metadata } from "next";
import SessionProviderWrapper from "@/components/auth/SessionProviderWrapper";
import { ThemeProvider } from 'next-themes';
import "./(preview)/globals.css"; // Adjusted path to globals.css

export const metadata: Metadata = {
  title: "Secure RAG Application",
  description: "Login to access the Secure RAG Application",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <SessionProviderWrapper>
          <ThemeProvider attribute="data-theme" defaultTheme="system" enableSystem>
            {children}
          </ThemeProvider>
        </SessionProviderWrapper>
      </body>
    </html>
  );
} 