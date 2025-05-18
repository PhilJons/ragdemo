"use client";

import { useSession } from "next-auth/react";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";

interface AuthGuardProps {
  children: ReactNode;
}

export default function AuthGuard({ children }: AuthGuardProps) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === "loading") {
      return; // Do nothing while loading
    }

    if (status === "unauthenticated" && pathname !== "/login") {
      router.push("/login");
    }

    if (status === "authenticated" && pathname === "/login") {
      router.push("/");
    }
  }, [status, pathname, router]);

  if (status === "loading" || (status === "unauthenticated" && pathname !== "/login") || (status === "authenticated" && pathname === "/login")) {
    // Show a full-page loading indicator while checking session or redirecting
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 text-white p-6">
        <p>Loading application...</p>
        {/* Optional: Add a spinner or a more sophisticated loading animation here */}
      </div>
    );
  }

  // If authenticated and not on the login page, or unauthenticated and on the login page
  return <>{children}</>;
} 