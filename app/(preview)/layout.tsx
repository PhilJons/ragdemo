import AuthGuard from "@/components/auth/AuthGuard";
import type { Metadata } from "next";

// Note: Global CSS and other providers like ThemeProvider and SessionProviderWrapper
// should now be in the root app/layout.tsx

export const metadata: Metadata = {
  // You can keep or adjust metadata specific to the (preview) section if needed
  // If not, this metadata object can be simplified or removed if it duplicates the root.
  metadataBase: new URL("https://ai-sdk-preview-rag.vercel.app"),
  title: "Retrieval-Augmented Generation Preview - Azure AI Search, Azure OpenAI, and Vercel AI SDK",
  description:
    "Augment language model generations with vector based retrieval using Azure AI Search, text generation from Azure OpenAI, and orchestration with Vercel AI SDK",
};

export default function PreviewLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <AuthGuard>
      {/* This layout now only needs to apply AuthGuard and any specific styling/structure 
          for the / (preview) route group. Theme and Session are handled by the root layout. */}
      {children}
    </AuthGuard>
  );
}
