"use client";

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Trash2, UploadCloud, FileText, X, Info, ChevronDown, CheckCircle, AlertCircle, Loader2, Trash, Settings as SettingsIcon, ExternalLink } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
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

// New Project type
interface Project {
  id: string;
  name: string;
  description?: string | null;
  activeProjectPromptId?: string | null;
  activeGlobalPromptName?: string | null;
  temperature?: number | null;
  maxTokens?: number | null;
}

// New interface for project-specific prompts, mirroring Prisma model
interface ProjectPrompt {
  id: string;
  name: string;
  content: string;
  projectId: string;
  isDefault?: boolean; // Optional, as per schema
  createdAt: string; // Dates will be strings from JSON
  updatedAt: string;
}

interface SettingsDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  systemPrompts: SystemPrompt[]; // Global/default prompts passed from parent
  selectedPromptName: string; // This likely refers to the globally selected active prompt name
  onSelectPrompt: (name: string) => void; // Handler for globally selected active prompt
  defaultPromptNames: string[]; // Names of the global/default prompts
  isLoadingChat: boolean; 
  temperature: number;
  onTemperatureChange: (value: number) => void;
  maxTokens: number;
  onMaxTokensChange: (value: number) => void;
  currentProjectId: string | null; // Added property for the active project ID from chat interface
  onProjectDeleted: (deletedProjectId: string) => void; // New prop for handling project deletion callback
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
(e.g., "A report with: 1. Executive TLDR (3-5 bullets). 2. Detailed breakdown by research house, showing report date, rating, price target, and key commentary. 3. Appendix listing sources.", "Output similar to the default financial analyst prompt&apos;s structure.", "Main sections: 'Overall Sentiment Shift', 'Key Themes by Research House', 'Price Target Evolution'.", "Output a list of key forecast changes with analyst justifications.")
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
  defaultPromptNames,
  isLoadingChat,
  temperature: globalTemperature,
  onTemperatureChange: onGlobalTemperatureChange,
  maxTokens: globalMaxTokens,
  onMaxTokensChange: onGlobalMaxTokensChange,
  currentProjectId,
  onProjectDeleted
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

  // State for user's projects
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>("data-management");
  
  // State for project-specific custom prompts
  const [projectCustomPrompts, setProjectCustomPrompts] = useState<ProjectPrompt[]>([]);
  const [isLoadingProjectPrompts, setIsLoadingProjectPrompts] = useState<boolean>(false);
  const [projectPromptsError, setProjectPromptsError] = useState<string | null>(null);

  // State for prompt form (used for both create and edit of project prompts)
  const [promptFormName, setPromptFormName] = useState('');
  const [promptFormContent, setPromptFormContent] = useState('');
  const [editingPrompt, setEditingPrompt] = useState<ProjectPrompt | null>(null); // Store the full prompt being edited
  const [isSavingPrompt, setIsSavingPrompt] = useState<boolean>(false);
  const [aiGenerationError, setAiGenerationError] = useState<string | null>(null);
  const [isGeneratingAiPrompt, setIsGeneratingAiPrompt] = useState(false);

  // State for the active project's specific settings FORM INPUTS
  const [formActivePromptKey, setFormActivePromptKey] = useState<string>(""); // e.g., "project-id:<id>" or "global-name:<n>"
  const [formTemperature, setFormTemperature] = useState<number>(globalTemperature);
  const [formMaxTokens, setFormMaxTokens] = useState<number>(globalMaxTokens);
  
  const [isSavingProjectSettings, setIsSavingProjectSettings] = useState<boolean>(false);
  const [projectSettingsError, setProjectSettingsError] = useState<string | null>(null);

  // State for project deletion confirmation
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState<boolean>(false);
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [isDeletingProject, setIsDeletingProject] = useState<boolean>(false);
  const [deleteProjectError, setDeleteProjectError] = useState<string | null>(null);

  // --- Fetch User Projects Logic ---
  const fetchProjects = useCallback(async () => {
    setIsLoadingProjects(true);
    setProjectsError(null);
    try {
      const response = await fetch('/api/projects');
      if (!response.ok) {
        const errorResult = await response.json().catch(() => ({ error: `HTTP error! status: ${response.status}` }));
        throw new Error(errorResult.error || `HTTP error! status: ${response.status}`);
      }
      const result = await response.json();
      const fetchedProjects = Array.isArray(result) ? result : (result.projects || []);
      setProjects(fetchedProjects);
    } catch (error: any) {
      console.error("Error fetching projects:", error);
      setProjectsError(error.message || "Failed to fetch projects.");
      setProjects([]);
    } finally {
      setIsLoadingProjects(false);
    }
  }, []);

  // --- File Management Logic ---
  const fetchSources = useCallback(async (projectId: string | null) => {
    if (!projectId) {
      setSources([]);
      setIsLoadingSources(false);
      return;
    }
    setIsLoadingSources(true);
    setSourcesError(null);
    try {
      const response = await fetch(`/api/settings/sources?projectId=${encodeURIComponent(projectId)}`);
      const result = await response.json();
      if (response.ok && result.success) {
        setSources(result.sources || []);
      } else {
        throw new Error(result.error || 'Failed to fetch sources for project');
      }
    } catch (error: any) {
      console.error(`Error fetching sources for project ${projectId}:`, error);
      setSourcesError(error.message);
      setSources([]);
    } finally {
      setIsLoadingSources(false);
    }
  }, []);

  const fetchProjectPrompts = useCallback(async (projectId: string | null) => {
    if (!projectId) {
      setProjectCustomPrompts([]);
      setIsLoadingProjectPrompts(false);
      return;
    }
    setIsLoadingProjectPrompts(true);
    setProjectPromptsError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/prompts`);
      if (!response.ok) {
        const errorResult = await response.json().catch(() => ({ error: `HTTP error! status: ${response.status}` }));
        throw new Error(errorResult.error || 'Failed to fetch project prompts');
      }
      const prompts: ProjectPrompt[] = await response.json();
      setProjectCustomPrompts(prompts);
    } catch (error: any) {
      console.error(`Error fetching prompts for project ${projectId}:`, error);
      setProjectPromptsError(error.message);
      setProjectCustomPrompts([]);
    } finally {
      setIsLoadingProjectPrompts(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchProjects();
      // Reset states that are not project-specific or will be reloaded by project selection
      setSelectedFiles([]);
      setUploads([]);
      setIsUploadingGlobal(false);
      setIsDeletingAll(false);
      setSelectedSourceIds([]);
      setIsDeletingSelected(false);
      // Reset prompt form explicitly
      setEditingPrompt(null);
      setPromptFormName('');
      setPromptFormContent('');
      setAiGenerationError(null);
      setIsGeneratingAiPrompt(false);
    }
  }, [isOpen, fetchProjects]);

  // Effect for reacting to currentProjectId changes
  useEffect(() => {
    if (isOpen && currentProjectId) {
      fetchSources(currentProjectId);
      fetchProjectPrompts(currentProjectId);
    } else if (isOpen && !currentProjectId) {
      setSources([]);
      setIsLoadingSources(false);
      setProjectCustomPrompts([]);
      setIsLoadingProjectPrompts(false);
    }
  }, [isOpen, currentProjectId, fetchSources, fetchProjectPrompts]);

  // Effect to initialize/update form fields when currentProjectId or the projects list changes
  useEffect(() => {
    if (currentProjectId) {
      const projectData = projects.find(p => p.id === currentProjectId);
      if (projectData) {
        // Initialize form from current project's settings or fall back to global defaults
        if (projectData.activeProjectPromptId) {
          setFormActivePromptKey(`project-${projectData.activeProjectPromptId}`);
        } else if (projectData.activeGlobalPromptName) {
          setFormActivePromptKey(`global-${projectData.activeGlobalPromptName}`);
        } else {
          setFormActivePromptKey(""); // No specific prompt override for project
        }
        setFormTemperature(projectData.temperature ?? globalTemperature);
        setFormMaxTokens(projectData.maxTokens ?? globalMaxTokens);
      } else {
        // Project selected but not found in list (should ideally not happen if projects list is up-to-date)
        setFormActivePromptKey("");
        setFormTemperature(globalTemperature);
        setFormMaxTokens(globalMaxTokens);
      }
    } else {
      // No project selected, reset form to global defaults
      setFormActivePromptKey("");
      setFormTemperature(globalTemperature);
      setFormMaxTokens(globalMaxTokens);
    }
  }, [currentProjectId, projects, globalTemperature, globalMaxTokens]);

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
    if (!currentProjectId) {
      alert("Please select a project before uploading files.");
      return;
    }
    if (selectedFiles.length === 0 || isUploadingGlobal) return;
    setIsUploadingGlobal(true);
    let uploadOccurred = false;
    for (const file of selectedFiles) {
      const uploadIndex = uploads.findIndex(u => u.fileName === file.name && u.status === 'pending');
      if (uploadIndex === -1) continue;
      uploadOccurred = true;
      setUploads(prev => prev.map((u, idx) => idx === uploadIndex ? { ...u, status: 'uploading', progress: 0 } : u));
      
      let interval: NodeJS.Timeout | null = null;
      try {
        interval = setInterval(() => {
          setUploads(prev => prev.map((up, i) => 
            i === uploadIndex && up.status === 'uploading' ? { ...up, progress: Math.min(up.progress + Math.random() * 15, 95) } : up
          ));
        }, 300);
        const formData = new FormData();
        formData.append('file', file);
        formData.append('projectId', currentProjectId); // Add currentProjectId to FormData

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
      setTimeout(() => fetchSources(currentProjectId), 2000); // Re-fetch sources for the current project
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
    if (success) fetchSources(currentProjectId);
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

  const handleAddOrUpdateProjectPrompt = async () => {
    if (!currentProjectId) {
      alert("A project must be selected to save a prompt.");
      return;
    }
    if (!promptFormName.trim() || !promptFormContent.trim()) {
      alert("Prompt name and content are required.");
      return;
    }
    setIsSavingPrompt(true);
    
    const apiUrl = editingPrompt 
      ? `/api/projects/${currentProjectId}/prompts/${editingPrompt.id}`
      : `/api/projects/${currentProjectId}/prompts`;
    const method = editingPrompt ? 'PUT' : 'POST';

    try {
      const response = await fetch(apiUrl, {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          name: promptFormName.trim(), 
          content: promptFormContent.trim(),
          // isDefault: editingPrompt ? editingPrompt.isDefault : false // Or however you manage isDefault
        }),
      });

      if (!response.ok) {
        const errorResult = await response.json().catch(() => ({ error: `HTTP error! status: ${response.status}` }));
        throw new Error(errorResult.error || `Failed to ${editingPrompt ? 'update' : 'create'} prompt.`);
      }
      
      setPromptFormName('');
      setPromptFormContent('');
      setEditingPrompt(null);
      fetchProjectPrompts(currentProjectId); // Refresh list
      setActiveTab("manage-prompts");

    } catch (error: any) {
      console.error(`Error saving project prompt:`, error);
      alert(`Error: ${error.message}`);
    } finally {
      setIsSavingPrompt(false);
    }
  };

  const handleSelectProjectPromptForEditing = (prompt: ProjectPrompt) => {
    setEditingPrompt(prompt);
    setPromptFormName(prompt.name);
    setPromptFormContent(prompt.content);
    setAiGenerationError(null);
    setActiveTab("create-edit-prompt");
  };

  const handleCancelProjectPromptEdit = () => {
    setEditingPrompt(null);
    setPromptFormName('');
    setPromptFormContent('');
    setAiGenerationError(null);
  };

  const handleDeleteProjectPrompt = async (promptId: string) => {
    if (!currentProjectId) {
      alert("Cannot delete prompt: No project selected.");
      return;
    }
    if (!window.confirm("Are you sure you want to delete this prompt?")) return;

    setIsSavingPrompt(true); // Can reuse isSavingPrompt or add a specific isDeletingPrompt state
    try {
      const response = await fetch(`/api/projects/${currentProjectId}/prompts/${promptId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        if (response.status === 204) { // Successfully deleted, no content expected
          // continue to fetch prompts
        } else {
          const errorResult = await response.json().catch(() => ({ error: `HTTP error! status: ${response.status}` }));
          throw new Error(errorResult.error || 'Failed to delete prompt.');
        }
      }
      // If deletion was successful (204 or falls through ok check if API returns JSON on delete which it shouldn't for 204)
      fetchProjectPrompts(currentProjectId); // Refresh the list
      // If the deleted prompt was being edited, clear the form
      if (editingPrompt && editingPrompt.id === promptId) {
        handleCancelProjectPromptEdit();
        setActiveTab("manage-prompts"); // Go back to list if deleted from edit form
      }

    } catch (error: any) {
      console.error(`Error deleting project prompt ${promptId}:`, error);
      alert(`Error: ${error.message}`);
    } finally {
      setIsSavingPrompt(false);
    }
  };

  // handleGenerateWithAi (for prompt form content)
  const handleGenerateWithAiForProjectPrompt = async () => {
    if (!promptFormContent.trim() && !editingPrompt) { 
      setPromptFormContent(BOILERPLATE_SYSTEM_PROMPT_TEMPLATE);
      setAiGenerationError(null);
      return;
    }
    setIsGeneratingAiPrompt(true);
    setAiGenerationError(null);
    try {
      const result = await structureUserInputsIntoSystemPromptAction(promptFormContent);
      if (result.success && result.structuredPrompt) {
        setPromptFormContent(result.structuredPrompt);
      } else {
        setAiGenerationError(result.error || "Failed to structure prompt with AI.");
      }
    } catch (error: any) {
      setAiGenerationError(`An unexpected error occurred: ${error.message}`);
    } finally {
      setIsGeneratingAiPrompt(false);
    }
  };

  const closeDialog = () => {
    if (!isUploadingGlobal && !isDeletingAll && !isDeletingSelected && !isGeneratingAiPrompt && !isDeletingProject) {
      onOpenChange(false);
    }
  };

  const handleSaveProjectSettings = async () => {
    if (!currentProjectId) {
      alert("No project selected to save settings for.");
      return;
    }
    setIsSavingProjectSettings(true);
    setProjectSettingsError(null);

    let settingsToUpdate: any = {
      temperature: formTemperature,
      maxTokens: formMaxTokens,
      activeProjectPromptId: null, 
      activeGlobalPromptName: null,
    };

    if (formActivePromptKey.startsWith("project-")) {
      settingsToUpdate.activeProjectPromptId = formActivePromptKey.replace("project-", "");
    } else if (formActivePromptKey.startsWith("global-")) {
      settingsToUpdate.activeGlobalPromptName = formActivePromptKey.replace("global-", "");
    }

    try {
      const response = await fetch(`/api/projects/${currentProjectId}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settingsToUpdate),
      });

      if (!response.ok) {
        const errorResult = await response.json().catch(() => ({ error: `HTTP error! status: ${response.status}` }));
        throw new Error(errorResult.error || 'Failed to save project settings.');
      }
      const updatedProjectFromServer = await response.json();
      
      // Update the local 'projects' state to reflect the saved settings
      setProjects(prevProjects => 
        prevProjects.map(p => 
          p.id === currentProjectId ? { ...p, ...updatedProjectFromServer } : p
        )
      );
      alert("Project settings saved successfully!");

    } catch (error: any) {
      console.error("Error saving project settings:", error);
      setProjectSettingsError(error.message);
      alert(`Error saving settings: ${error.message}`);
    } finally {
      setIsSavingProjectSettings(false);
    }
  };

  // --- Function to handle opening the delete confirmation ---
  const openDeleteConfirmation = () => {
    if (!currentProjectId) return;
    const project = projects.find(p => p.id === currentProjectId);
    if (project) {
      setProjectToDelete(project);
      setDeleteProjectError(null);
      setIsDeleteConfirmOpen(true);
    }
  };

  // --- Function to handle actual project deletion ---
  const handleDeleteProject = async () => {
    if (!projectToDelete) return;
    setIsDeletingProject(true);
    setDeleteProjectError(null);

    try {
      const response = await fetch(`/api/projects/${projectToDelete.id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const errorResult = await response.json().catch(() => ({ error: `HTTP error! status: ${response.status}` }));
        throw new Error(errorResult.error || 'Failed to delete project.');
      }
      
      // Call the callback to notify parent component (ChatInterface)
      onProjectDeleted(projectToDelete.id);
      
      // Close confirmation and main settings dialog
      setIsDeleteConfirmOpen(false);
      setProjectToDelete(null);
      // Optionally, close the main settings dialog or switch tab after deletion
      // onOpenChange(false); // Or let ChatInterface handle this based on activeProjectId change
      fetchProjects(); // Re-fetch projects to update the list within the dialog if it remains open

    } catch (error: any) {
      console.error(`Error deleting project ${projectToDelete.id}:`, error);
      setDeleteProjectError(error.message);
      // Keep confirmation dialog open to show error, or show alert
      alert(`Error deleting project: ${error.message}`);
    } finally {
      setIsDeletingProject(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={closeDialog}>
      <DialogContent 
        className="max-w-[1200px] w-full h-[85vh] flex flex-col p-0"
        onInteractOutside={(e) => { 
          if (isUploadingGlobal || isDeletingAll || isDeletingSelected || isGeneratingAiPrompt || isDeletingProject) e.preventDefault(); 
        }}
      >
        <DialogHeader className="p-6 pb-4 flex-shrink-0 border-b border-slate-200 dark:border-slate-700">
          <DialogTitle className="text-2xl font-semibold text-slate-800 dark:text-slate-100">Settings</DialogTitle>
          <DialogDescription className="text-slate-600 dark:text-slate-400">
            Configure data, prompts, and model settings for your active project.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-grow flex flex-col min-h-0">
          <TabsList className="mx-6 mt-4 mb-0 flex-shrink-0 border-b border-slate-200 dark:border-slate-700 p-0 bg-transparent justify-start">
            <TabsTrigger value="data-management" className="py-3 px-4 text-sm font-medium text-slate-500 dark:text-slate-400 data-[state=active]:text-purple-600 dark:data-[state=active]:text-purple-400 data-[state=active]:border-purple-600 dark:data-[state=active]:border-purple-400 border-b-2 border-transparent hover:text-slate-700 dark:hover:text-slate-200 data-[state=active]:bg-transparent data-[state=active]:shadow-none focus-visible:ring-offset-0 focus-visible:ring-2 focus-visible:ring-purple-500 rounded-none">Context Data</TabsTrigger>
            <TabsTrigger value="prompt-model-settings" className="py-3 px-4 text-sm font-medium text-slate-500 dark:text-slate-400 data-[state=active]:text-purple-600 dark:data-[state=active]:text-purple-400 data-[state=active]:border-purple-600 dark:data-[state=active]:border-purple-400 border-b-2 border-transparent hover:text-slate-700 dark:hover:text-slate-200 data-[state=active]:bg-transparent data-[state=active]:shadow-none focus-visible:ring-offset-0 focus-visible:ring-2 focus-visible:ring-purple-500 rounded-none">Active Prompt & Model</TabsTrigger>
            <TabsTrigger value="manage-prompts" className="py-3 px-4 text-sm font-medium text-slate-500 dark:text-slate-400 data-[state=active]:text-purple-600 dark:data-[state=active]:text-purple-400 data-[state=active]:border-purple-600 dark:data-[state=active]:border-purple-400 border-b-2 border-transparent hover:text-slate-700 dark:hover:text-slate-200 data-[state=active]:bg-transparent data-[state=active]:shadow-none focus-visible:ring-offset-0 focus-visible:ring-2 focus-visible:ring-purple-500 rounded-none">Manage Prompts</TabsTrigger>
            <TabsTrigger value="create-edit-prompt" className="py-3 px-4 text-sm font-medium text-slate-500 dark:text-slate-400 data-[state=active]:text-purple-600 dark:data-[state=active]:text-purple-400 data-[state=active]:border-purple-600 dark:data-[state=active]:border-purple-400 border-b-2 border-transparent hover:text-slate-700 dark:hover:text-slate-200 data-[state=active]:bg-transparent data-[state=active]:shadow-none focus-visible:ring-offset-0 focus-visible:ring-2 focus-visible:ring-purple-500 rounded-none">Create/Edit Prompt</TabsTrigger>
          </TabsList>
          
          <div className="flex-grow overflow-y-auto p-6 pt-8 min-h-0 bg-slate-50 dark:bg-slate-900/50">
            {currentProjectId ? (
              <>
                <TabsContent value="data-management" className="mt-0 focus-visible:ring-0 focus-visible:ring-offset-0">
                  <div className="max-w-4xl mx-auto space-y-8">
                    
                    <div>
                      <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-100 mb-1">Manage Context Sources</h2>
                      <p className="text-sm text-slate-600 dark:text-slate-400 mb-6">
                        Upload new files or remove existing sources for the project: <strong className="font-medium text-slate-700 dark:text-slate-300">{projects.find(p=>p.id === currentProjectId)?.name}</strong>
                      </p>
                      
                      <div className="mb-6 bg-white dark:bg-slate-800 shadow-sm rounded-lg">
                        <button
                          onClick={() => setIsInfoExpanded(!isInfoExpanded)}
                          className="flex w-full items-center justify-between p-4 text-left text-sm font-medium transition-colors hover:bg-slate-50 dark:hover:bg-slate-700/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-800 rounded-t-lg"
                          aria-expanded={isInfoExpanded}
                        >
                          <div className="flex items-center gap-2.5 text-slate-700 dark:text-slate-300">
                            <Info className="h-4 w-4 text-slate-500 dark:text-slate-400" />
                            <span>Recommended File-Naming Schema</span>
                          </div>
                          <ChevronDown
                            className={cn(
                              "h-5 w-5 shrink-0 text-slate-500 dark:text-slate-400 transition-transform duration-200",
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
                              className="overflow-hidden text-left text-sm border-t border-slate-200 dark:border-slate-700"
                            >
                              <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-b-lg">
                                <pre className="whitespace-pre-wrap text-xs leading-relaxed font-mono bg-slate-100 dark:bg-slate-700/60 rounded-md p-3 mb-3 border border-slate-200 dark:border-slate-600/80 text-slate-600 dark:text-slate-300">
                                  {`<origin>-<topic>-<yyyy-mm[-dd]>[-<doc-type>][-v<version>].<ext>`}
                                </pre>
                                <ul className="list-disc pl-5 text-xs space-y-1.5 mb-3 text-slate-600 dark:text-slate-400">
                                  <li><b>origin</b>: internal | external | client | competitor-name</li>
                                  <li><b>topic</b>: strategy | market-analysis | campaign-review | project-update …</li>
                                  <li><b>date</b>: YYYY-MM or YYYY-MM-DD</li>
                                  <li><b>version</b> (optional): v1, v2-final …</li>
                                </ul>
                                <p className="font-medium text-xs mb-1.5 text-slate-700 dark:text-slate-300">Examples</p>
                                <code className="block text-xs mb-1 text-slate-500 dark:text-slate-400/90">internal-strategy-2024-03-report-v2.md</code>
                                <code className="block text-xs mb-1 text-slate-500 dark:text-slate-400/90">competitor-tesla-strategy-2023-q4.pdf</code>
                                <code className="block text-xs mb-1 text-slate-500 dark:text-slate-400/90">market-trends-2024-05-summary.docx</code>
                                <code className="block text-xs text-slate-500 dark:text-slate-400/90">client-acme-project-update-2024-01-15.pptx</code>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>

                      <div 
                        className={cn(
                          "flex flex-col items-center justify-center w-full border-2 border-dashed border-slate-300 dark:border-slate-600/80 rounded-xl cursor-pointer bg-white dark:bg-slate-800 hover:border-purple-500 dark:hover:border-purple-400 hover:bg-purple-50/30 dark:hover:bg-purple-900/20 transition-all duration-200 p-8 min-h-[180px] group",
                          isDragging && "border-purple-600 dark:border-purple-500 bg-purple-50/50 dark:bg-purple-900/30"
                        )}
                        onDragEnter={handleDragEnter} onDragLeave={handleDragLeave} onDragOver={handleDragOver} onDrop={handleDrop}
                        onClick={() => !(isUploadingGlobal || isDeletingAll || isDeletingSelected) && fileInputRef.current?.click()}
                      >
                        <UploadCloud className={cn("w-10 h-10 mb-3 text-slate-400 dark:text-slate-500 group-hover:text-purple-600 dark:group-hover:text-purple-400 transition-colors", isDragging && "text-purple-600 dark:text-purple-400")} />
                        <p className="mb-1 text-sm font-medium text-slate-700 dark:text-slate-300 group-hover:text-purple-700 dark:group-hover:text-purple-300">
                          <span className={cn((isUploadingGlobal || isDeletingAll || isDeletingSelected) && "text-slate-400 dark:text-slate-500")}>Drop your files here</span>
                          <span className={cn("text-purple-600 dark:text-purple-400 group-hover:underline", (isUploadingGlobal || isDeletingAll || isDeletingSelected) && "text-slate-400 dark:text-slate-500 no-underline")}> or browse</span>
                        </p>
                        <p className={cn("text-xs text-slate-500 dark:text-slate-400/80", (isUploadingGlobal || isDeletingAll || isDeletingSelected) && "dark:text-slate-500")}>Select one or more files (PDF, TXT, MD, DOCX)</p>
                        <Input ref={fileInputRef} id="context-file-hidden" type="file" onChange={handleFileInputChange} className="hidden" multiple disabled={isUploadingGlobal || isDeletingAll || isDeletingSelected} accept=".pdf,.txt,.md,.docx" />
                      </div>

                      {uploads.length > 0 && (
                        <div className="space-y-3 max-h-60 overflow-y-auto pr-1 mt-6 border-t border-slate-200 dark:border-slate-700 pt-6">
                          {uploads.map((upload) => {
                            const file = selectedFiles.find(f => f.name === upload.fileName);
                            const fileSizeMB = file ? (file.size / (1024 * 1024)).toFixed(2) : 'N/A';
                            return (
                              <div key={upload.fileName} className="p-3.5 border border-slate-200 dark:border-slate-700 rounded-lg flex items-center justify-between space-x-3 bg-white dark:bg-slate-800 shadow-sm">
                                <div className="flex items-center space-x-3 flex-grow min-w-0 overflow-hidden">
                                  <FileText className="w-5 h-5 text-purple-500 dark:text-purple-400 flex-shrink-0" />
                                  <div className="min-w-0 flex-grow">
                                    <p className="text-sm font-medium truncate text-slate-800 dark:text-slate-200" title={upload.fileName}>{upload.fileName}</p>
                                    {upload.status === 'uploading' && <Progress value={upload.progress} className="h-1 mt-1" />}
                                    {upload.status === 'pending' && file && <p className="text-xs text-slate-500 dark:text-slate-400">{fileSizeMB} MB - Pending</p>}
                                    {upload.status === 'success' && <div className="flex items-center text-xs text-green-600 dark:text-green-400 mt-1"><CheckCircle className="w-3 h-3 mr-1" /> Uploaded</div>}
                                    {upload.status === 'error' && <div className="flex items-center text-xs text-red-600 dark:text-red-400 mt-1" title={upload.error}><AlertCircle className="w-3 h-3 mr-1" /> Error {upload.error && <span className="truncate">: {upload.error}</span>}</div>}
                                  </div>
                                </div>
                                {upload.status === 'pending' && !isUploadingGlobal && (
                                   <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-red-500 dark:text-slate-500 dark:hover:text-red-400 flex-shrink-0" onClick={() => removeFile(upload.fileName)} aria-label={`Remove ${upload.fileName}`}><X className="h-4 w-4" /></Button>
                                )}
                                {upload.status === 'uploading' && <Loader2 className="h-4 w-4 animate-spin text-slate-500 flex-shrink-0" />}
                                {upload.status === 'success' && <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400 flex-shrink-0" />}
                                {upload.status === 'error' && <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400 flex-shrink-0" />}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {selectedFiles.length > 0 && uploads.some(u => u.status === 'pending') && (
                        <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.99 }} className="mt-6 flex-shrink-0">
                          <Button onClick={handleUploadAll} disabled={isUploadingGlobal} className="w-full py-3 text-sm font-medium bg-purple-600 hover:bg-purple-700 text-white dark:bg-purple-500 dark:hover:bg-purple-600 focus:ring-2 focus:ring-purple-400 focus:ring-offset-2 dark:focus:ring-offset-slate-900">
                            {isUploadingGlobal ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UploadCloud className="mr-2 h-4 w-4" />}
                            {isUploadingGlobal ? 'Uploading files...' : `Upload ${uploads.filter(u => u.status === 'pending').length} File(s)`}
                          </Button>
                        </motion.div>
                      )}
                      
                      {(uploads.length > 0 || sources.length > 0 || selectedSourceIds.length > 0) && <Separator className="my-8 border-slate-200 dark:border-slate-700" />}

                      {isLoadingSources && <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-6">Loading sources...</p>}
                      {sourcesError && <p className="text-sm text-red-600 dark:text-red-500 text-center py-6">Error: {sourcesError}</p>}
                      
                      {!isLoadingSources && !sourcesError && sources.length > 0 && (
                        <div className="space-y-4">
                          <div className="flex justify-between items-center gap-3 flex-wrap">
                            <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Uploaded Sources ({sources.length})</h3>
                            <div className="flex items-center gap-2">
                              {selectedSourceIds.length > 0 && (
                                <Button 
                                  variant="outline" 
                                  size="sm" 
                                  onClick={handleDeleteSelectedSources} 
                                  disabled={isDeletingSelected || isDeletingAll || isUploadingGlobal} 
                                  className="text-red-600 border-red-300 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:border-red-500/50 dark:hover:bg-red-900/20 dark:hover:text-red-300 focus:ring-red-400"
                                >
                                  <Trash2 className="h-3.5 w-3.5 mr-1.5" /> 
                                  {isDeletingSelected ? "Deleting..." : `Delete Selected (${selectedSourceIds.length})`}
                                </Button>
                              )}
                              <Button 
                                variant="outline" 
                                size="sm" 
                                onClick={handleClearAllSources} 
                                disabled={isDeletingAll || isUploadingGlobal || isDeletingSelected || sources.length === 0} 
                                className="text-red-600 border-red-300 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:border-red-500/50 dark:hover:bg-red-900/20 dark:hover:text-red-300 focus:ring-red-400"
                              >
                                <Trash className="h-3.5 w-3.5 mr-1.5" /> 
                                {isDeletingAll ? "Clearing..." : "Clear All"}
                              </Button>
                            </div>
                          </div>
                          <ScrollArea className="h-[350px] w-full border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800/50">
                            <motion.ul className="space-y-0" variants={listVariants} initial="hidden" animate="visible">
                              {sources.map((source, index) => (
                                <motion.li 
                                  key={source.id} 
                                  className={cn(
                                    "flex justify-between items-center text-sm p-3.5 bg-white dark:bg-transparent hover:bg-slate-50/70 dark:hover:bg-slate-700/40 transition-colors",
                                    index !== sources.length - 1 && "border-b border-slate-200 dark:border-slate-700/70"
                                  )}
                                  variants={itemVariants}
                                >
                                  <div className="flex items-center gap-3 flex-grow min-w-0">
                                    <Checkbox 
                                      id={`select-source-${source.id}`} 
                                      checked={selectedSourceIds.includes(source.id)} 
                                      onCheckedChange={(checked) => handleSourceSelectionChange(source.id, checked)} 
                                      aria-label={`Select ${source.name}`} 
                                      disabled={isDeletingAll || isDeletingSelected || isUploadingGlobal} 
                                      className="data-[state=checked]:bg-purple-600 data-[state=checked]:border-purple-600 dark:data-[state=checked]:bg-purple-500 dark:data-[state=checked]:border-purple-500 focus:ring-purple-500 focus:ring-offset-white dark:focus:ring-offset-slate-800"
                                    />
                                    <FileText className="w-5 h-5 text-purple-500 dark:text-purple-400 flex-shrink-0" />
                                    <label htmlFor={`select-source-${source.id}`} className="flex-grow text-slate-700 dark:text-slate-300 truncate cursor-pointer select-none" title={source.name}>{source.name}</label> 
                                  </div>
                                  <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-red-500 dark:text-slate-500 dark:hover:text-red-400 flex-shrink-0" onClick={() => handleDeleteSingleSource(source.id)} aria-label={`Delete ${source.name}`} disabled={isUploadingGlobal || isDeletingAll || isDeletingSelected}><Trash2 className="h-4 w-4" /></Button>
                                </motion.li>
                              ))}
                            </motion.ul>
                          </ScrollArea>
                        </div>
                      )}
                      {!isLoadingSources && !sourcesError && sources.length === 0 && selectedFiles.length === 0 && (
                        <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-6">No context sources uploaded yet for this project.</p>
                      )}
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="prompt-model-settings" className="mt-0 focus-visible:ring-0 focus-visible:ring-offset-0">
                  <div className="space-y-8 max-w-2xl mx-auto">
                    <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-100 mb-1">
                      Active Prompt & Model Settings
                    </h2>
                     <p className="text-sm text-slate-600 dark:text-slate-400 -mt-7 mb-6">
                      Configure settings for the project: <strong className="font-medium text-slate-700 dark:text-slate-300">{projects.find(p=>p.id === currentProjectId)?.name || 'Unknown Project'}</strong>
                    </p>
                    
                    <div className="space-y-2">
                      <Label htmlFor="project-active-prompt-select" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Active System Prompt</Label>
                      <select 
                        id="project-active-prompt-select"
                        value={formActivePromptKey}
                        onChange={(e) => setFormActivePromptKey(e.target.value)}
                        className="w-full p-2.5 border border-slate-300 dark:border-slate-600 rounded-md shadow-sm disabled:opacity-60 dark:bg-slate-700 focus:border-purple-500 focus:ring-purple-500 text-sm"
                        disabled={isSavingProjectSettings || isLoadingProjectPrompts}
                      >
                        <option value="">-- Use Global/Chat Default --</option>
                        <optgroup label="This Project's Prompts">
                          {isLoadingProjectPrompts && <option disabled>Loading project prompts...</option>}
                          {!isLoadingProjectPrompts && projectCustomPrompts.length === 0 && <option disabled>No prompts created for this project.</option>}
                          {projectCustomPrompts.map(p => (
                            <option key={`project-${p.id}`} value={`project-${p.id}`}>{p.name}</option>
                          ))}
                        </optgroup>
                        <optgroup label="Global Default Prompts">
                          {systemPrompts.map(p => (
                            <option key={`global-${p.name}`} value={`global-${p.name}`}>{p.name}</option>
                          ))}
                        </optgroup>
                      </select>
                      <p className="text-xs text-slate-500 dark:text-slate-400/80 pt-0.5">
                        Select a prompt for this project, or use the global default from the chat interface.
                      </p>
                    </div>

                    <Separator className="my-6 border-slate-200 dark:border-slate-700/60" />

                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <Label htmlFor="project-temperature-slider" className="text-sm font-medium text-slate-700 dark:text-slate-300">Temperature</Label>
                        <span className="text-sm font-medium text-slate-600 dark:text-slate-300 w-12 text-center bg-slate-100 dark:bg-slate-700/80 py-1 rounded-md">{formTemperature.toFixed(1)}</span>
                      </div>
                      <Input 
                        type="range" id="project-temperature-slider" min="0" max="2" step="0.1" 
                        value={formTemperature}
                        onChange={(e) => setFormTemperature(parseFloat(e.target.value))} 
                        className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-purple-600 dark:accent-purple-500 disabled:opacity-60"
                        disabled={isSavingProjectSettings}
                      />
                       <p className="text-xs text-slate-500 dark:text-slate-400/80">
                        Controls randomness. Lower is more focused. Global default: {globalTemperature.toFixed(1)}.
                      </p>
                    </div>
                    
                    <Separator className="my-6 border-slate-200 dark:border-slate-700/60" />

                    <div className="space-y-2">
                      <Label htmlFor="project-max-tokens-input" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Max Response Tokens</Label>
                      <Input 
                        type="number" id="project-max-tokens-input" 
                        value={formMaxTokens} 
                        onChange={(e) => setFormMaxTokens(parseInt(e.target.value, 10))} 
                        min="100" max="16384" step="100" 
                        className="w-full disabled:opacity-60 dark:bg-slate-700 dark:border-slate-600 focus:border-purple-500 focus:ring-purple-500 text-sm"
                        disabled={isSavingProjectSettings}
                      />
                       <p className="text-xs text-slate-500 dark:text-slate-400/80">
                        Max length of the AI's response. Global default: {globalMaxTokens}.
                      </p>
                    </div>

                    <Separator className="my-6 border-slate-200 dark:border-slate-700/60" />
                    <Button onClick={handleSaveProjectSettings} disabled={isSavingProjectSettings || isDeletingProject} className="w-full sm:w-auto bg-purple-600 hover:bg-purple-700 text-white dark:bg-purple-500 dark:hover:bg-purple-600 focus:ring-purple-400 py-2.5">
                      {isSavingProjectSettings ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Save Project Settings
                    </Button>
                    {projectSettingsError && <p className="text-sm text-red-600 dark:text-red-500 mt-2">Error saving: {projectSettingsError}</p>}

                    {/* Delete Project Button - Added Here */} 
                    <div className="mt-10 pt-6 border-t border-dashed border-red-300 dark:border-red-700/50">
                      <h3 className="text-md font-semibold text-red-600 dark:text-red-400 mb-2">Danger Zone</h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                        Deleting a project will permanently remove all its associated data, including uploaded sources and custom prompts. This action cannot be undone.
                      </p>
                      <Button 
                        variant="destructive" 
                        onClick={openDeleteConfirmation} 
                        disabled={isSavingProjectSettings || isDeletingProject || !currentProjectId}
                        className="w-full sm:w-auto"
                      >
                        <Trash className="mr-2 h-4 w-4" />
                        Delete Project: {projects.find(p => p.id === currentProjectId)?.name || ''}
                      </Button>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="manage-prompts" className="mt-0 focus-visible:ring-0 focus-visible:ring-offset-0">
                  <div className="max-w-5xl mx-auto">
                    <div className="space-y-6">
                      <h3 className="text-xl font-semibold text-slate-800 dark:text-slate-100">Custom Prompts for Project: <strong className="font-medium text-slate-700 dark:text-slate-300">{projects.find(p=>p.id === currentProjectId)?.name}</strong></h3>
                      {isLoadingProjectPrompts && <p>Loading prompts...</p>}
                      {projectPromptsError && <p className="text-sm text-red-600 dark:text-red-500">Error: {projectPromptsError}</p>}
                      {!isLoadingProjectPrompts && !projectPromptsError && projectCustomPrompts.length === 0 && (
                        <p className="text-muted-foreground">No custom prompts created for this project yet.</p>
                      )}
                      {!isLoadingProjectPrompts && !projectPromptsError && projectCustomPrompts.length > 0 && (
                        <ScrollArea className="h-[350px] w-full border dark:border-gray-700 rounded-md p-1">
                          <ul className="space-y-1.5 p-2.5">
                            {projectCustomPrompts.map((prompt, index) => (
                              <li key={prompt.id} 
                                  className={cn(
                                    "flex justify-between items-center p-3.5 bg-white dark:bg-transparent hover:bg-slate-50/70 dark:hover:bg-slate-700/40 transition-colors",
                                    index !== projectCustomPrompts.length - 1 && "border-b border-slate-200 dark:border-slate-700/70"
                                  )}
                              >
                                <span className="text-sm text-slate-700 dark:text-slate-300 flex-grow mr-3 truncate" title={prompt.name}>{prompt.name}</span>
                                <div className='flex items-center gap-2'>
                                  <Button variant="outline" size="sm" onClick={() => handleSelectProjectPromptForEditing(prompt)} disabled={isSavingPrompt} className="text-xs px-3 py-1.5">Edit</Button>
                                  <Button variant="ghost" size="icon" onClick={() => handleDeleteProjectPrompt(prompt.id)} disabled={isSavingPrompt} className="h-8 w-8 text-slate-400 hover:text-red-500 dark:text-slate-500 dark:hover:text-red-400"><Trash2 className="h-4 w-4" /></Button>
                                </div>
                              </li>
                            ))}
                          </ul>
                        </ScrollArea>
                      )}
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="create-edit-prompt" className="mt-0 focus-visible:ring-0 focus-visible:ring-offset-0">
                  <div className="space-y-6 max-w-3xl mx-auto">
                    <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-100 pt-0">
                      {editingPrompt ? `Edit Prompt: ${editingPrompt.name}` : `Add New Custom Prompt`}
                    </h2>
                    <div>
                      <Label htmlFor="project-prompt-name" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Prompt Name:</Label>
                      <Input id="project-prompt-name" value={promptFormName} onChange={(e) => setPromptFormName(e.target.value)} placeholder="e.g. Summarize Financial Reports" disabled={isSavingPrompt || isGeneratingAiPrompt} className="dark:bg-slate-700 dark:border-slate-600 focus:border-purple-500 focus:ring-purple-500" />
                    </div>
                    <div className="flex flex-col flex-grow">
                      <Label htmlFor="project-prompt-content" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Prompt Content:</Label>
                      <textarea id="project-prompt-content" value={promptFormContent} onChange={(e) => setPromptFormContent(e.target.value)} rows={12} placeholder="Enter the full system prompt content here..." className="block w-full p-3 border border-slate-300 dark:border-slate-600 rounded-md min-h-[250px] dark:bg-slate-700 focus:border-purple-500 focus:ring-purple-500 text-sm" disabled={isSavingPrompt || isGeneratingAiPrompt} />
                      {aiGenerationError && (<p className="mt-1.5 text-xs text-red-500 dark:text-red-400">An error occurred: {aiGenerationError}</p>)}
                    </div>
                    <div className="flex flex-wrap gap-3 pt-2 items-center border-t border-slate-200 dark:border-slate-700/60 pt-6">
                      <Button onClick={handleAddOrUpdateProjectPrompt} disabled={isSavingPrompt || !promptFormName.trim() || !promptFormContent.trim() || isGeneratingAiPrompt} className="bg-purple-600 hover:bg-purple-700 text-white dark:bg-purple-500 dark:hover:bg-purple-600 focus:ring-purple-400">
                        {isSavingPrompt ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        {editingPrompt ? 'Save Prompt Changes' : 'Create Custom Prompt'}
                      </Button>
                      <Button onClick={handleGenerateWithAiForProjectPrompt} disabled={isSavingPrompt || isGeneratingAiPrompt} variant="outline" className="text-sm">
                        {isGeneratingAiPrompt ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : null}
                        {(!promptFormContent.trim() && !editingPrompt) ? 'Start with Boilerplate' : 'Refine with AI'}
                      </Button>
                       {editingPrompt && (
                        <Button variant="ghost" onClick={handleCancelProjectPromptEdit} disabled={isSavingPrompt} className="text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200">Cancel</Button>
                      )}
                    </div>
                  </div>
                </TabsContent>
              </>
            ) : (
              <div className="text-center text-muted-foreground py-12">
                <p className="text-lg mb-2">No project is currently active in the chat interface.</p>
                <p>Please select a project in the chat interface before configuring settings.</p>
                <SettingsIcon className="w-12 h-12 mx-auto text-gray-300 dark:text-gray-600 mt-4" />
              </div>
            )}
          </div>
        </Tabs>

        {/* Confirmation Dialog for Project Deletion */} 
        {projectToDelete && (
          <Dialog open={isDeleteConfirmOpen} onOpenChange={(open) => {if (!isDeletingProject) setIsDeleteConfirmOpen(open);}}>
            <DialogContent onInteractOutside={(e) => {if(isDeletingProject) e.preventDefault();}}>
              <DialogHeader>
                <DialogTitle className="text-lg font-medium text-red-600 dark:text-red-400">Confirm Project Deletion</DialogTitle>
                <DialogDescription className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                  Are you sure you want to delete the project "<strong className='text-slate-800 dark:text-slate-200'>{projectToDelete.name}</strong>"?
                  <br />
                  All associated data (prompts, settings, and indexed documents) will be permanently removed. 
                  <strong className='text-red-500 dark:text-red-400'>This action cannot be undone.</strong>
                </DialogDescription>
              </DialogHeader>
              {deleteProjectError && (
                <p className="my-3 text-sm text-red-600 bg-red-50 dark:bg-red-900/30 p-3 rounded-md">Error: {deleteProjectError}</p>
              )}
              <div className="mt-5 sm:mt-6 flex flex-col sm:flex-row-reverse gap-3">
                <Button
                  variant="destructive"
                  onClick={handleDeleteProject}
                  disabled={isDeletingProject}
                  className="w-full sm:w-auto"
                >
                  {isDeletingProject ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                  Yes, Delete Project
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {if (!isDeletingProject) setIsDeleteConfirmOpen(false);}}
                  disabled={isDeletingProject}
                  className="w-full sm:w-auto"
                >
                  Cancel
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        )}

      </DialogContent>
    </Dialog>
  );
};

export default SettingsDialog; 