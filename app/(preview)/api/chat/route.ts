import { findRelevantContent } from "@/lib/ai/search";
import { azure } from "@ai-sdk/azure";
import { convertToCoreMessages, streamText, CoreMessage, StreamData, generateText } from "ai";
import { StreamingTextResponse } from "ai";
import prisma from "@/lib/prisma"; // Import Prisma client
import { DEFAULT_SYSTEM_PROMPTS } from "@/lib/prompt-constants"; // Import from correct location
import { generateDynamicMapPromptAction } from "@/app/actions/generateDynamicMapPrompt"; // Added for Deep Analysis

// Allow streaming responses up to 30 seconds for standard RAG, Deep Analysis might take longer
// Consider adjusting this or using a different mechanism for long-running Deep Analysis tasks if they exceed this limit.
export const maxDuration = 60; // Increased for potentially longer Deep Analysis

// --- Implementations for Deep Analysis data retrieval ---
async function getAllProjectDocumentReferences(projectId: string): Promise<{ id: string, name: string }[]> {
  try {
    const documents = await prisma.document.findMany({
      where: { projectId: projectId },
      select: {
        id: true,
        fileName: true, // Use fileName as indicated by linter errors
      },
    });
    console.log(`Deep Analysis: Found ${documents.length} document references for project ${projectId} from database.`);
    // Map to the expected return type { id: string, name: string }
    return documents.map(doc => ({ id: doc.id, name: doc.fileName }));
  } catch (error) {
    console.error(`Deep Analysis: Error fetching document references for project ${projectId}:`, error);
    return []; // Return empty array on error
  }
}

async function getDocumentContentById(docId: string): Promise<string | null> {
  try {
    const document = await prisma.document.findUnique({
      where: { id: docId },
      select: {
        extractedText: true, // Attempt to get the directly stored extracted text
        blobUri: true,       // Keep blobUri for logging or fallback if extractedText is null
      },
    });
    if (document && document.extractedText) {
      console.log(`Deep Analysis: Retrieved extractedText for document ID ${docId}.`);
      return document.extractedText;
    } else if (document && document.blobUri) {
      // This case means extractedText was null or empty, but blobUri exists.
      // Content retrieval from blobUri is still NOT IMPLEMENTED here.
      console.error(`Deep Analysis: CRITICAL - Document ID ${docId} has no extractedText. Content retrieval from blobUri (${document.blobUri}) is NOT IMPLEMENTED. Returning null.`);
      // TODO: Implement actual logic to fetch content from document.blobUri if extractedText is not available.
      return null; 
    } else {
      console.warn(`Deep Analysis: No document, extractedText, or blobUri found for ID ${docId}.`);
      return null;
    }
  } catch (error) {
    console.error(`Deep Analysis: Error fetching document (for extractedText/blobUri) for ID ${docId}:`, error);
    return null; // Return null on error
  }
}
// --- End Implementations ---

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      messages,
      projectId, 
      isDeepAnalysisMode, // New: Flag for Deep Analysis mode
    }: { 
      messages: CoreMessage[]; 
      selectedSystemPromptContent?: string; 
      temperature?: number; 
      maxTokens?: number; 
      projectId?: string | null;
      isDeepAnalysisMode?: boolean; // Added for Deep Analysis
    } = body;

    let systemPromptToUse = body.selectedSystemPromptContent || DEFAULT_SYSTEM_PROMPTS.find(p=>p.name === "General RAG Assistant")?.content || "You are a helpful AI assistant.";
    let temperatureToUse = body.temperature ?? 0.7;
    let maxTokensToUse = body.maxTokens ?? 2000;
    const data = new StreamData(); // For streaming source documents in standard RAG

    if (projectId) {
      console.log(`Chat request for project: ${projectId}, Deep Analysis: ${!!isDeepAnalysisMode}`);
      const projectSettings = await prisma.project.findUnique({
        where: { id: projectId },
        include: { activeProjectPrompt: true }, 
      });

      if (projectSettings) {
        if (projectSettings.activeProjectPromptId && projectSettings.activeProjectPrompt) {
          systemPromptToUse = projectSettings.activeProjectPrompt.content;
        } else if (projectSettings.activeGlobalPromptName) {
          const globalPrompt = DEFAULT_SYSTEM_PROMPTS.find(p => p.name === projectSettings.activeGlobalPromptName);
          if (globalPrompt) systemPromptToUse = globalPrompt.content;
        }
        temperatureToUse = projectSettings.temperature ?? temperatureToUse;
        maxTokensToUse = projectSettings.maxTokens ?? maxTokensToUse;
      } else {
        console.warn(`Project with ID ${projectId} not found. Using defaults.`);
      }
    } else {
      console.log("No projectId. Using defaults for chat.");
    }

    const lastUserMessage = messages.findLast(m => m.role === 'user');
    const userQuery = lastUserMessage && typeof lastUserMessage.content === 'string' ? lastUserMessage.content : "";

    if (isDeepAnalysisMode && projectId && userQuery) {
      console.log(`--- DEEP ANALYSIS MODE FOR PROJECT ${projectId} ---`);
      // 1. Generate Dynamic "Map" Prompt
      const mapPromptResult = await generateDynamicMapPromptAction(userQuery);
      if (!mapPromptResult.success || !mapPromptResult.mapPrompt) {
        console.error("Deep Analysis: Failed to generate dynamic map prompt:", mapPromptResult.error);
        return new Response(JSON.stringify({ error: `Failed to start deep analysis: ${mapPromptResult.error}` }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      }
      const dynamicMapPrompt = mapPromptResult.mapPrompt;
      console.log("Deep Analysis: Generated Dynamic Map Prompt:", /* dynamicMapPrompt - avoid logging potentially large prompt */ "Prompt Hidden");

      // 2. Get list of all documents in the project
      const documentReferences = await getAllProjectDocumentReferences(projectId);
      if (documentReferences.length === 0) {
        console.warn("Deep Analysis: No documents found for project", projectId);
        // Consider streaming a message back to the user here
        const noDocsStream = new ReadableStream({
          start(controller) {
            controller.enqueue("Deep Analysis: No documents were found in this project to analyze.");
            controller.close();
          }
        });
        return new StreamingTextResponse(noDocsStream);
      }
      console.log(`Deep Analysis: Found ${documentReferences.length} documents for project ${projectId}.`);

      // 3. "Map" Phase: Process each document
      const intermediateResults: { docName: string, analysis: string }[] = [];
      // Stream progress updates for the Map phase (optional but good for UX)
      data.append({ deepAnalysisStatus: `Starting analysis of ${documentReferences.length} documents...`}); 

      for (const docRef of documentReferences) {
        console.log(`Deep Analysis: Processing document ${docRef.name} (ID: ${docRef.id})`);
        data.append({ deepAnalysisStatus: `Analyzing document: ${docRef.name}...`}); 
        const docContent = await getDocumentContentById(docRef.id);
        if (docContent) {
          const mapInstancePrompt = dynamicMapPrompt.replace("{text_content_of_single_document_will_be_injected_here}", docContent);
          
          // LLM call for this single document (Map step)
          // Using a non-streaming call here for simplicity to gather intermediate results.
          // Error handling should be robust for production.
          try {
            // Corrected: Use imported generateText for non-streaming single call
            const mapApiResponse = await generateText({
                model: azure(process.env.AZURE_DEPLOYMENT_NAME!), // Pass the model instance
                prompt: mapInstancePrompt, // For generateText, prompt is typically part of messages or a direct string
                // For generateText, direct string prompt is simpler if no complex message history is needed for this map step.
                // If using messages: messages: [{ role: 'user', content: mapInstancePrompt }],
                system: "You are an AI assistant performing a specific analysis task on the provided document text.",
                temperature: 0.3, 
                maxTokens: 1500, 
            });
            intermediateResults.push({ docName: docRef.name, analysis: mapApiResponse.text });
            console.log(`Deep Analysis: Finished analysis for ${docRef.name}`);
          } catch (mapError) {
            console.error(`Deep Analysis: Error analyzing document ${docRef.name}:`, mapError);
            intermediateResults.push({ docName: docRef.name, analysis: `Error analyzing this document: ${mapError instanceof Error ? mapError.message : String(mapError)}` });
          }
        } else {
          console.warn(`Deep Analysis: No content found for document ${docRef.name} (ID: ${docRef.id}). Skipping.`);
          intermediateResults.push({ docName: docRef.name, analysis: "No content could be retrieved for this document." });
        }
        // Small delay to allow UI to update with status, if frontend handles streaming status updates
        await new Promise(resolve => setTimeout(resolve, 50)); 
        data.append({ deepAnalysisStatus: `Finished analyzing: ${docRef.name}. Processed ${intermediateResults.length}/${documentReferences.length}.`}); 
      }
      data.append({ deepAnalysisStatus: "All documents analyzed. Synthesizing final answer..."}); 

      // 4. "Reduce" Phase: Synthesize intermediate results
      let reduceInput = `Original User Query: ${userQuery}\n\nExtracted Information from Documents:\n---\n`;
      intermediateResults.forEach(ir => {
        reduceInput += `Document: ${ir.docName}\nAnalysis:\n${ir.analysis}\n---\n`;
      });

      const reduceSystemPrompt = "You are an AI Synthesizer. Based SOLELY AND EXCLUSIVELY on the provided extracted information from multiple documents, provide a comprehensive answer to the Original User Query. Ensure you consolidate findings, identify patterns, and clearly cite information using the [Source ID: <ID_VALUE>] markers that were preserved in the extracted analysis. Do not use any external knowledge.";
      
      console.log("Deep Analysis: Starting Reduce phase.");
      // Streaming the final result from the Reduce phase
      const reduceResult = await streamText({
        model: azure(process.env.AZURE_DEPLOYMENT_NAME!), // Use a capable model, e.g., GPT-4.1 if available and configured
        messages: [{role: "user", content: reduceInput}],
        system: reduceSystemPrompt,
        temperature: temperatureToUse, // Use project/default temperature
        maxTokens: maxTokensToUse, // Use project/default max tokens, ensure it's large enough for synthesis
        onFinish() {
          data.append({ deepAnalysisStatus: "Deep Analysis Complete."}); 
          data.close();
        }
      });
      return new StreamingTextResponse(reduceResult.toAIStream(), {}, data); // Stream final synthesized answer

    } else {
      // --- Standard RAG Workflow (existing logic) ---
      console.log("--- STANDARD RAG MODE ---");
      let retrievedContext = "";
      let sourceDocuments: any[] = [];
  
      if (userQuery) {
        try {
          const searchResults = await findRelevantContent(userQuery, projectId || undefined);
          const validResults = searchResults.filter(r => r.id !== 'error' && r.id !== 'no-results') as Array<{ id: string, text: string, sourcefile: string, projectId?: string }>;
          
          if (validResults.length > 0) {
            sourceDocuments = validResults.map(doc => ({ 
              id: doc.id,
              text: doc.text,
              sourcefile: doc.sourcefile
            }));
            retrievedContext = "Context from knowledge base:\n";
            validResults.forEach((result) => {
              retrievedContext += `[Source ID: ${result.id}, sourcefile: ${result.sourcefile}] ${result.text}\n`;
            });
            data.append({ sourceDocuments }); 
          } 
        } catch (searchError) {
          console.error("Error calling findRelevantContent:", searchError);
          // Potentially stream an error message back to the user or handle gracefully
        }
      }
      
      const messagesWithContext: CoreMessage[] = [...messages];
      if (retrievedContext && lastUserMessage) {
          const lastUserMessageIndex = messagesWithContext.findLastIndex(m => m.role === 'user');
          if (lastUserMessageIndex !== -1 && typeof messagesWithContext[lastUserMessageIndex].content === 'string') {
              // Append context to the last user message content
              messagesWithContext[lastUserMessageIndex].content = `${messagesWithContext[lastUserMessageIndex].content}\n\n${retrievedContext}`;
          } else {
              // Fallback: if no user message or content isn't string, add context as a system message
              messagesWithContext.unshift({ role: 'system', content: retrievedContext });
          }
      }
  
      const result = await streamText({
        model: azure(process.env.AZURE_DEPLOYMENT_NAME!),
        messages: messagesWithContext,
        system: systemPromptToUse,
        temperature: temperatureToUse,
        maxTokens: maxTokensToUse,
        onFinish() {
          data.close();
        }
      });
      return new StreamingTextResponse(result.toAIStream(), {}, data);
    }

  } catch (error: unknown) {
    console.error("API route error:", error);
    const errorMessage = error instanceof Error ? error.message : "An unknown error occurred.";
    return new Response(JSON.stringify({ error: "An unexpected error occurred. Please try again later.", details: errorMessage }), { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Helper to ensure DEFAULT_SYSTEM_PROMPTS is available if not directly exported
// This might be better if DEFAULT_SYSTEM_PROMPTS is in a shared lib/constants file
// For now, assuming it can be imported from chat-interface if exported there.
// If not, you might need to redefine it here or import from its actual source.
