"use client";

import LoginButton from "@/components/auth/LoginButton";
import Image from "next/image";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Lock, Zap, MessageSquareText } from 'lucide-react'; // Importing icons

export default function LoginPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "authenticated") {
      router.push("/"); // Redirect to chat interface if already logged in
    }
  }, [status, router]);

  // Show a minimal loading state or null while checking session or redirecting
  if (status === "loading" || status === "authenticated") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-white dark:bg-slate-950">
        {/* Minimal loader, or nothing to avoid flash of content */}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 dark:bg-slate-900 p-6 font-sans">
      <div className="w-full max-w-md p-8 md:p-10 space-y-6 bg-white dark:bg-slate-800/90 backdrop-blur-sm rounded-xl shadow-xl dark:shadow-slate-700/50">
        <div className="flex justify-center mb-8">
          <Image
            src="/Aura_logo_white.svg" // Using the white logo
            alt="Aura Logo"
            width={160} // Slightly adjusted size
            height={40} // Maintain aspect ratio
            priority
            className="dark:invert-0 invert" // Invert on light mode to show black, keep white on dark mode
          />
        </div>
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-semibold text-slate-800 dark:text-slate-50 tracking-tight">
            Unlock Your Data&apos;s Potential
          </h1>
          <p className="text-slate-600 dark:text-slate-400 text-base">
            Experience the power of Retrieval-Augmented Generation, securely hosted on Azure.
          </p>
        </div>
        
        <div className="space-y-4 py-6 border-t border-b border-slate-200 dark:border-slate-700/60">
          <div className="flex items-start space-x-3">
            <Zap className="w-5 h-5 text-purple-500 dark:text-purple-400 mt-1 flex-shrink-0" />
            <div>
              <h3 className="font-medium text-slate-700 dark:text-slate-200">Intelligent Insights</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400">Leverage advanced AI to understand and interact with your documents like never before.</p>
            </div>
          </div>
          <div className="flex items-start space-x-3">
            <Lock className="w-5 h-5 text-purple-500 dark:text-purple-400 mt-1 flex-shrink-0" />
            <div>
              <h3 className="font-medium text-slate-700 dark:text-slate-200">Secure & Private</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400">Built with enterprise-grade security, ensuring your data remains protected within Azure.</p>
            </div>
          </div>
           <div className="flex items-start space-x-3">
            <MessageSquareText className="w-5 h-5 text-purple-500 dark:text-purple-400 mt-1 flex-shrink-0" />
            <div>
              <h3 className="font-medium text-slate-700 dark:text-slate-200">Customizable Prompts</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400">Tailor the AI&apos;s responses and behavior with project-specific system prompts and settings.</p>
            </div>
          </div>
        </div>
        
        <div className="pt-2">
          <p className="text-center text-sm text-slate-600 dark:text-slate-300 mb-4">
            Sign in with your Azure account to continue.
           </p>
          <LoginButton />
        </div>

        <p className="text-xs text-slate-500 dark:text-slate-400/80 text-center pt-6">
          &copy; {new Date().getFullYear()} Aura. All rights reserved.
        </p>
      </div>
    </div>
  );
} 