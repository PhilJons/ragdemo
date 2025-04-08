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
import { Trash2, UploadCloud, FileText, X } from 'lucide-react';
import { motion } from 'framer-motion';
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

interface SettingsDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
}

interface SourceDocument {
  id: string;
  name: string;
}

const SettingsDialog: React.FC<SettingsDialogProps> = ({ isOpen, onOpenChange }) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  
  const [sources, setSources] = useState<SourceDocument[]>([]);
  const [isLoadingSources, setIsLoadingSources] = useState(false);
  const [sourcesError, setSourcesError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [simulatedProgress, setSimulatedProgress] = useState(0);

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
    }
  }, [isOpen, fetchSources]);

  const handleFileSelect = (file: File | null) => {
    if (file) {
        setSelectedFile(file);
        setUploadStatus(null);
        setUploadError(null);
        setSimulatedProgress(0);
    } else {
        setSelectedFile(null);
    }
  };
  
  const handleFileInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    handleFileSelect(event.target.files ? event.target.files[0] : null);
  };

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true); 
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileSelect(e.dataTransfer.files[0]);
      e.dataTransfer.clearData();
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) return;
    setIsUploading(true);
    setUploadStatus("Uploading...");
    setUploadError(null);
    setSimulatedProgress(0);

    const interval = setInterval(() => {
      setSimulatedProgress(prev => {
        if (prev >= 95) return prev;
        return prev + Math.random() * 10;
      });
    }, 200);

    const formData = new FormData();
    formData.append('file', selectedFile);

    try {
      const response = await fetch('/api/settings/sources', {
        method: 'POST',
        body: formData,
      });
      const result = await response.json();

      clearInterval(interval);
      setSimulatedProgress(100);

      if (response.ok && result.success) {
        setUploadStatus(`Success: ${result.message}`);
        setSelectedFile(null);
        console.log("Upload successful, waiting briefly before refresh...");
        setTimeout(() => {
          console.log("Refreshing sources after upload delay.");
          fetchSources();
          setSimulatedProgress(0);
        }, 1500);
      } else {
        console.error("Upload failed:", result);
        setUploadError(`Error: ${result.error || 'Upload failed'}`);
        setUploadStatus(null);
        setSimulatedProgress(0);
      }
    } catch (error: any) {      
      clearInterval(interval);
      setSimulatedProgress(0);
      console.error("Upload fetch error:", error);
      setUploadError(`Error: ${error.message || 'Network error during upload'}`);
      setUploadStatus(null);
    } finally {
      setIsUploading(false);
    }
  };

  const handleDelete = async (sourceId: string) => {
    console.log("Deleting source:", sourceId);
    try {
      const response = await fetch(`/api/settings/sources?id=${encodeURIComponent(sourceId)}`, {
        method: 'DELETE',
      });
      
      if (response.ok && response.status === 204) { 
        console.log("Delete successful (204 No Content), waiting briefly before refresh...");
        setTimeout(() => {
          console.log("Refreshing sources after delay.");
          fetchSources(); 
        }, 750);
      } else if (response.ok) { 
        const result = await response.json(); 
        if (result.success) {
           console.log("Delete successful (JSON response), refreshing sources...");
           fetchSources();
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
        className="w-full max-w-xl bg-background shadow-lg overflow-hidden p-8 rounded-3xl [--radius:1.5rem]"
      >
        <div className="space-y-6">
          <div className="text-center space-y-1">
             <h2 className="text-2xl font-semibold tracking-tight">Manage Context Sources</h2>
             <p className="text-sm text-muted-foreground">
                Upload new files or remove existing sources used for chat context.
             </p>
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
            onClick={() => fileInputRef.current?.click()}
          >
            <UploadCloud className={cn("w-10 h-10 mb-3 text-muted-foreground", isDragging && "text-primary")} />
            <p className="mb-2 text-sm text-muted-foreground">
              <span className="font-semibold">Drop your files here</span> or browse
            </p>
            <p className="text-xs text-muted-foreground">Max file size up to 1GB</p>
            <Input 
              ref={fileInputRef} 
              id="context-file-hidden" 
              type="file" 
              onChange={handleFileInputChange}
              className="hidden"
            />
          </div>

          {selectedFile && (
            <div className="p-3 border rounded-lg flex items-center justify-between space-x-3">
              <div className="flex items-center space-x-3 overflow-hidden">
                <FileText className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                <div className="flex-grow min-w-0">
                  <p className="text-sm font-medium truncate">{selectedFile.name}</p>
                  {isUploading ? (
                     <Progress value={simulatedProgress} className="h-1 mt-1" />
                  ) : (
                    <p className="text-xs text-muted-foreground">{(selectedFile.size / (1024*1024)).toFixed(2)} MB</p>
                  )}
                </div>
              </div>
              <Button 
                  variant="ghost" 
                  size="icon" 
                  className="h-6 w-6 text-muted-foreground hover:text-destructive flex-shrink-0" 
                  onClick={() => handleFileSelect(null)}
                  aria-label={`Remove ${selectedFile.name}`}
              >
                  <X className="h-4 w-4" />
              </Button>
            </div>
          )}

          {uploadStatus && !isUploading && <p className="text-sm text-green-600 mt-1">{uploadStatus}</p>}
          {uploadError && <p className="text-sm text-red-600 mt-1">{uploadError}</p>}
          
          {selectedFile && !isUploading && (
               <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.98 }} className="mt-2">
                  <Button 
                  onClick={handleUpload} 
                  disabled={isUploading}
                  className="w-full"
                  >
                  Upload File
                  </Button>
              </motion.div>
           )}

          {(selectedFile || sources.length > 0) && <Separator className="my-4" />} 

          {sources.length > 0 && (
            <div className="pt-2">
              <h3 className="text-lg font-semibold mb-3">Current Context Sources</h3>
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
                       <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                       <span className="flex-grow truncate" title={source.name}>{source.name}</span>
                      <motion.div whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-6 w-6 text-muted-foreground hover:text-destructive flex-shrink-0" 
                          onClick={() => handleDelete(source.id)}
                          aria-label={`Delete ${source.name}`}
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
              <p className="text-sm text-muted-foreground text-center py-4">Loading sources...</p>
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