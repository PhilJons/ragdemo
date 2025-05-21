'use client';

import { useSession, signIn, signOut } from 'next-auth/react';
import React from 'react';
import { LogIn, LogOut, UserCircle, Loader2 } from 'lucide-react'; // Import icons
import Image from 'next/image';

export default function LoginButton() {
  const { data: session, status } = useSession();

  const commonButtonClasses = "flex items-center justify-center w-full px-4 py-2.5 text-sm font-medium tracking-wide transition-colors duration-200 transform rounded-md focus:outline-none focus:ring-2 focus:ring-opacity-50";
  const signInButtonClasses = `${commonButtonClasses} bg-slate-700 text-white hover:bg-slate-600 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200 focus:ring-slate-500 dark:focus:ring-white`;
  const signOutButtonClasses = `${commonButtonClasses} bg-slate-200 text-slate-700 hover:bg-slate-300 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200 focus:ring-slate-400 dark:focus:ring-gray-300`;


  if (status === 'loading') {
    return (
      <button className={`${commonButtonClasses} bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200 cursor-not-allowed`} disabled>
        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
        Loading...
      </button>
    );
  }

  if (session) {
    return (
      <div className="flex items-center space-x-3">
        {session.user?.image ? (
          <Image
            src={session.user.image} 
            alt={session.user.name || 'User avatar'} 
            width={32}
            height={32}
            className="w-8 h-8 rounded-full border-2 border-slate-300 dark:border-gray-200"
          />
        ) : (
          <UserCircle className="w-7 h-7 text-slate-500 dark:text-gray-200" />
        )}
        <div className="text-sm">
          <p className="font-medium text-slate-700 dark:text-gray-200 truncate max-w-[150px] md:max-w-[200px]">
            {session.user?.name || session.user?.email}
          </p>
        </div>
        <button 
          onClick={() => signOut()} 
          className={`${signOutButtonClasses} px-3 py-2 text-xs`}
          title="Sign out"
        >
          <LogOut className="w-4 h-4 md:mr-2" />
          <span className="hidden md:inline">Sign Out</span>
        </button>
      </div>
    );
  }

  // This is the button shown on the Login Page
  return (
    <button 
      onClick={() => signIn('azure-ad')} 
      className={signInButtonClasses} // Updated class for modern look
    >
      <LogIn className="w-5 h-5 mr-2" />
      Sign in with Azure AD
    </button>
  );
} 