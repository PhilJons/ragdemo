'use client';

import { useState } from 'react';
import ReactMarkdown from 'react-markdown'; // Import react-markdown
import remarkGfm from 'remark-gfm'; // Import GFM plugin

// Custom components for Markdown rendering
const MarkdownComponents = {
  // Handle links properly
  a: (props: any) => (
    <a 
      {...props} 
      target="_blank" 
      rel="noopener noreferrer" 
      className="text-blue-600 dark:text-blue-400 hover:underline"
    />
  ),
  // Style code blocks
  code: ({ node, inline, className, children, ...props }: any) => {
    const match = /language-(\w+)/.exec(className || "");
    return !inline && match ? (
      <pre className="p-2 rounded bg-gray-100 dark:bg-gray-800 overflow-x-auto">
        <code className={className} {...props}>
          {children}
        </code>
      </pre>
    ) : (
      <code
        className={
          inline
            ? "px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-sm"
            : "block p-2 rounded bg-gray-100 dark:bg-gray-800 overflow-x-auto"
        }
        {...props}
      >
        {children}
      </code>
    );
  },
  // Style blockquotes
  blockquote: (props: any) => (
    <blockquote
      className="pl-4 border-l-4 border-gray-300 dark:border-gray-700 italic"
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
    <th className="bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 px-4 py-2 text-left" {...props} />
  ),
  td: (props: any) => (
    <td className="border border-gray-300 dark:border-gray-700 px-4 py-2" {...props} />
  ),
};

// Define the expected shape of a citation object
interface Citation {
  id: string;
  text: string;
  sourcefile: string;
  // Add other properties if they exist, e.g., similarity score
}

export default function ChatCitations({
  selectedCitation, 
  onClose 
}: {
  selectedCitation: Citation | null; 
  onClose: () => void; 
}) {

  // --- Structured Data Parsing Helper ---
  const formatStructuredDataAsMarkdownTable = (dataText: string): string => {
    if (!dataText) return ''; // Handle empty input

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
            // Use our enhanced parseCSVRow function to handle quoted fields and commas properly
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
            // Use our enhanced parseCSVRow function to handle quoted fields and commas properly
            const rowData = parseCSVRow(rows[i], headerCells.length);
            
            // Format description columns consistently
            const formattedRowData = rowData.map((cell, idx) => {
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
        
        // If column detection failed, try our advanced grouping logic...
        // Continue with existing advanced column type detection code
        
        // We've detected generic column headers
        // Now analyze the data to determine what's actually in each column
        
        // Process all rows to understand the pattern
        const dataRows = rows.slice(1);
        const columnContents: string[][] = headerCells.map(() => []);
        
        // Check each row to determine what kind of data is in each column
        dataRows.forEach(row => {
          const cellsInRow = parseCSVRow(row, headerCells.length);
          cellsInRow.forEach((cell, colIndex) => {
            if (colIndex < columnContents.length && cell.trim()) {
              columnContents[colIndex].push(cell.trim());
            }
          });
        });
        
        // Analyze column contents to infer what they contain
        const columnTypes = columnContents.map((cells, colIndex) => {
          const allCells = cells.join(" ").toLowerCase();
          
          // Check for known column types based on content analysis
          if (cells.some(c => /^\d+$/.test(c)) && colIndex === 0) return "ID";
          if (allCells.includes("epic") || allCells.includes("story")) return "Issue Type";
          
          // Find Summary column - typically the column with substantial text after ID and Type
          if (colIndex >= 2 && cells.some(c => c.length > 10)) {
            // Is this likely a Summary or a Description?
            const avgLength = cells.reduce((sum, text) => sum + text.length, 0) / cells.length;
            if (avgLength < 60) return "Summary"; // Shorter text likely Summary
          }
          
          // Description detection - longer text often in columns 3+ or after Summary
          if (colIndex >= 3 || cells.some(c => c.includes('"'))) {
            const avgLength = cells.reduce((sum, text) => sum + text.length, 0) / cells.length;
            if (avgLength > 20) return "Description";
          }
          
          // Additional column type detection
          if (allCells.includes("high") || allCells.includes("medium") || allCells.includes("low")) return "Priority";
          if (allCells.match(/phase\s+\d+/)) return "Phase"; 
          if (allCells.match(/sprint\s+\d+/)) return "Sprint";
          if (allCells.includes("synca") && allCells.includes("platform")) return "Project Name";
          
          return null; // Unknown column type
        });
        
        // Group adjacent columns by type to find description columns that should be merged
        const columnGroups: {type: string | null, indices: number[]}[] = [];
        let currentGroup: {type: string | null, indices: number[]} | null = null;
        
        columnTypes.forEach((type, index) => {
          // Start a new group if this is a different type
          if (!currentGroup || currentGroup.type !== type) {
            // Close previous group if it exists
            if (currentGroup) {
              columnGroups.push(currentGroup);
            }
            // Start new group
            currentGroup = { type, indices: [index] };
          } else {
            // Add to existing group of the same type
            currentGroup.indices.push(index);
          }
        });
        
        // Don't forget the last group
        if (currentGroup) {
          columnGroups.push(currentGroup);
        }
        
        // Now create improved headers based on our analysis and grouping
        const finalHeaderMapping: {[index: number]: string} = {};
        const finalColumnIndices: number[] = [];
        
        columnGroups.forEach(group => {
          // For each group, we'll keep only the first column index in finalColumnIndices
          // and map it to an appropriate header
          if (group.indices.length > 0) {
            const firstIndex = group.indices[0];
            finalColumnIndices.push(firstIndex);
            
            // Assign a meaningful header based on the group type
            if (group.type) {
              finalHeaderMapping[firstIndex] = group.type;
            } else {
              // Standard fallbacks for unknown columns based on position
              if (firstIndex === 0) finalHeaderMapping[firstIndex] = "ID";
              else if (firstIndex === 1) finalHeaderMapping[firstIndex] = "Issue Type";
              else if (firstIndex === 2) finalHeaderMapping[firstIndex] = "Summary";
              else if (firstIndex === 3) finalHeaderMapping[firstIndex] = "Description";
              else if (firstIndex === 4) finalHeaderMapping[firstIndex] = "Priority";
              else if (firstIndex === 5) finalHeaderMapping[firstIndex] = "Phase";
              else finalHeaderMapping[firstIndex] = headerCells[firstIndex];
            }
          }
        });
        
        // Create the final headers array from our mapping
        const finalHeaders = finalColumnIndices.map(idx => finalHeaderMapping[idx] || headerCells[idx]);
        
        // Create the markdown table with improved headers
        let markdownTable = `| ${finalHeaders.join(' | ')} |\n| ${finalHeaders.map(() => '---').join(' | ')} |\n`;
        
        // Process data rows, combining columns that belong to the same group
        for (let i = 1; i < rows.length; i++) {
          // Use our enhanced parseCSVRow function to handle quoted fields and commas properly
          const rowData = parseCSVRow(rows[i], headerCells.length);
          const finalRowData = [];
          
          // Process each column group
          columnGroups.forEach(group => {
            if (group.indices.length > 0) {
              const firstIndex = group.indices[0];
              
              if (group.indices.length === 1) {
                // Single column - use as is
                finalRowData.push(rowData[firstIndex] || '');
              } else {
                // Multiple columns to merge
                const combinedContent = group.indices
                  .map(idx => rowData[idx])
                  .filter(content => content && content.trim())
                  .join(' ');
                
                finalRowData.push(combinedContent || '');
              }
            }
          });
          
          // Ensure we have the right number of cells
          while (finalRowData.length < finalHeaders.length) {
            finalRowData.push('');
          }
          
          // Escape any pipe characters in the cells
          const escapedData = finalRowData.map(cell => (cell || '').replace(/\|/g, '\\|'));
          markdownTable += `| ${escapedData.join(' | ')} |\n`;
        }
        
        return markdownTable;
      } catch (e) {
        console.error("Error formatting partial project data as markdown table:", e);
        return '```\n' + dataText + '\n```';
      }
    }

    // Regular CSV detection with Phase, SYNCA pattern (existing code)
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
          // Use our enhanced parseCSVRow instead of simple split to properly handle commas in fields
          const rowData = parseCSVRow(rows[i], headerCells.length);
          
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
        
        // Combine to make the final table
        return `${headerString}\n${separatorString}\n${rows.join('\n')}`;
      } catch (e) {
        console.error("Error formatting Citation Details as Markdown table:", e);
        // Fallback to preformatted text on error
        return '```\n' + dataText + '\n```';
      }
    }

    // Original fallback code for other formats
    const potentialRowDelimiter = '; ; ;'; 
    const potentialCellDelimiter = ',';

    // Basic check if it looks like the structured format
    if (!dataText.includes(potentialRowDelimiter) || !dataText.includes(potentialCellDelimiter)) {
      // Fallback for non-matching or simple text: render as code block
      return '```\n' + dataText + '\n```';
    }

    try {
      // Split by row delimiter, trim whitespace, and filter empty lines
      const rowsRaw = dataText.split(potentialRowDelimiter)
                              .map(row => row.trim())
                              .filter(row => row.length > 0);

      if (rowsRaw.length < 1) {
        return '```\n' + dataText + '\n```'; // Not enough data
      }

      // Assume first part is the header
      const header = rowsRaw[0].split(potentialCellDelimiter).map(h => h.trim());
      if (header.length < 1) {
        return '```\n' + dataText + '\n```'; // Invalid header
      }
      // Create Markdown table separator based on header length
      const separator = header.map(() => '---').join('|');

      // Process data rows (start from index 1)
      const rows = rowsRaw.slice(1).map(line => {
        const cells = line.split(potentialCellDelimiter).map(cell => cell.trim());
        // Pad/truncate cells to match header length for consistency
        const adjustedCells = Array.from({ length: header.length }, (_, i) => cells[i] || '');
        // Escape pipe characters within cells to avoid breaking table structure
        const escapedCells = adjustedCells.map(cell => cell.replace(/\|/g, '\\|'));
        return escapedCells.join(' | '); // Join cells with Markdown pipe syntax
      });

      // Construct Markdown table strings
      const headerString = `| ${header.join(' | ')} |`;
      const separatorString = `| ${separator} |`;
      const rowString = rows.map(row => `| ${row} |`).join('\n');

      // Combine parts into the final Markdown table
      // Handle case where there are no data rows (only header)
      if (rows.length === 0) {
           return `${headerString}\n${separatorString}`;
      } else {
          return `${headerString}\n${separatorString}\n${rowString}`;
      }
    } catch (e) {
      console.error("Error formatting structured data as Markdown table:", e);
      // Fallback to preformatted text on error
      return '```\n' + dataText + '\n```';
    }
  };

  // Intelligently combine extra columns for rows with too many fields
  const combineExtraColumns = (columns: string[], expectedColumns: number): string[] => {
    // If it's a project data row (ID, Type, etc.), we have some specific knowledge
    const isProjectRow = columns.length > 1 && /^\d+$/.test(columns[0]) && 
                       ['Story', 'Epic', 'Task', 'Bug'].includes(columns[1]);
    
    if (isProjectRow) {
      // Create a new array to build our result
      const result: string[] = [];
      
      // Know that the first two columns are ID and Type, which should be preserved
      result.push(columns[0]); // ID
      result.push(columns[1]); // Type
      
      // The third column is typically Name/Summary, which rarely contains commas
      if (columns.length > 2) {
        result.push(columns[2]); // Name/Summary
      } else {
        result.push(''); // Empty if missing
      }
      
      // Fourth column is typically Description, which often has commas
      // We need to determine how many columns to combine for the description
      if (columns.length > 3) {
        // Determine where the description ends and the next field begins
        let descEndIndex = 3; // Start with just the first field
        
        // Look for a field that looks like Priority (High/Medium/Low)
        for (let i = 4; i < columns.length; i++) {
          const field = columns[i].trim();
          if (field === 'High' || field === 'Medium' || field === 'Low' || 
              field.match(/^Phase\s+\d+$/) || field.match(/^Sprint\s+\d+$/)) {
            // Found a likely next field after description
            descEndIndex = i - 1;
            break;
          }
        }
        
        // Combine all columns that should be part of the description
        const descriptionParts = columns.slice(3, descEndIndex + 1);
        result.push(descriptionParts.join(', '));
        
        // Add remaining columns
        for (let i = descEndIndex + 1; i < columns.length; i++) {
          result.push(columns[i]);
        }
      }
      
      // Make sure we have the expected number of columns
      while (result.length < expectedColumns) {
        result.push('');
      }
      
      // Trim to the expected number of columns
      return result.slice(0, expectedColumns);
    } else {
      // For non-project rows, use a more general approach
      
      // Make a copy of the columns array
      const result = [...columns];
      
      // Keep combining columns until we have the right number
      while (result.length > expectedColumns) {
        // Find the best columns to combine
        const bestPair = findBestColumnsToCombine(result);
        
        // Combine the identified columns
        result[bestPair.first] = `${result[bestPair.first]}, ${result[bestPair.second]}`;
        result.splice(bestPair.second, 1);
      }
      
      return result;
    }
  };

  // Find the best pair of adjacent columns to combine, based on heuristics
  const findBestColumnsToCombine = (columns: string[]): {first: number, second: number} => {
    // Default to combining the last two columns
    let bestFirst = columns.length - 2;
    let bestSecond = columns.length - 1;
    let bestScore = 0;
    
    // Try each adjacent pair and score them
    for (let i = 0; i < columns.length - 1; i++) {
      const first = columns[i];
      const second = columns[i + 1];
      let score = 0;
      
      // Score based on content heuristics
      
      // Penalty for second column starting with capital (likely new field)
      if (second.length > 0 && second[0].match(/[A-Z]/)) {
        score -= 10;
      }
      
      // Penalty for second column being a standard field value
      if (second === 'High' || second === 'Medium' || second === 'Low' ||
          second.match(/^Phase\s+\d+$/) || second.match(/^Sprint\s+\d+$/)) {
        score -= 20;
      }
      
      // Bonus for second column starting with lowercase (likely continuation)
      if (second.length > 0 && second[0].match(/[a-z]/)) {
        score += 10;
      }
      
      // Bonus if first column ends without proper punctuation
      if (first.length > 0 && !first.match(/[.!?]$/)) {
        score += 5;
      }
      
      // Bonus for second column starting with a connecting word
      if (second.match(/^\s*(and|or|but|because|since|as|that)\s+/i)) {
        score += 15;
      }
      
      // Specific case for the "internal collab features, cross-dept sharing" pattern
      if (first.includes('features') && second.includes('sharing')) {
        score += 30;
      }
      
      // If this pair has a better score, use it
      if (score > bestScore) {
        bestScore = score;
        bestFirst = i;
        bestSecond = i + 1;
      }
    }
    
    return { first: bestFirst, second: bestSecond };
  };

  // Helper function to properly parse CSV rows, handling quoted fields with commas
  const parseCSVRow = (row: string, expectedColumns: number): string[] => {
    // Detect if the row has quotes that need special handling
    const hasQuotes = row.includes('"');
    
    if (hasQuotes) {
      // RFC 4180 compliant parsing for properly quoted CSV
      return parseRFC4180CompliantRow(row, expectedColumns);
    } else {
      // Handle rows without quotes - this is where we need special logic
      const simpleSplit = row.split(',').map(x => x.trim());
      
      // If we already have the right number of columns, return as is
      if (simpleSplit.length === expectedColumns) {
        return simpleSplit;
      }
      
      // If we have too many columns, we need to combine some
      if (simpleSplit.length > expectedColumns) {
        return combineExtraColumns(simpleSplit, expectedColumns);
      }
      
      // If we have too few columns, just pad with empty strings
      while (simpleSplit.length < expectedColumns) {
        simpleSplit.push('');
      }
      
      return simpleSplit;
    }
  };

  // Parse CSV rows that follow the RFC 4180 standard (with proper quotes)
  const parseRFC4180CompliantRow = (row: string, expectedColumns: number): string[] => {
    const result: string[] = [];
    let currentValue = "";
    let insideQuotes = false;
    
    for (let i = 0; i < row.length; i++) {
      const char = row[i];
      
      if (char === '"') {
        // Handle escaped quotes (two double quotes together)
        if (insideQuotes && i + 1 < row.length && row[i + 1] === '"') {
          // Add a single quote to the value and skip the next quote
          currentValue += '"';
          i++;
        } else {
          // Toggle inside quotes state
          insideQuotes = !insideQuotes;
        }
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
    
    // If we still don't have the expected number of columns, we might have missed something
    if (result.length !== expectedColumns) {
      return combineExtraColumns(result, expectedColumns);
    }
    
    return result;
  };

  return (
    <>
      {selectedCitation && (
        <div 
          className="fixed top-0 right-0 h-full w-full sm:w-2/3 md:w-1/2 lg:w-1/3 bg-white shadow-lg p-4 sm:p-6 overflow-y-auto z-50 border-l border-gray-200 dark:bg-gray-900 dark:border-gray-800"
        >
          <div className="flex justify-between items-center mb-4">
            <h2 id="citation-details-title" className="text-lg sm:text-xl font-semibold text-gray-800 dark:text-gray-200">Citation Details</h2>
            <button 
              onClick={onClose}
              className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-400 rounded-full p-1"
              aria-label="Close citation details"
            >
              {/* Close Icon SVG */}
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          
          {/* Source File Section */}
          <div className="mb-4 border-b border-gray-200 dark:border-gray-700 pb-2">
            <h3 className="text-xs sm:text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Source File:</h3>
            <p className="text-sm sm:text-md font-semibold text-gray-900 dark:text-gray-100 break-words">{selectedCitation.sourcefile || 'N/A'}</p>
          </div>

          {/* Content Snippet Section */}
          <div className="prose prose-sm max-w-none dark:prose-invert">
            <h3 className="text-xs sm:text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Content Snippet:</h3>
            <ReactMarkdown 
              remarkPlugins={[remarkGfm]} 
              components={MarkdownComponents}
            >
              {formatStructuredDataAsMarkdownTable(selectedCitation.text || 'No content available.')}
            </ReactMarkdown>
          </div>
          
          {/* Optional: Display ID */}
          {/* <p className="text-xs text-gray-500 mt-4">Document Chunk ID: {selectedCitation.id}</p> */}
        </div>
      )}
    </>
  );
} 