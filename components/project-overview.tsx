"use client";

import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { AzureIcon , VercelIcon} from "./icons";
import { useTheme } from 'next-themes';

const ProjectOverview = () => {
  const { theme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const logoSrc = theme === 'dark' ? '/Aura_logo_white.svg' : '/Aura_logo.svg';

  return (
    <motion.div
      className="w-full max-w-[600px] my-4"
      initial={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 5 }}
    >
      <div className="border-2 rounded-lg p-6 flex flex-col items-center gap-4 text-sm text-muted-foreground dark:border-neutral-700 dark:bg-neutral-900">
        {mounted && (
          <img 
            src={logoSrc} 
            alt="Aura Logo" 
            className="h-10 mb-4"
          />
        )}
        <p className="text-center">
          Welcome to the secure Retrieval-Augmented Generation (RAG) demo, hosted on Azure.
        </p>
        <p className="text-center">
          You can manage the data sources used for context through the Settings panel (⚙️) located in the top left corner.
        </p>
      </div>
    </motion.div>
  );
};

export default ProjectOverview;
