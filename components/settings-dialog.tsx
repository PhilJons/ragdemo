"use client";

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { Trash2, UploadCloud, FileText, X, Info, ChevronDown, CheckCircle, AlertCircle, Loader2, Trash } from 'lucide-react';
import { motion } from 'framer-motion';
import { Progress } from "@/components/ui/progress";
import { AnimatePresence } from 'framer-motion';
import { cn } from "@/lib/utils";

interface SettingsDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
}

interface SourceDocument {
  id: string;
  name: string;
}

// Interface for tracking upload progress of individual files
interface UploadProgress {
  fileName: string;
  status: 'pending' | 'uploading' | 'success' | 'error';
  progress: number; // 0-100
  error?: string;
}

// Animation variants for Framer Motion
const contentVariants = {
  collapsed: { height: 0, opacity: 0, marginTop: 0 },
  expanded: { 
    height: "auto", 
    opacity: 1, 
    marginTop: "0.75rem", // Equivalent to mt-3
    transition: { duration: 0.3, ease: [0.04, 0.62, 0.23, 0.98] }
  }
};

const SettingsDialog: React.FC<SettingsDialogProps> = ({ isOpen, onOpenChange }) => {
  // State for multiple files and their upload progress
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploads, setUploads] = useState<UploadProgress[]>([]);
  const [isUploadingGlobal, setIsUploadingGlobal] = useState(false); // Global uploading state

  const [sources, setSources] = useState<SourceDocument[]>([]);
  const [isLoadingSources, setIsLoadingSources] = useState(false);
  const [sourcesError, setSourcesError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isInfoExpanded, setIsInfoExpanded] = useState(false);
  const [isDeletingAll, setIsDeletingAll] = useState(false); // State for clearing all
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]); // State for selected IDs
  const [isDeletingSelected, setIsDeletingSelected] = useState(false); // State for deleting selected

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
      // Reset uploads when dialog opens
      setSelectedFiles([]);
      setUploads([]);
      setIsUploadingGlobal(false);
      setIsDeletingAll(false); // Reset delete all state
      setSelectedSourceIds([]); // Reset selected IDs
      setIsDeletingSelected(false); // Reset delete selected state
    }
  }, [isOpen, fetchSources]);

  // Updated to handle multiple files
  const handleFilesSelect = (files: FileList | null) => {
    if (files && files.length > 0) {
      const newFiles = Array.from(files);
      // Prevent duplicates (optional, based on name)
      const uniqueNewFiles = newFiles.filter(nf => !selectedFiles.some(sf => sf.name === nf.name));
      
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

  // Updated to handle multiple files
  const handleFileInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    handleFilesSelect(event.target.files);
     // Reset the input value to allow selecting the same file again
     if (event.target) event.target.value = '';
  };

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    // Add a small delay to prevent flickering when dragging over child elements
    setTimeout(() => {
        // Check if currentTarget exists before using contains
        if (e.currentTarget && (!e.relatedTarget || !(e.currentTarget.contains(e.relatedTarget as Node)))) {
            setIsDragging(false);
        }
    }, 50);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true); 
  };

  // Updated to handle multiple files
  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFilesSelect(e.dataTransfer.files);
      e.dataTransfer.clearData();
    }
  };

  // Remove a specific selected file before upload
  const removeFile = (fileName: string) => {
    setSelectedFiles(prev => prev.filter(f => f.name !== fileName));
    setUploads(prev => prev.filter(u => u.fileName !== fileName));
  };

  // Updated to upload files sequentially
  const handleUploadAll = async () => {
    if (selectedFiles.length === 0 || isUploadingGlobal) return;

    setIsUploadingGlobal(true);
    let uploadOccurred = false; // Flag to check if any upload was attempted

    for (const file of selectedFiles) {
      const uploadIndex = uploads.findIndex(u => u.fileName === file.name && u.status === 'pending');
      if (uploadIndex === -1) continue; // Skip already uploaded or currently uploading files

      uploadOccurred = true;
      // Update status for the specific file
      setUploads(prev => prev.map((u, idx) => idx === uploadIndex ? { ...u, status: 'uploading', progress: 0 } : u));

      let interval: NodeJS.Timeout | null = null;
      try {
        // Simulate progress more smoothly
        interval = setInterval(() => {
          setUploads(prev => prev.map((u, idx) => {
            if (idx === uploadIndex && u.status === 'uploading') {
              const newProgress = Math.min(u.progress + Math.random() * 15, 95); // Cap at 95% until done
              return { ...u, progress: newProgress };
            }
            return u;
          }));
        }, 300);

        const formData = new FormData();
        formData.append('file', file);

        const response = await fetch('/api/settings/sources', {
          method: 'POST',
          body: formData,
        });
        const result = await response.json();

        if (interval) clearInterval(interval);

        if (response.ok && result.success) {
          setUploads(prev => prev.map((u, idx) => idx === uploadIndex ? { ...u, status: 'success', progress: 100 } : u));
        } else {
          throw new Error(result.error || 'Upload failed');
        }
      } catch (error: any) {
        if (interval) clearInterval(interval);
        console.error(`Upload error for ${file.name}:`, error);
        setUploads(prev => prev.map((u, idx) => idx === uploadIndex ? { ...u, status: 'error', progress: 0, error: error.message || 'Network error' } : u));
        // Optionally break the loop on first error, or continue with others
        // break; 
      }
    }

    setIsUploadingGlobal(false);

    // Check if any upload attempt actually happened
    if (uploadOccurred) {
        console.log("Upload process finished. Refreshing sources list shortly...");
        
        // Clear the temporary UI state related to uploads *immediately* after the loop finishes.
        // This prevents the UI from looking "frozen" on the completed uploads.
        // The successful uploads will appear in the refreshed list fetched below.
        setUploads([]);
        setSelectedFiles([]);
        
        // Fetch sources after a delay to allow index update
        setTimeout(() => {
            console.log("Fetching sources after upload completion.");
            fetchSources();
        }, 2000); // Increased delay slightly to 2 seconds

    } else {
        console.log("No pending files were found to upload.");
        // Ensure flag is false even if no uploads happened (e.g., all files were already uploaded)
        setIsUploadingGlobal(false); 
    }
  };

  // Function to handle checkbox change for a source
  const handleSourceSelectionChange = (sourceId: string, checked: boolean | string) => {
    // Ensure checked is treated as boolean
    const isSelected = checked === true;

    setSelectedSourceIds(prev => {
      if (isSelected) {
        return [...prev, sourceId]; // Add ID
      } else {
        return prev.filter(id => id !== sourceId); // Remove ID
      }
    });
  };

  const handleDelete = async (sourceId: string) => {
    console.log("Deleting source:", sourceId);
    // Prevent deletion if already deleting all or selected
    if (isDeletingAll || isDeletingSelected) {
        console.warn("Deletion prevented: Another delete operation in progress.");
        return;
    }
    try {
      const response = await fetch(`/api/settings/sources?id=${encodeURIComponent(sourceId)}`, {
        method: 'DELETE',
      });
      
      if (response.ok && response.status === 204) { 
        console.log("Delete successful (204 No Content), waiting briefly before refresh...");
        // No automatic refresh here if called from handleClearAll
        return true; // Indicate success for handleClearAll
      } else if (response.ok) { 
        const result = await response.json(); 
        if (result.success) {
           console.log("Delete successful (JSON response), refreshing sources...");
           // No automatic refresh here if called from handleClearAll
           return true; // Indicate success for handleClearAll
        } else {
            throw new Error(result.error || 'Failed to delete source (API error)');
        }
      } else { 
          let errorMsg = `HTTP error ${response.status}`;
          try {
              const errorResult = await response.json();
              errorMsg = errorResult.error || errorMsg;
          } catch (e) { /* Ignore JSON parse error if body is empty/not JSON */ }
          throw new Error(errorMsg);
      }
    } catch (error: any) { 
       console.error("Error deleting source:", error);
       alert(`Error deleting source: ${error.message}`); 
       return false; // Indicate failure for handleClearAll
    }
    return false; // Default return if none of the success paths hit
  };

  // New function to handle clearing all sources sequentially
  const handleClearAll = async () => {
    if (sources.length === 0 || isDeletingAll || isUploadingGlobal || isDeletingSelected) return;

    const confirmed = window.confirm(
      `Are you sure you want to delete all ${sources.length} context sources? This action cannot be undone.`
    );

    if (confirmed) {
      setIsDeletingAll(true);
      console.log(`Starting deletion of ${sources.length} sources...`);
      let failedDeletions = 0;

      // Use a copy of the sources array in case state updates during the loop
      const sourcesToDelete = [...sources]; 

      for (const source of sourcesToDelete) {
        console.log(`Deleting source ${source.name} (ID: ${source.id})...`);
        const success = await handleDelete(source.id); 
        if (!success) {
          failedDeletions++;
          console.error(`Failed to delete source: ${source.name}`);
          // Optionally break on first error or continue?
          // break; // Uncomment to stop after the first error
        }
        // Small delay between deletions (optional)
        // await new Promise(resolve => setTimeout(resolve, 100)); 
      }

      console.log(`Finished deleting sources. Failed count: ${failedDeletions}`);
      setIsDeletingAll(false);

      // Refresh the list once after all deletions are attempted, after a short delay
      setTimeout(() => {
          console.log("Fetching sources after clear all completion.");
          fetchSources();
      }, 1000); // Add a 1-second delay before fetching

      if (failedDeletions > 0) {
          alert(`Finished clearing sources, but failed to delete ${failedDeletions} source(s). Check console for details.`);
      }
    }
  };

  // New function to handle deleting selected sources sequentially
  const handleDeleteSelected = async () => {
      if (selectedSourceIds.length === 0 || isDeletingSelected || isDeletingAll || isUploadingGlobal) return;

      const confirmed = window.confirm(
          `Are you sure you want to delete the ${selectedSourceIds.length} selected context source(s)? This action cannot be undone.`
      );

      if (confirmed) {
          setIsDeletingSelected(true);
          console.log(`Starting deletion of ${selectedSourceIds.length} selected sources...`);
          let failedDeletions = 0;
          const idsToDelete = [...selectedSourceIds]; // Copy the array

          for (const sourceId of idsToDelete) {
              console.log(`Deleting selected source ID: ${sourceId}...`);
              const success = await handleDelete(sourceId);
              if (!success) {
                  failedDeletions++;
                  console.error(`Failed to delete selected source ID: ${sourceId}`);
                  // Continue to next deletion even if one fails
              }
              // Optional small delay
              // await new Promise(resolve => setTimeout(resolve, 100));
          }

          console.log(`Finished deleting selected sources. Failed count: ${failedDeletions}`);
          setSelectedSourceIds([]); // Clear selection
          setIsDeletingSelected(false);

          // Refresh the list after all deletions are attempted, with delay
          setTimeout(() => {
              console.log("Fetching sources after selected deletion.");
              fetchSources();
          }, 1000);

          if (failedDeletions > 0) {
              alert(`Finished deleting selected sources, but failed to delete ${failedDeletions} source(s). Check console for details.`);
          }
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

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent 
        className="w-full max-w-xl bg-background shadow-lg overflow-hidden" 
        style={{ 
          borderRadius: '1.5rem',
          padding: '2rem'
        }}
        // Prevent closing while uploading
        onInteractOutside={(e) => { if (isUploadingGlobal || isDeletingAll || isDeletingSelected) e.preventDefault(); }}
      >
        <div className="space-y-6">
          <div className="text-center space-y-3">
            <h2 className="text-2xl font-semibold tracking-tight">Manage Context Sources</h2>
            <p className="text-sm text-foreground">Upload new files or remove existing sources used for chat context.</p>

            {/* Expandable Info Section */}
            <div className="mx-auto w-full max-w-md">
              <button
                onClick={() => setIsInfoExpanded(!isInfoExpanded)}
                className="flex w-full items-center justify-between rounded-lg border bg-muted/40 px-4 py-3 text-left text-sm font-medium transition-colors hover:bg-muted/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
                    key="content"
                    initial="collapsed"
                    animate="expanded"
                    exit="collapsed"
                    variants={contentVariants}
                    className="overflow-hidden text-left text-sm"
                  >
                    <div className="rounded-b-lg border border-t-0 bg-muted/40 p-4 pt-3">
                      <pre className="whitespace-pre-wrap text-xs leading-5 font-mono bg-background/60 rounded-md p-2 mb-3 border">
{`<origin>-<topic>-<yyyy-mm[-dd]>[-<doc-type>][-v<version>].<ext>`}
                      </pre>
                      <ul className="list-disc pl-5 text-xs space-y-1 mb-3">
                        <li><b>origin</b>: internal | external | client | competitor-name</li>
                        <li><b>topic</b>: strategy | market-analysis | campaign-review | project-update …</li>
                        <li><b>date</b>: YYYY-MM or YYYY-MM-DD</li>
                        <li><b>version</b> (optional): v1, v2-final …</li>
                      </ul>
                      <p className="font-semibold text-xs mb-1">Examples</p>
                      <code className="block text-xs mb-0.5">internal-strategy-2024-03-report-v2.md</code>
                      <code className="block text-xs mb-0.5">competitor-tesla-strategy-2023-q4.pdf</code>
                      <code className="block text-xs mb-0.5">market-trends-2024-05-summary.docx</code>
                      <code className="block text-xs">client-acme-project-update-2024-01-15.pptx</code>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
          <Separator />
          <div 
            className={cn(
              "flex flex-col items-center justify-center w-full border-2 border-dashed rounded-lg cursor-pointer bg-muted/40 hover:bg-muted/60 transition-colors p-8",
              isDragging && "border-primary bg-primary/10"
            )}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onClick={() => !isUploadingGlobal && fileInputRef.current?.click()} // Disable click during global upload
          >
            <UploadCloud className={cn("w-10 h-10 mb-3 text-primary", isDragging && "text-primary")} />
            <p className="mb-2 text-sm text-foreground">
              <span className={cn("font-semibold", isUploadingGlobal && "text-muted-foreground")}>Drop your files here</span> 
              <span className={cn(isUploadingGlobal && "text-muted-foreground")}> or browse</span>
            </p>
            <p className={cn("text-xs text-foreground", isUploadingGlobal && "text-muted-foreground")}>Select one or more files</p>
            <Input 
              ref={fileInputRef} 
              id="context-file-hidden" 
              type="file" 
              onChange={handleFileInputChange}
              className="hidden"
              multiple // Allow multiple file selection
              disabled={isUploadingGlobal} // Disable input during global upload
            />
          </div>

          {/* List of Selected Files for Upload */}
          {uploads.length > 0 && (
            <div className="space-y-2 mt-4 max-h-48 overflow-y-auto pr-2">
              {uploads.map((upload) => {
                const file = selectedFiles.find(f => f.name === upload.fileName);
                const fileSizeMB = file ? (file.size / (1024 * 1024)).toFixed(2) : 'N/A';
                return (
                  <div key={upload.fileName} className="p-3 border rounded-lg flex items-center justify-between space-x-3">
                    <div className="flex items-center space-x-3 flex-grow min-w-0 overflow-hidden">
                      <FileText className="w-5 h-5 text-primary flex-shrink-0" />
                      <div className="min-w-0 flex-grow">
                        <p 
                          className="text-sm font-medium truncate" // Added truncate
                          title={upload.fileName}
                        >
                          {upload.fileName}
                        </p>
                        {upload.status === 'uploading' && (
                          <Progress value={upload.progress} className="h-1 mt-1" />
                        )}
                        {upload.status === 'pending' && file && (
                          <p className="text-xs text-foreground">{fileSizeMB} MB - Pending</p>
                        )}
                         {upload.status === 'success' && (
                          <div className="flex items-center text-xs text-green-600 mt-1">
                            <CheckCircle className="w-3 h-3 mr-1" /> Uploaded
                          </div>
                        )}
                        {upload.status === 'error' && (
                           <div className="flex items-center text-xs text-red-600 mt-1" title={upload.error}>
                             <AlertCircle className="w-3 h-3 mr-1" /> Error 
                             {upload.error && <span className="truncate">: {upload.error}</span>}
                          </div>
                        )}
                      </div>
                    </div>
                    {/* Show remove button only if pending and not globally uploading */}
                    {upload.status === 'pending' && !isUploadingGlobal && (
                       <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-6 w-6 text-foreground hover:text-destructive flex-shrink-0" 
                          onClick={() => removeFile(upload.fileName)}
                          aria-label={`Remove ${upload.fileName}`}
                       >
                          <X className="h-4 w-4" />
                       </Button>
                    )}
                    {/* Show status icons */}
                     {upload.status === 'uploading' && (
                         <Loader2 className="h-4 w-4 animate-spin text-muted-foreground flex-shrink-0" />
                     )}
                     {upload.status === 'success' && (
                         <CheckCircle className="h-4 w-4 text-green-600 flex-shrink-0" />
                     )}
                     {upload.status === 'error' && (
                         <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0" />
                     )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Upload All Button */}
          {selectedFiles.length > 0 && uploads.some(u => u.status === 'pending') && (
               <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.98 }} className="mt-4">
                  <Button 
                    onClick={handleUploadAll} 
                    disabled={isUploadingGlobal}
                    className="w-full"
                  >
                    {isUploadingGlobal ? (
                       <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                       <UploadCloud className="mr-2 h-4 w-4" /> 
                    )}
                    {isUploadingGlobal ? 'Uploading...' : `Upload ${uploads.filter(u => u.status === 'pending').length} File(s)`}
                  </Button>
              </motion.div>
           )}
            
          {/* Separator before Current Sources */}
          {(uploads.length > 0 || sources.length > 0 || selectedSourceIds.length > 0) && <Separator className="my-4" />} 

          {/* Current Sources List */}
          {sources.length > 0 && (
            <div className="pt-2">
              <div className="flex justify-between items-center mb-3 gap-2 flex-wrap">
                <h3 className="text-lg font-semibold">Current Context Sources</h3>
                <div className="flex items-center gap-2">
                  {selectedSourceIds.length > 0 && (
                      <Button 
                          variant="outline"
                          size="sm"
                          onClick={handleDeleteSelected}
                          disabled={isDeletingSelected || isDeletingAll || isUploadingGlobal}
                          className="flex items-center gap-1.5"
                          title={`Delete ${selectedSourceIds.length} selected source(s)`}
                      >
                          {isDeletingSelected ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                              <Trash2 className="h-4 w-4" /> 
                          )}
                          {isDeletingSelected ? "Deleting..." : `Delete Selected (${selectedSourceIds.length})`}
                      </Button>
                  )}
                  {sources.length > 0 && (
                      <Button 
                          variant="destructive" 
                          size="sm"
                          onClick={handleClearAll}
                          disabled={isDeletingAll || isUploadingGlobal || isDeletingSelected}
                          className="flex items-center gap-1.5"
                          title="Delete all sources from the index"
                      >
                          {isDeletingAll ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                              <Trash className="h-4 w-4" />
                          )}
                          {isDeletingAll ? "Clearing..." : "Clear All"}
                      </Button>
                  )}
                </div>
              </div>
              <ScrollArea className="h-[200px] w-full">
                <motion.ul 
                  className="space-y-2 pr-3"
                  variants={listVariants}
                  initial="hidden"
                  animate="visible"
                >
                  {sources.map((source) => (
                    <motion.li 
                      key={source.id} 
                      className="flex justify-between items-center text-sm p-3 border rounded-lg space-x-2"
                      variants={itemVariants}
                    >
                      <div className="flex items-center gap-3 flex-grow min-w-0">
                          <Checkbox 
                              id={`select-${source.id}`}
                              checked={selectedSourceIds.includes(source.id)}
                              onCheckedChange={(checked) => handleSourceSelectionChange(source.id, checked)}
                              aria-label={`Select ${source.name}`}
                              disabled={isDeletingAll || isDeletingSelected || isUploadingGlobal}
                          />
                          <FileText className="w-4 h-4 text-primary flex-shrink-0" />
                          <label 
                              htmlFor={`select-${source.id}`} 
                              className="flex-grow text-foreground truncate cursor-pointer" 
                              title={source.name}
                          >
                              {source.name}
                          </label> 
                      </div>
                      <motion.div whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-6 w-6 text-foreground hover:text-destructive flex-shrink-0" 
                          onClick={async () => {
                            const success = await handleDelete(source.id);
                            if (success) {
                                fetchSources(); // Refresh list only if single delete succeeded
                            }
                          }}
                          aria-label={`Delete ${source.name}`}
                          disabled={isUploadingGlobal || isDeletingAll || isDeletingSelected} // Disable during any delete
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </motion.div>
                    </motion.li>
                  ))}
                </motion.ul>
              </ScrollArea>
            </div>
          )}
          {isLoadingSources && (
              <p className="text-sm text-foreground text-center py-4">Loading sources...</p>
            )}
          {sourcesError && (
              <p className="text-sm text-red-600 text-center py-4">Error loading sources: {sourcesError}</p>
            )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default SettingsDialog; 