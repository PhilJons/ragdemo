"use client";

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  // DialogFooter, // Footer might not be needed if close is handled by X icon
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { Trash2, UploadCloud, FileText, X, Info, ChevronDown, CheckCircle, AlertCircle, Loader2, Trash, Settings as SettingsIcon } from 'lucide-react'; // Added SettingsIcon for clarity if needed
import { motion, AnimatePresence } from 'framer-motion';
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
// Assuming the action is moved to app/actions or similar
import { structureUserInputsIntoSystemPromptAction } from '@/app/actions/structureUserInputsIntoSystemPrompt'; 

// --- Types ---
interface SourceDocument {
  id: string;
  name: string;
}

interface UploadProgress {
  fileName: string;
  status: 'pending' | 'uploading' | 'success' | 'error';
  progress: number;
  error?: string;
}

interface SystemPrompt {
  name: string;
  content: string;
}

interface SettingsDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  // System Prompt Props
  systemPrompts: SystemPrompt[];
  selectedPromptName: string;
  onSelectPrompt: (name: string) => void;
  onAddNewPrompt: (name: string, content: string) => void;
  onUpdatePrompt: (originalName: string, newName: string, newContent: string) => void;
  onDeletePrompt: (name: string) => void;
  defaultPromptNames: string[];
  isLoadingChat: boolean; // Renamed from isLoading to avoid conflict

  // New props for Temperature and Max Tokens
  temperature: number;
  onTemperatureChange: (value: number) => void;
  maxTokens: number;
  onMaxTokensChange: (value: number) => void;
}

// --- Constants ---
const BOILERPLATE_SYSTEM_PROMPT_TEMPLATE = `--- Who will receive this (audience) ---
(e.g., "Portfolio managers", "Investment committee", "Equity research team")

--- Background information ---
(e.g., "Analyzing quarterly earnings reports from several tech companies.", "Tracking analyst sentiment changes for a specific stock based on multiple research notes.")

--- Task definition, what you expect it to do, the vision ---
(e.g., "Summarize shifts in analyst ratings and price targets across the provided reports.", "Extract key themes and forward-looking statements from earnings call transcripts.", "Compare research house views on a company, highlighting changes over time and consensus points.")

--- Examples of good outputs (optional) ---
(e.g., "Imagine a previous analysis you liked – you can paste a snippet of its output here.", "Provide a full example text of a desired summary here.")

--- Desired output structure (optional) ---
(e.g., "A report with: 1. Executive TLDR (3-5 bullets). 2. Detailed breakdown by research house, showing report date, rating, price target, and key commentary. 3. Appendix listing sources.", "Output similar to the default financial analyst prompt\'s structure.", "Main sections: 'Overall Sentiment Shift', 'Key Themes by Research House', 'Price Target Evolution'.", "Output a list of key forecast changes with analyst justifications.")
`;

const contentVariants = {
  collapsed: { height: 0, opacity: 0, marginTop: 0 },
  expanded: { 
    height: "auto", 
    opacity: 1, 
    marginTop: "0.75rem",
    transition: { duration: 0.3, ease: [0.04, 0.62, 0.23, 0.98] }
  }
};

const listVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.05
    }
  }
};

const itemVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0 }
};

const SettingsDialog: React.FC<SettingsDialogProps> = ({ 
  isOpen, 
  onOpenChange,
  systemPrompts,
  selectedPromptName,
  onSelectPrompt,
  onAddNewPrompt,
  onUpdatePrompt,
  onDeletePrompt,
  defaultPromptNames,
  isLoadingChat,
  temperature,
  onTemperatureChange,
  maxTokens,
  onMaxTokensChange
}) => {
  // State for file management
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploads, setUploads] = useState<UploadProgress[]>([]);
  const [isUploadingGlobal, setIsUploadingGlobal] = useState(false);
  const [sources, setSources] = useState<SourceDocument[]>([]);
  const [isLoadingSources, setIsLoadingSources] = useState(false);
  const [sourcesError, setSourcesError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isInfoExpanded, setIsInfoExpanded] = useState(false);
  const [isDeletingAll, setIsDeletingAll] = useState(false);
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [isDeletingSelected, setIsDeletingSelected] = useState(false);

  // State for system prompt form
  const [newPromptName, setNewPromptName] = useState('');
  const [newPromptContent, setNewPromptContent] = useState('');
  const [editingPromptOriginalName, setEditingPromptOriginalName] = useState<string | null>(null);
  const [isGeneratingAiPrompt, setIsGeneratingAiPrompt] = useState(false);
  const [aiGenerationError, setAiGenerationError] = useState<string | null>(null);

  // --- File Management Logic ---
  const fetchSources = useCallback(async () => {
    setIsLoadingSources(true);
    setSourcesError(null);
    try {
      const response = await fetch('/api/settings/sources');
      const result = await response.json();
      if (response.ok && result.success) {
        setSources(result.sources || []);
      } else {
        throw new Error(result.error || 'Failed to fetch sources');
      }
    } catch (error: any) {
      console.error("Error fetching sources:", error);
      setSourcesError(error.message);
      setSources([]);
    } finally {
      setIsLoadingSources(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchSources();
      setSelectedFiles([]);
      setUploads([]);
      setIsUploadingGlobal(false);
      setIsDeletingAll(false);
      setSelectedSourceIds([]);
      setIsDeletingSelected(false);
      // Reset prompt form as well
      setEditingPromptOriginalName(null);
      setNewPromptName('');
      setNewPromptContent('');
      setAiGenerationError(null);
      setIsGeneratingAiPrompt(false);
    }
  }, [isOpen, fetchSources]);

  const handleFilesSelect = (files: FileList | null) => {
    if (files && files.length > 0) {
      const newFilesArray = Array.from(files);
      const uniqueNewFiles = newFilesArray.filter(nf => !selectedFiles.some(sf => sf.name === nf.name));
      setSelectedFiles(prev => [...prev, ...uniqueNewFiles]);
      setUploads(prevUploads => [
        ...prevUploads,
        ...uniqueNewFiles.map(file => ({
          fileName: file.name,
          status: 'pending' as const,
          progress: 0,
        }))
      ]);
    }
  };

  const handleFileInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    handleFilesSelect(event.target.files);
    if (event.target) event.target.value = '';
  };

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true); };
  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault(); e.stopPropagation();
    setTimeout(() => { if (e.currentTarget && (!e.relatedTarget || !(e.currentTarget.contains(e.relatedTarget as Node)))) setIsDragging(false); }, 50);
  };
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true); };
  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault(); e.stopPropagation(); setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFilesSelect(e.dataTransfer.files);
      e.dataTransfer.clearData();
    }
  };

  const removeFile = (fileName: string) => {
    setSelectedFiles(prev => prev.filter(f => f.name !== fileName));
    setUploads(prev => prev.filter(u => u.fileName !== fileName));
  };

  const handleUploadAll = async () => {
    if (selectedFiles.length === 0 || isUploadingGlobal) return;
    setIsUploadingGlobal(true);
    let uploadOccurred = false;
    for (const file of selectedFiles) {
      const uploadIndex = uploads.findIndex(u => u.fileName === file.name && u.status === 'pending');
      if (uploadIndex === -1) continue;
      uploadOccurred = true;
      setUploads(prev => prev.map((u, idx) => idx === uploadIndex ? { ...u, status: 'uploading', progress: 0 } : u));
      // ... (rest of upload logic, interval, fetch, error handling) ...
      let interval: NodeJS.Timeout | null = null;
      try {
        interval = setInterval(() => {
          setUploads(prev => prev.map((up, i) => 
            i === uploadIndex && up.status === 'uploading' ? { ...up, progress: Math.min(up.progress + Math.random() * 15, 95) } : up
          ));
        }, 300);
        const formData = new FormData();
        formData.append('file', file);
        const response = await fetch('/api/settings/sources', { method: 'POST', body: formData });
        const result = await response.json();
        if (interval) clearInterval(interval);
        if (response.ok && result.success) {
          setUploads(prev => prev.map((up, i) => i === uploadIndex ? { ...up, status: 'success', progress: 100 } : up));
        } else {
          throw new Error(result.error || 'Upload failed');
        }
      } catch (error: any) {
        if (interval) clearInterval(interval);
        setUploads(prev => prev.map((up, i) => i === uploadIndex ? { ...up, status: 'error', progress: 0, error: error.message || 'Network error' } : up));
      }
    }
    setIsUploadingGlobal(false);
    if (uploadOccurred) {
      setUploads([]);
      setSelectedFiles([]);
      setTimeout(fetchSources, 2000);
    }
  };

  const handleSourceSelectionChange = (sourceId: string, checked: boolean | string) => {
    const isSelected = checked === true;
    setSelectedSourceIds(prev => isSelected ? [...prev, sourceId] : prev.filter(id => id !== sourceId));
  };

  const deleteSourceById = async (sourceId: string): Promise<boolean> => {
    try {
      const response = await fetch(`/api/settings/sources?id=${encodeURIComponent(sourceId)}`, { method: 'DELETE' });
      if (response.ok && response.status === 204) return true;
      if (response.ok) { const result = await response.json(); return result.success; }
      const errorResult = await response.json();
      throw new Error(errorResult.error || `HTTP error ${response.status}`);
    } catch (error: any) {
      console.error(`Error deleting source ${sourceId}:`, error);
      alert(`Error deleting source: ${error.message}`);
      return false;
    }
  };

  const handleDeleteSingleSource = async (sourceId: string) => {
    if (isDeletingAll || isDeletingSelected) return;
    const success = await deleteSourceById(sourceId);
    if (success) fetchSources();
  };

  const handleClearAllSources = async () => {
    if (sources.length === 0 || isDeletingAll || isUploadingGlobal || isDeletingSelected) return;
    if (window.confirm(`Are you sure you want to delete all ${sources.length} context sources?`)) {
      setIsDeletingAll(true);
      let failedDeletions = 0;
      for (const source of sources) { if (!(await deleteSourceById(source.id))) failedDeletions++; }
      setIsDeletingAll(false);
      setTimeout(fetchSources, 1000);
      if (failedDeletions > 0) alert(`Failed to delete ${failedDeletions} source(s).`);
    }
  };

  const handleDeleteSelectedSources = async () => {
    if (selectedSourceIds.length === 0 || isDeletingSelected || isDeletingAll || isUploadingGlobal) return;
    if (window.confirm(`Are you sure you want to delete ${selectedSourceIds.length} selected source(s)?`)) {
      setIsDeletingSelected(true);
      let failedDeletions = 0;
      for (const sourceId of selectedSourceIds) { if (!(await deleteSourceById(sourceId))) failedDeletions++; }
      setSelectedSourceIds([]);
      setIsDeletingSelected(false);
      setTimeout(fetchSources, 1000);
      if (failedDeletions > 0) alert(`Failed to delete ${failedDeletions} source(s).`);
    }
  };

  // --- System Prompt Logic ---
  useEffect(() => {
    if (editingPromptOriginalName) {
      const promptToEdit = systemPrompts.find(p => p.name === editingPromptOriginalName);
      if (promptToEdit) {
        setNewPromptName(promptToEdit.name);
        setNewPromptContent(promptToEdit.content);
      } else {
        setEditingPromptOriginalName(null); // Should not happen if UI is correct
      }
    }
  }, [editingPromptOriginalName, systemPrompts]);

  const handleAddOrUpdatePrompt = () => {
    if (newPromptName.trim() && newPromptContent.trim()) {
      if (editingPromptOriginalName) {
        onUpdatePrompt(editingPromptOriginalName, newPromptName.trim(), newPromptContent.trim());
        setEditingPromptOriginalName(null);
      } else {
        onAddNewPrompt(newPromptName.trim(), newPromptContent.trim());
      }
      setNewPromptName('');
      setNewPromptContent('');
      setAiGenerationError(null);
    } else {
      alert('Please provide both a name and content for the prompt.');
    }
  };

  const handleSelectPromptForEditing = (prompt: SystemPrompt) => {
    setEditingPromptOriginalName(prompt.name);
    setAiGenerationError(null);
  };

  const handleCancelEdit = () => {
    setEditingPromptOriginalName(null);
    setNewPromptName('');
    setNewPromptContent('');
    setAiGenerationError(null);
  };

  const handleGenerateWithAi = async () => {
    if (!newPromptContent.trim() && !editingPromptOriginalName) { // Only insert boilerplate if content is empty AND not editing
      setNewPromptContent(BOILERPLATE_SYSTEM_PROMPT_TEMPLATE);
      setAiGenerationError(null);
      return;
    }
    setIsGeneratingAiPrompt(true);
    setAiGenerationError(null);
    try {
      // Ensure the action is correctly imported and available.
      // This path assumes the action is in 'app/actions/structureUserInputsIntoSystemPrompt.ts'
      // and exported as structureUserInputsIntoSystemPromptAction
      const result = await structureUserInputsIntoSystemPromptAction(newPromptContent);
      if (result.success && result.structuredPrompt) {
        setNewPromptContent(result.structuredPrompt);
      } else {
        setAiGenerationError(result.error || "Failed to structure prompt with AI. Unknown error.");
      }
    } catch (error: any) {
      setAiGenerationError(`An unexpected error occurred: ${error.message}`);
    } finally {
      setIsGeneratingAiPrompt(false);
    }
  };
  
  const closeDialog = () => {
    if (!isUploadingGlobal && !isDeletingAll && !isDeletingSelected && !isGeneratingAiPrompt) {
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={closeDialog}>
      <DialogContent 
        className="max-w-[1800px] w-full max-h-[90vh] flex flex-col"
        onInteractOutside={(e) => { 
          if (isUploadingGlobal || isDeletingAll || isDeletingSelected || isGeneratingAiPrompt) e.preventDefault(); 
        }}
      >
        <DialogHeader className="p-8 pb-6 flex-shrink-0 border-b">
          <DialogTitle className="text-2xl">Settings</DialogTitle>
          <DialogDescription>Manage context data sources and system prompts for the AI.</DialogDescription>
        </DialogHeader>

        <div className="flex-grow overflow-y-auto md:grid md:grid-cols-3 md:gap-x-12 p-8 space-y-16 md:space-y-0">
          {/* --- Column 1: Context Sources --- */}
          <div className="flex flex-col space-y-10">
            <div>
              <h3 className="text-xl font-semibold mb-1 text-gray-800 dark:text-white">Manage Context Sources</h3>
              <p className="text-sm text-muted-foreground mb-3">Upload new files or remove existing sources.</p>
               {/* Expandable Info Section */}
                <div className="mb-4">
                  <button
                    onClick={() => setIsInfoExpanded(!isInfoExpanded)}
                    className="flex w-full items-center justify-between rounded-lg border bg-muted/40 dark:bg-gray-700/30 px-4 py-3 text-left text-sm font-medium transition-colors hover:bg-muted/60 dark:hover:bg-gray-700/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    aria-expanded={isInfoExpanded}
                  >
                    <div className="flex items-center gap-2">
                      <Info className="h-4 w-4 text-muted-foreground" />
                      <span>Recommended File-Naming Schema</span>
                    </div>
                    <ChevronDown
                      className={cn(
                        "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
                        isInfoExpanded && "rotate-180"
                      )}
                    />
                  </button>
                  <AnimatePresence initial={false}>
                    {isInfoExpanded && (
                      <motion.div
                        key="content-info"
                        initial="collapsed"
                        animate="expanded"
                        exit="collapsed"
                        variants={contentVariants}
                        className="overflow-hidden text-left text-sm"
                      >
                        <div className="rounded-b-lg border border-t-0 bg-muted/40 dark:bg-gray-700/30 p-4 pt-3">
                          <pre className="whitespace-pre-wrap text-xs leading-5 font-mono bg-background/60 dark:bg-gray-800/50 rounded-md p-2 mb-3 border dark:border-gray-600">
    {`<origin>-<topic>-<yyyy-mm[-dd]>[-<doc-type>][-v<version>].<ext>`}
                          </pre>
                          <ul className="list-disc pl-5 text-xs space-y-1 mb-3 text-gray-600 dark:text-gray-400">
                            <li><b>origin</b>: internal | external | client | competitor-name</li>
                            <li><b>topic</b>: strategy | market-analysis | campaign-review | project-update …</li>
                            <li><b>date</b>: YYYY-MM or YYYY-MM-DD</li>
                            <li><b>version</b> (optional): v1, v2-final …</li>
                          </ul>
                          <p className="font-semibold text-xs mb-1 text-gray-700 dark:text-gray-300">Examples</p>
                          <code className="block text-xs mb-0.5 text-gray-600 dark:text-gray-400">internal-strategy-2024-03-report-v2.md</code>
                          <code className="block text-xs mb-0.5 text-gray-600 dark:text-gray-400">competitor-tesla-strategy-2023-q4.pdf</code>
                          <code className="block text-xs mb-0.5 text-gray-600 dark:text-gray-400">market-trends-2024-05-summary.docx</code>
                          <code className="block text-xs text-gray-600 dark:text-gray-400">client-acme-project-update-2024-01-15.pptx</code>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
            </div>
            <div 
              className={cn(
                "flex flex-col items-center justify-center w-full border-2 border-dashed rounded-lg cursor-pointer bg-muted/40 dark:bg-gray-700/30 hover:bg-muted/60 dark:hover:bg-gray-700/50 transition-colors p-6 min-h-[150px]",
                isDragging && "border-primary bg-primary/10 dark:border-blue-500 dark:bg-blue-900/20"
              )}
              onDragEnter={handleDragEnter} onDragLeave={handleDragLeave} onDragOver={handleDragOver} onDrop={handleDrop}
              onClick={() => !(isUploadingGlobal || isDeletingAll || isDeletingSelected) && fileInputRef.current?.click()}
            >
              <UploadCloud className={cn("w-8 h-8 mb-2 text-primary", isDragging && "text-primary dark:text-blue-400")} />
              <p className="mb-1 text-sm text-foreground dark:text-gray-300">
                <span className={cn("font-semibold", (isUploadingGlobal || isDeletingAll || isDeletingSelected) && "text-muted-foreground dark:text-gray-500")}>Drop your files here</span> 
                <span className={cn((isUploadingGlobal || isDeletingAll || isDeletingSelected) && "text-muted-foreground dark:text-gray-500")}> or browse</span>
              </p>
              <p className={cn("text-xs text-muted-foreground dark:text-gray-400", (isUploadingGlobal || isDeletingAll || isDeletingSelected) && "dark:text-gray-500")}>Select one or more files</p>
              <Input ref={fileInputRef} id="context-file-hidden" type="file" onChange={handleFileInputChange} className="hidden" multiple disabled={isUploadingGlobal || isDeletingAll || isDeletingSelected} />
            </div>

            {uploads.length > 0 && (
              <div className="space-y-2 max-h-40 overflow-y-auto pr-2 border-t pt-4 mt-4">
                {uploads.map((upload) => {
                  const file = selectedFiles.find(f => f.name === upload.fileName);
                  const fileSizeMB = file ? (file.size / (1024 * 1024)).toFixed(2) : 'N/A';
                  return (
                    <div key={upload.fileName} className="p-3 border dark:border-gray-700 rounded-lg flex items-center justify-between space-x-3 bg-background dark:bg-gray-800/50">
                      <div className="flex items-center space-x-3 flex-grow min-w-0 overflow-hidden">
                        <FileText className="w-5 h-5 text-primary flex-shrink-0" />
                        <div className="min-w-0 flex-grow">
                          <p className="text-sm font-medium truncate text-gray-800 dark:text-gray-200" title={upload.fileName}>{upload.fileName}</p>
                          {upload.status === 'uploading' && <Progress value={upload.progress} className="h-1 mt-1" />}
                          {upload.status === 'pending' && file && <p className="text-xs text-muted-foreground dark:text-gray-400">{fileSizeMB} MB - Pending</p>}
                          {upload.status === 'success' && <div className="flex items-center text-xs text-green-600 dark:text-green-400 mt-1"><CheckCircle className="w-3 h-3 mr-1" /> Uploaded</div>}
                          {upload.status === 'error' && <div className="flex items-center text-xs text-red-600 dark:text-red-400 mt-1" title={upload.error}><AlertCircle className="w-3 h-3 mr-1" /> Error {upload.error && <span className="truncate">: {upload.error}</span>}</div>}
                        </div>
                      </div>
                      {upload.status === 'pending' && !isUploadingGlobal && (
                         <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive dark:text-gray-400 dark:hover:text-red-400 flex-shrink-0" onClick={() => removeFile(upload.fileName)} aria-label={`Remove ${upload.fileName}`}><X className="h-4 w-4" /></Button>
                      )}
                      {upload.status === 'uploading' && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground flex-shrink-0" />}
                      {upload.status === 'success' && <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400 flex-shrink-0" />}
                      {upload.status === 'error' && <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400 flex-shrink-0" />}
                    </div>
                  );
                })}
              </div>
            )}

            {selectedFiles.length > 0 && uploads.some(u => u.status === 'pending') && (
              <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.98 }} className="mt-4 flex-shrink-0">
                <Button onClick={handleUploadAll} disabled={isUploadingGlobal} className="w-full">
                  {isUploadingGlobal ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UploadCloud className="mr-2 h-4 w-4" />}
                  {isUploadingGlobal ? 'Uploading...' : `Upload ${uploads.filter(u => u.status === 'pending').length} File(s)`}
                </Button>
              </motion.div>
            )}
            
            {(uploads.length > 0 || sources.length > 0 || selectedSourceIds.length > 0) && <Separator className="my-6" />}

            {isLoadingSources && <p className="text-sm text-muted-foreground text-center py-4">Loading sources...</p>}
            {sourcesError && <p className="text-sm text-red-600 text-center py-4">Error: {sourcesError}</p>}
            
            {!isLoadingSources && !sourcesError && sources.length > 0 && (
              <div className="space-y-4">
                <div className="flex justify-between items-center gap-2 flex-wrap">
                  <h4 className="text-md font-medium text-gray-700 dark:text-gray-300">Uploaded Sources ({sources.length})</h4>
                  <div className="flex items-center gap-2">
                    {selectedSourceIds.length > 0 && (
                      <Button variant="outline" size="sm" onClick={handleDeleteSelectedSources} disabled={isDeletingSelected || isDeletingAll || isUploadingGlobal} className="flex items-center gap-1.5"><Trash2 className="h-3.5 w-3.5" /> {isDeletingSelected ? "Deleting..." : `Delete Selected (${selectedSourceIds.length})`}</Button>
                    )}
                    <Button variant="destructive" size="sm" onClick={handleClearAllSources} disabled={isDeletingAll || isUploadingGlobal || isDeletingSelected || sources.length === 0} className="flex items-center gap-1.5"><Trash className="h-3.5 w-3.5" /> {isDeletingAll ? "Clearing..." : "Clear All"}</Button>
                  </div>
                </div>
                <ScrollArea className="h-[300px] w-full border dark:border-gray-700 rounded-md p-1">
                  <motion.ul className="space-y-1.5 p-2.5" variants={listVariants} initial="hidden" animate="visible">
                    {sources.map((source) => (
                      <motion.li key={source.id} className="flex justify-between items-center text-sm p-3 border dark:border-gray-700/50 rounded-md bg-background dark:bg-gray-800/30 hover:bg-gray-50 dark:hover:bg-gray-700/50" variants={itemVariants}>
                        <div className="flex items-center gap-3 flex-grow min-w-0">
                          <Checkbox id={`select-source-${source.id}`} checked={selectedSourceIds.includes(source.id)} onCheckedChange={(checked) => handleSourceSelectionChange(source.id, checked)} aria-label={`Select ${source.name}`} disabled={isDeletingAll || isDeletingSelected || isUploadingGlobal} />
                          <FileText className="w-4 h-4 text-primary flex-shrink-0" />
                          <label htmlFor={`select-source-${source.id}`} className="flex-grow text-foreground dark:text-gray-300 truncate cursor-pointer" title={source.name}>{source.name}</label> 
                        </div>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive dark:hover:text-red-400 flex-shrink-0" onClick={() => handleDeleteSingleSource(source.id)} aria-label={`Delete ${source.name}`} disabled={isUploadingGlobal || isDeletingAll || isDeletingSelected}><Trash2 className="h-4 w-4" /></Button>
                      </motion.li>
                    ))}
                  </motion.ul>
                </ScrollArea>
              </div>
            )}
             {!isLoadingSources && !sourcesError && sources.length === 0 && selectedFiles.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">No context sources uploaded yet.</p>
            )}
          </div>

          {/* --- Column 2: System Prompt Selection & Management --- */}
          <div className="flex flex-col space-y-10 pt-8 md:pt-0 md:border-l md:pl-12 md:dark:border-gray-700">
            <h3 className="text-xl font-semibold text-gray-800 dark:text-gray-200">System Prompt Options</h3>
            
            {/* Prompt Selection Dropdown */}
            <div className="space-y-2">
              <Label htmlFor="prompt-select" className="text-gray-700 dark:text-gray-300">Select Active System Prompt</Label>
              <select 
                id="prompt-select"
                value={selectedPromptName}
                onChange={(e) => onSelectPrompt(e.target.value)}
                className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white dark:focus:ring-blue-400 transition-colors duration-150"
                disabled={isLoadingChat || isGeneratingAiPrompt}
              >
                {systemPrompts.map(p => (
                  <option key={p.name} value={p.name}>{p.name}</option>
                ))}
              </select>
            </div>

            <Separator className="my-6 dark:bg-gray-700" />

            {/* Temperature Slider */}
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <Label htmlFor="temperature-slider" className="text-gray-700 dark:text-gray-300">Temperature</Label>
                <span className="text-sm text-gray-500 dark:text-gray-400 w-12 text-center">{temperature.toFixed(1)}</span>
              </div>
              <input 
                type="range" 
                id="temperature-slider" 
                min="0" 
                max="2" 
                step="0.1" 
                value={temperature} 
                onChange={(e) => onTemperatureChange(parseFloat(e.target.value))} 
                className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-600 dark:accent-blue-500"
                disabled={isLoadingChat || isGeneratingAiPrompt}
              />
            </div>

            {/* Max Tokens Input */}
            <div className="space-y-2">
              <Label htmlFor="max-tokens-input" className="text-gray-700 dark:text-gray-300">Max Tokens</Label>
              <Input 
                type="number" 
                id="max-tokens-input" 
                value={maxTokens} 
                onChange={(e) => onMaxTokensChange(parseInt(e.target.value, 10))} 
                min="100"
                max="16384" // Common upper limit, adjust as needed
                step="100"
                className="w-full dark:bg-gray-700 dark:text-white dark:border-gray-600"
                disabled={isLoadingChat || isGeneratingAiPrompt}
              />
            </div>

            <Separator className="my-6 dark:bg-gray-700" />

            {/* Add/Edit Prompt Form */}
            <div>
              <h4 className="text-md font-medium text-gray-700 dark:text-gray-300 mb-2.5 pt-6 border-t dark:border-gray-700">Manage Custom Prompts:</h4>
              {systemPrompts.filter(p => !defaultPromptNames.includes(p.name)).length > 0 ? (
                <ScrollArea className="h-[350px] w-full border dark:border-gray-700 rounded-md p-1">
                  <ul className="space-y-1.5 p-2.5">
                    {systemPrompts
                      .filter(prompt => !defaultPromptNames.includes(prompt.name))
                      .map(prompt => (
                        <li key={prompt.name} className="flex justify-between items-center p-3 border dark:border-gray-700/50 rounded-md bg-background dark:bg-gray-800/30 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                          <button
                            onClick={() => handleSelectPromptForEditing(prompt)}
                            className="text-sm text-left text-gray-700 dark:text-gray-300 hover:underline focus:outline-none flex-grow mr-3 disabled:opacity-50"
                            disabled={isLoadingChat || !!editingPromptOriginalName || isGeneratingAiPrompt}
                            title={`Edit prompt: ${prompt.name}`}
                          >
                            {prompt.name}
                          </button>
                          <Button
                            variant="ghost" size="icon"
                            onClick={() => onDeletePrompt(prompt.name)}
                            disabled={isLoadingChat || !!editingPromptOriginalName || isGeneratingAiPrompt}
                            className="h-7 w-7 text-muted-foreground hover:text-destructive dark:hover:text-red-400 flex-shrink-0"
                            aria-label={`Delete prompt ${prompt.name}`}
                          >
                             <Trash2 className="h-4 w-4" />
                          </Button>
                        </li>
                      ))}
                  </ul>
                </ScrollArea>
              ) : (
                <p className="text-sm text-muted-foreground dark:text-gray-400">No custom prompts added yet.</p>
              )}
            </div>
          </div>

          {/* --- Column 3: Add/Edit Prompt Form --- */}
          <div className="flex flex-col space-y-8 pt-8 md:pt-0 md:border-l md:pl-12 md:dark:border-gray-700">
             <h4 className="text-lg font-medium text-gray-800 dark:text-white pt-2">{editingPromptOriginalName ? 'Edit Prompt' : 'Add New Custom Prompt'}:</h4>
              <div>
                <Label htmlFor="new-prompt-name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Prompt Name:
                </Label>
                <Input
                  type="text"
                  id="new-prompt-name"
                  value={newPromptName}
                  onChange={(e) => setNewPromptName(e.target.value)}
                  disabled={isLoadingChat || isGeneratingAiPrompt}
                  placeholder="e.g., Creative Story Writer"
                  className="block w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white disabled:opacity-50"
                />
              </div>
              <div className="flex flex-col flex-grow">
                <Label htmlFor="new-prompt-content" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Prompt Content:
                </Label>
                <textarea
                  id="new-prompt-content"
                  value={newPromptContent}
                  onChange={(e) => setNewPromptContent(e.target.value)}
                  disabled={isLoadingChat || isGeneratingAiPrompt}
                  rows={20}
                  placeholder="Enter the full system prompt here... or paste your thoughts and click 'Structure My Prompt'"
                  className="block w-full p-3 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white disabled:opacity-50 font-mono text-xs flex-grow min-h-[350px]"
                />
                {aiGenerationError && (
                  <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">Error: {aiGenerationError}</p>
                )}
              </div>
              <div className="flex flex-wrap gap-3 flex-shrink-0 pt-3">
                <Button
                  type="button"
                  onClick={handleAddOrUpdatePrompt}
                  disabled={isLoadingChat || isGeneratingAiPrompt || !newPromptName.trim() || !newPromptContent.trim()}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {editingPromptOriginalName ? 'Save Changes' : 'Add Custom Prompt'}
                </Button>
                {editingPromptOriginalName && (
                  <Button
                    type="button"
                    onClick={handleCancelEdit}
                    disabled={isLoadingChat || isGeneratingAiPrompt}
                    className="px-4 py-2 bg-gray-500 dark:bg-gray-600 text-white rounded-md hover:bg-gray-600 dark:hover:bg-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 disabled:opacity-50"
                  >
                    Cancel Edit
                  </Button>
                )}
                <Button
                  type="button"
                  onClick={handleGenerateWithAi}
                  disabled={isLoadingChat || isGeneratingAiPrompt}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                >
                  {isGeneratingAiPrompt ? (
                    <>
                      <motion.div
                        animate={{ rotate: 360 }}
                        transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
                        className="w-4 h-4 border-2 border-white border-t-transparent rounded-full mr-2"
                      ></motion.div>
                      Generating...
                    </>
                  ) : (
                    (!newPromptContent.trim() && !editingPromptOriginalName) ? 'Insert Boilerplate' : 'Structure My Prompt'
                  )}
                </Button>
              </div>
          </div>
        </div>
        {/* Optional: DialogFooter if a global close is needed, though X button is standard
        <DialogFooter className="p-6 pt-4 border-t flex-shrink-0">
          <Button variant="outline" onClick={closeDialog}>Close</Button>
        </DialogFooter>
        */}
      </DialogContent>
    </Dialog>
  );
};

export default SettingsDialog; 