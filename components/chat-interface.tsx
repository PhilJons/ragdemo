"use client";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useChat, type Message } from "ai/react";
import { useRef, useEffect, useState, useCallback } from "react";
import { Moon, Send, Sun, X, Settings } from "lucide-react";
import { useTheme } from "next-themes";
import MessageContainer from "./message-container";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import ChatInput from "./chat-input";
import { ImperativePanelHandle } from "react-resizable-panels";
import { useMediaQuery } from 'react-responsive';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription, DrawerFooter } from '@/components/ui/drawer';
import SettingsDialog from "./settings-dialog";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Custom components for Markdown rendering
const MarkdownComponents = {
  // Handle links properly
  a: (props: any) => (
    <a 
      {...props} 
      target="_blank" 
      rel="noopener noreferrer" 
      className="text-blue-600 dark:text-blue-400 hover:underline"
      style={{ color: 'inherit' }}
    />
  ),
  // Style code blocks
  code: ({ node, inline, className, children, ...props }: any) => {
    const match = /language-(\w+)/.exec(className || "");
    return !inline && match ? (
      <pre className="p-2 rounded bg-gray-100 dark:bg-gray-800 overflow-x-auto" style={{ color: 'inherit' }}>
        <code className={className} {...props} style={{ color: 'inherit' }}>{children}</code>
      </pre>
    ) : (
      <code
        className={
          inline
            ? "px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-sm"
            : "block p-2 rounded bg-gray-100 dark:bg-gray-800 overflow-x-auto"
        }
        {...props}
        style={{ color: 'inherit' }}
      >
        {children}
      </code>
    );
  },
  // Style blockquotes
  blockquote: (props: any) => (
    <blockquote
      className="pl-4 border-l-4 border-gray-300 dark:border-gray-500 italic text-gray-800 dark:text-gray-100"
      style={{ color: 'inherit' }}
      {...props}
    />
  ),
  // Enhanced table styling
  table: (props: any) => (
    <div className="overflow-x-auto my-4">
      <table className="min-w-full border-collapse" {...props} />
    </div>
  ),
  th: (props: any) => (
    // Keep light background and dark text always for headers
    <th className="bg-gray-100 text-gray-900 border border-gray-300 dark:border-gray-600 px-4 py-2 text-left font-semibold" {...props} />
  ),
  td: (props: any) => (
    // Ensure proper contrast in both light and dark modes
    <td 
      className="border border-gray-300 dark:border-gray-600 px-4 py-2 text-gray-900 dark:text-white" 
      style={{ color: 'inherit' }} 
      {...props} 
    />
  ),
  // Add paragraph styling
  p: (props: any) => <p style={{ color: 'inherit' }} {...props} />,
  // Add heading styling
  h1: (props: any) => (
    <h1 className="font-bold text-xl mt-6 mb-4" style={{ color: 'inherit' }} {...props} />
  ),
  h2: (props: any) => (
    <h2 className="font-bold text-lg mt-5 mb-3" style={{ color: 'inherit' }} {...props} />
  ),
  h3: (props: any) => (
    <h3 className="font-bold text-md mt-4 mb-2" style={{ color: 'inherit' }} {...props} />
  ),
  // Add list styling
  ul: (props: any) => (
    <ul className="list-disc pl-5 my-2" style={{ color: 'inherit' }} {...props} />
  ),
  ol: (props: any) => (
    <ol className="list-decimal pl-5 my-2" style={{ color: 'inherit' }} {...props} />
  ),
  li: (props: any) => (
    <li className="my-1" style={{ color: 'inherit' }} {...props} />
  ),
};

const ThemeChanger = () => {
  const [mounted, setMounted] = useState(false);
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return null;
  }

  return (
    <div className="flex items-center space-x-2">
      <Sun className="h-[1.2rem] w-[1.2rem]" />
      <Switch
        checked={theme === "dark"}
        onCheckedChange={() => setTheme(theme === "dark" ? "light" : "dark")}
        aria-label="Toggle dark mode"
        className="data-[state=checked]:bg-muted-foreground data-[state=unchecked]:bg-muted-foreground"
      />
      <Moon className="h-[1.2rem] w-[1.2rem]" />
      <span className="sr-only">Toggle dark mode</span>
    </div>
  );
};

export default function ChatInterface() {
  const isLargeScreen = useMediaQuery({ minWidth: 768 });
  const [toolCall, setToolCall] = useState<string>();
  const [error, setError] = useState<string | null>(null);
  const [documentMap, setDocumentMap] = useState<Record<string, { text: string; sourcefile: string }>>({});
  const [currentCitation, setCurrentCitation] = useState<string | null>(null);
  const [isCitationShown, setIsCitationShown] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const { 
    messages, 
    input, 
    handleInputChange, 
    handleSubmit, 
    isLoading, 
    data
  } = useChat({
    onError: (error: any) => {
      console.error("API Error:", error); // Log the error
      let errorMessage = "An unexpected error occurred.";
      
      try {
        if (error.message) {
          // Try to parse the error message if it's JSON
          const parsedError = JSON.parse(error.message);
          errorMessage = parsedError?.error || errorMessage;
        } else if (error.toString) {
          // Fallback to toString
          errorMessage = error.toString();
        }
      } catch (parseError) {
        // If JSON parsing fails, use the raw message
        errorMessage = error.message || errorMessage;
      }
      
      setError(errorMessage);
    },
  });
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const citationPanelRef = useRef<ImperativePanelHandle>(null);

  // expand the right panel when a citation is selected
  useEffect(() => {
    if (currentCitation) {
      citationPanelRef.current?.expand();
    } else {
      citationPanelRef.current?.collapse();
    }
  }, [currentCitation]);

  // Process source documents from the data stream
  useEffect(() => {
    if (data && Array.isArray(data)) {
      console.log("Processing data stream:", JSON.stringify(data));
      const newDocumentMap: Record<string, { text: string; sourcefile: string }> = {};
      let foundDocs = false;

      // Iterate through all data entries and accumulate sourceDocuments
      data.forEach(item => {
        if (typeof item === 'object' && item !== null && !Array.isArray(item) && item.hasOwnProperty('sourceDocuments') && Array.isArray(item.sourceDocuments)) {
          (item.sourceDocuments as any[]).forEach((doc: any) => {
            if (doc && doc.id && doc.text) {
              newDocumentMap[doc.id] = { text: doc.text, sourcefile: doc.sourcefile };
              foundDocs = true;
            }
          });
        }
      });

      if (foundDocs) {
        console.log("Updating documentMap from accumulated data stream entries:", newDocumentMap);
        // Use functional update to ensure we have the latest state
        setDocumentMap(prevMap => {
          const updatedMap = { ...prevMap, ...newDocumentMap };
          console.log('Document map state AFTER update:', updatedMap);
          return updatedMap;
        });
      } else {
        console.log("No sourceDocuments found in any data stream entries.");
      }
    }
  }, [data]);

  // Scroll handler to update isAtBottom state
  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (container) {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const atBottom = scrollHeight - scrollTop - clientHeight < 10; // Threshold of 10px
      setIsAtBottom(atBottom);
    }
  }, []);

  // Auto scroll to bottom only if user is already near the bottom
  useEffect(() => {
    if (isAtBottom) {
      messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
    }
  }, [messages, isAtBottom]); // Depend on messages AND isAtBottom

  const handleSubmitWithErrorReset = (event: React.FormEvent) => {
    setError(null);
    handleSubmit(event);
  };

  const showCitation = (id: string) => {
    const citationText = documentMap[id]?.text || null;
    setCurrentCitation(citationText);
    setIsCitationShown(true);
  };

  const closeDrawer = () => {
    setIsCitationShown(false);
    setCurrentCitation(null);
  };

  // Format structured data as markdown table
  const formatCitationAsMarkdown = (dataText: string): string => {
    if (!dataText) return '';
    
    // Helper function to properly parse CSV rows, handling quoted fields with commas
    const parseCSVRow = (row: string, expectedColumns: number): string[] => {
      // More robust implementation for CSV parsing
      const result: string[] = [];
      let currentValue = "";
      let insideQuotes = false;
      
      // First pass - handle quoted fields properly
      for (let i = 0; i < row.length; i++) {
        const char = row[i];
        
        if (char === '"') {
          // Toggle inside quotes state
          insideQuotes = !insideQuotes;
        } else if (char === ',' && !insideQuotes) {
          // End of cell
          result.push(currentValue.trim());
          currentValue = "";
        } else {
          // Add character to current value
          currentValue += char;
        }
      }
      
      // Add the last cell
      result.push(currentValue.trim());
      
      // Handle ambiguous cases - improve parsing for project management data
      if (result.length > 0) {
        // Check if this looks like a project management row (has numeric ID, Story/Epic type)
        const hasNumericId = /^\d+$/.test(result[0]);
        const hasTypeField = result.length > 1 && (result[1] === "Story" || result[1] === "Epic");
        
        if (hasNumericId && hasTypeField) {
          // This is likely a project management row - if we need more columns, try to infer
          // where the split should be based on context
          const expectedFieldCount = Math.max(6, expectedColumns); // Expect at least ID, Type, Summary, Description, Priority
          
          if (result.length < expectedFieldCount) {
            // We may need to split some fields that should have been quoted but weren't
            // Especially description fields that might contain commas
            for (let i = 2; i < result.length; i++) { // Start after ID and Type
              const cell = result[i];
              
              // Look for common patterns that indicate a field should be split
              // For example, a description ending with a likely transition to a priority field
              const priorityMatch = cell.match(/(.*)\s+(High|Medium|Low)$/i);
              const phaseMatch = cell.match(/(.*)\s+(Phase\s+\d+)$/i);
              
              if (priorityMatch && result.length < expectedFieldCount) {
                // This cell likely contains a description and a priority - split it
                result[i] = priorityMatch[1].trim();
                result.splice(i + 1, 0, priorityMatch[2].trim());
              } else if (phaseMatch && result.length < expectedFieldCount) {
                // This cell likely contains a description and a phase - split it
                result[i] = phaseMatch[1].trim();
                result.splice(i + 1, 0, phaseMatch[2].trim());
              }
            }
          }
        }
      }
      
      // Make sure we have the expected number of columns
      while (result.length < expectedColumns) {
        result.push('');
      }
      
      return result;
    };
    
    // Special case: Check if this looks like the roadmap/spreadsheet data format
    // Look for common column headers in project management tools
    if (dataText.includes("ID") && 
        (dataText.includes("Issue Type") || 
         dataText.includes("Summary") || 
         dataText.includes("Priority"))) {
      try {
        // This appears to be roadmap CSV data with standard column headers
        // First, let's split by newlines to get rows
        const rows = dataText.split(/\n/).filter(row => row.trim().length > 0);

        if (rows.length === 0) {
          return '```\n' + dataText + '\n```';
        }

        // First row is always the header for this format
        const headerRow = rows[0];
        const headerCells = headerRow.split(',').map(cell => cell.trim());
        
        // Known header structures for our project management data
        const knownHeaderStructures = [
          ["ID", "Issue Type", "Summary", "Description", "Priority", "Phase", "Sprint"],
          ["ID", "Type", "Summary", "Description", "Priority", "Phase", "Sprint"]
        ];
        
        // Check if our header is similar to a known structure
        const normalizedHeaders = headerCells.map(h => h.toLowerCase());
        const matchesKnownStructure = knownHeaderStructures.some(structure => {
          const normalizedStructure = structure.map(h => h.toLowerCase());
          return normalizedStructure.every(header => normalizedHeaders.includes(header));
        });
        
        if (matchesKnownStructure) {
          // Create the markdown table with proper headers
          let markdownTable = `| ${headerCells.join(' | ')} |\n| ${headerCells.map(() => '---').join(' | ')} |\n`;
          
          // Process data rows - start from index 1 (skip header)
          for (let i = 1; i < rows.length; i++) {
            // Special parsing to handle quoted content with commas
            const rowData = parseCSVRow(rows[i], headerCells.length);
            
            // Escape any pipe characters in the cells
            const escapedData = rowData.map(cell => cell.replace(/\|/g, '\\|'));
            markdownTable += `| ${escapedData.join(' | ')} |\n`;
          }
          
          return markdownTable;
        }
      } catch (e) {
        console.error("Error formatting roadmap CSV data as markdown table:", e);
        return '```\n' + dataText + '\n```';
      }
    }
    
    // NEW CASE: Look for fragments of project management data without proper headers
    // These often have story IDs, types and descriptions but with generic column headers
    if ((dataText.includes("Story") || dataText.includes("Epic")) &&
        (dataText.includes("Column 1") || dataText.includes("Column 2") || dataText.includes("Column 3")) &&
        /\d{2,}/.test(dataText)) { // Contains numbers that look like IDs (2+ digits)
      try {
        // This appears to be a fragment of project management data
        const rows = dataText.split(/\n/).filter(row => row.trim().length > 0);
        
        if (rows.length === 0) {
          return '```\n' + dataText + '\n```';
        }
        
        // First attempt to detect if there are headers like "Column 1", "Column 2"
        const headerRow = rows[0];
        let headerCells: string[] = [];
        
        if (headerRow.includes("Column")) {
          headerCells = headerRow.split(',').map(cell => cell.trim());
          
          // If we have generic Column headers, directly map them to standard project columns
          // This is a more direct approach than analyzing the data
          const standardHeaders = ["ID", "Issue Type", "Summary", "Description", "Priority", "Phase", "Sprint", "Component", "Project Name", "Project Key"];
          
          const improvedHeaders = headerCells.map((header, index) => {
            if (header.match(/Column\s+\d+/i) && index < standardHeaders.length) {
              return standardHeaders[index];
            }
            return header;
          });
          
          // Create the markdown table with improved headers
          let markdownTable = `| ${improvedHeaders.join(' | ')} |\n| ${improvedHeaders.map(() => '---').join(' | ')} |\n`;
          
          // Process data rows
          for (let i = 1; i < rows.length; i++) {
            // Parse row with special handling for project management data
            const rawRowData = parseCSVRow(rows[i], headerCells.length);
            
            // Format description columns consistently
            const formattedRowData = rawRowData.map((cell, idx) => {
              // For description columns, ensure quotes are handled properly
              if (improvedHeaders[idx] === "Description" && cell.startsWith('"') && cell.endsWith('"')) {
                return cell.substring(1, cell.length - 1); // Remove surrounding quotes
              }
              return cell;
            });
            
            // Escape pipe characters in cells
            const escapedData = formattedRowData.map(cell => (cell || '').replace(/\|/g, '\\|'));
            markdownTable += `| ${escapedData.join(' | ')} |\n`;
          }
          
          return markdownTable;
        }
        
        // If we can't detect generic column headers, try to infer the structure
        // This handles cases where the CSV fragment has no header row at all
        const firstRowCells = parseCSVRow(rows[0], 0);
        
        // Determine if this is a legitimate data row by looking for story/epic types
        const isDataRow = firstRowCells.some(cell => 
          cell === "Story" || cell === "Epic" || /^\d+$/.test(cell));
        
        if (isDataRow) {
          // Create sensible headers based on typical project management columns
          const inferredHeaders = [];
          for (let i = 0; i < firstRowCells.length; i++) {
            if (i === 0) inferredHeaders.push("ID");
            else if (i === 1) inferredHeaders.push("Issue Type");
            else if (i === 2) inferredHeaders.push("Summary");
            else if (i === 3) inferredHeaders.push("Description");
            else if (i === 4) inferredHeaders.push("Priority");
            else if (i === 5) inferredHeaders.push("Status");
            else inferredHeaders.push(`Field ${i+1}`);
          }
          
          // Create the markdown table with inferred headers
          let markdownTable = `| ${inferredHeaders.join(' | ')} |\n| ${inferredHeaders.map(() => '---').join(' | ')} |\n`;
          
          // Process all rows as data rows
          for (let i = 0; i < rows.length; i++) {
            const rowData = parseCSVRow(rows[i], inferredHeaders.length);
            
            // Escape any pipe characters in the cells
            const escapedData = rowData.map(cell => cell.replace(/\|/g, '\\|'));
            markdownTable += `| ${escapedData.join(' | ')} |\n`;
          }
          
          return markdownTable;
        }
      } catch (e) {
        console.error("Error formatting partial project data as markdown table:", e);
        return '```\n' + dataText + '\n```';
      }
    }
    
    // Regular CSV detection with Phase, SYNCA pattern
    if (dataText.includes(",Phase") && dataText.includes(",SYNCA")) {
      try {
        // This appears to be the Synca Platform CSV data
        // First, let's split by newlines to get rows
        const rows = dataText.split(/\n/).filter(row => row.trim().length > 0);

        if (rows.length === 0) {
          return '```\n' + dataText + '\n```';
        }

        // Check if we have a header row
        let headerRow = '';
        let headerCells: string[] = [];
        
        // Look for recognizable header patterns
        if (rows[0].includes("ID,") || 
            rows[0].includes("Phase,") || 
            rows[0].includes("Sprint,") ||
            rows[0].includes("Epic Name,")) {
          headerRow = rows[0];
          headerCells = headerRow.split(',').map(cell => cell.trim());
        } else {
          // If no header detected, create a generic one based on number of columns
          const firstRowCells = rows[0].split(',');
          headerCells = firstRowCells.map((_, i) => `Column ${i+1}`);
        }

        // Create the markdown table
        let markdownTable = `| ${headerCells.join(' | ')} |\n| ${headerCells.map(() => '---').join(' | ')} |\n`;

        // Process data rows - start from index 1 if we found a header, otherwise from 0
        const startIndex = headerRow ? 1 : 0;
        
        for (let i = startIndex; i < rows.length; i++) {
          const rowData = rows[i].split(',').map(cell => cell.trim());
          // Make sure we have the right number of cells (match header count)
          while (rowData.length < headerCells.length) {
            rowData.push(''); // Pad with empty cells if needed
          }
          // Escape any pipe characters in the cells
          const escapedData = rowData.map(cell => cell.replace(/\|/g, '\\|'));
          markdownTable += `| ${escapedData.join(' | ')} |\n`;
        }

        return markdownTable;
      } catch (e) {
        console.error("Error formatting CSV data as markdown table:", e);
        return '```\n' + dataText + '\n```';
      }
    }
    
    // Check if data looks like our citation details format (comma-separated with multiple phases)
    if (dataText.includes("Platform,SYNCA") && dataText.includes("Phase")) {
      try {
        // For our specific citation details format that looks like a more complex structure
        // Parse it into a two-column format for readability

        // First clean up the data by normalizing line breaks and spaces
        const cleanedText = dataText.replace(/\s+/g, ' ').trim();
        
        // Split into logical entries by phase pattern
        const entries = cleanedText.split(/(?=Phase \d+)/g)
                             .map(entry => entry.trim())
                             .filter(entry => entry.length > 0);
        
        if (entries.length === 0) {
          // Try another approach - split by unique ID patterns
          const idEntries = cleanedText.split(/(?=\d+,\w+,)/g)
                                    .map(entry => entry.trim())
                                    .filter(entry => entry.length > 0);
          
          if (idEntries.length > 0) {
            // Create a table for the ID-based entries
            const headerString = '| ID | Type | Description | Details |';
            const separatorString = '| --- | --- | --- | --- |';
            
            // Process each entry into a table row
            const rows = idEntries.map(entry => {
              const parts = entry.split(',').map(part => part.trim());
              if (parts.length >= 3) {
                // Escape any pipe characters
                const escapedParts = parts.map(part => part.replace(/\|/g, '\\|'));
                const [id, type, description, ...rest] = escapedParts;
                return `| ${id} | ${type} | ${description} | ${rest.join(', ')} |`;
              } else {
                return `| ${entry.replace(/\|/g, '\\|')} | | | |`;
              }
            });
            
            return `${headerString}\n${separatorString}\n${rows.join('\n')}`;
          }
          
          return '```\n' + dataText + '\n```'; // No valid entries found
        }
        
        // Create a table with two columns: Feature and Description
        const headerString = '| Feature | Description |';
        const separatorString = '| --- | --- |';
        
        // Process each entry into a table row
        const rows = entries.map(entry => {
          // Clean up the entry and remove SYNCA IDs
          const cleanedEntry = entry.replace(/,SYNCA\s+\d+/g, ',SYNCA');
          
          // Split into key and value at the first comma if possible
          const firstCommaIndex = cleanedEntry.indexOf(',');
          if (firstCommaIndex > 0) {
            const key = cleanedEntry.substring(0, firstCommaIndex).trim();
            const value = cleanedEntry.substring(firstCommaIndex + 1).trim();
            // Escape any pipe characters
            const escapedKey = key.replace(/\|/g, '\\|');
            const escapedValue = value.replace(/\|/g, '\\|');
            return `| ${escapedKey} | ${escapedValue} |`;
          } else {
            // Fallback if we can't split properly
            return `| ${cleanedEntry.replace(/\|/g, '\\|')} | |`;
          }
        });
        
        return `${headerString}\n${separatorString}\n${rows.join('\n')}`;
      } catch (e) {
        console.error("Error formatting citation as markdown:", e);
        return '```\n' + dataText + '\n```';
      }
    }
    
    // If not our special format, return as is
    return dataText;
  };

  return (
    <>
      <ResizablePanelGroup direction="horizontal">
        <ResizablePanel id="chat-panel">
          <div className="flex flex-col min-w-0 h-screen bg-background">
            <div className="flex flex-row justify-between items-center p-4">
              <div className="flex items-center space-x-4">
                <ThemeChanger />
                <Button variant="ghost" size="icon" onClick={() => setIsSettingsOpen(true)}>
                  <Settings className="h-[1.2rem] w-[1.2rem]" />
                  <span className="sr-only">Settings</span>
                </Button>
              </div>
            </div>
            <div className="text-center mb-4 md:mb-8">
              <h1 className="text-2xl font-bold mb-2">Secure RAG Demo</h1>
              <p className="text-sm text-muted-foreground">
                Explore Retrieval-Augmented Generation hosted securely on Azure. Manage data sources via the Settings panel (⚙️) in the top left.
              </p>
            </div>

            <MessageContainer
              messages={messages}
              error={error}
              toolCall={toolCall}
              isLoading={isLoading}
              showCitation={showCitation}
              messagesEndRef={messagesEndRef}
              documentMap={documentMap}
              scrollContainerRef={scrollContainerRef}
              onScroll={handleScroll}
            />

            <ChatInput 
              input={input} 
              onInputChange={handleInputChange} 
              onSubmit={handleSubmitWithErrorReset}
              isLoading={isLoading}
            />
          </div>
        </ResizablePanel>
        {isLargeScreen && isCitationShown && <ResizableHandle withHandle />}
        {isLargeScreen && isCitationShown && (
          <ResizablePanel id="citation-panel" collapsible collapsedSize={0} ref={citationPanelRef} defaultSize={25} className="overflow-y-scroll h-screen">
            <div className="flex justify-between items-center p-4">
              <h3 className="font-bold">Citation Details:</h3>
              <button 
                onClick={closeDrawer}
                className="text-muted-foreground hover:text-primary transition-colors"
                aria-label="Close"
              >
                <X />
              </button>
            </div>
            <div className="p-4">
              {currentCitation ? (
                <div className="prose prose-sm max-w-none text-foreground dark:text-gray-100">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={MarkdownComponents}>
                    {formatCitationAsMarkdown(currentCitation)}
                  </ReactMarkdown>
                </div>
              ) : (
                <p className="text-foreground dark:text-gray-100">Select a citation to view details</p>
              )}
            </div>
          </ResizablePanel>
        )}
      </ResizablePanelGroup>

      <Drawer open={!isLargeScreen && isCitationShown} onOpenChange={closeDrawer}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Citation Details</DrawerTitle>
            <DrawerDescription className="h-[50vh] overflow-y-auto">
              {currentCitation ? (
                <div className="prose prose-sm max-w-none text-foreground dark:text-gray-100">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={MarkdownComponents}>
                    {formatCitationAsMarkdown(currentCitation)}
                  </ReactMarkdown>
                </div>
              ) : (
                <span className="text-foreground dark:text-gray-100">No citation selected.</span>
              )}
            </DrawerDescription>
          </DrawerHeader>
          <DrawerFooter>
            <Button onClick={closeDrawer}>Close</Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      <SettingsDialog isOpen={isSettingsOpen} onOpenChange={setIsSettingsOpen} />

    </>
  );
}
