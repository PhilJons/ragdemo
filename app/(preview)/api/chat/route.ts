import { findRelevantContent } from "@/lib/ai/search";
import { azure } from "@ai-sdk/azure";
import { convertToCoreMessages, streamText, CoreMessage, StreamData, generateText } from "ai";
import { StreamingTextResponse } from "ai";
import prisma from "@/lib/prisma"; // Import Prisma client
import { DEFAULT_SYSTEM_PROMPTS } from "@/lib/prompt-constants"; // Import from correct location
import { generateDynamicMapPromptAction } from "@/app/actions/generateDynamicMapPrompt"; // Added for Deep Analysis
import { generateDynamicReducePromptAction } from "@/app/actions/generateDynamicReducePromptAction"; // Added for Dynamic Reduce Prompt

// Allow streaming responses up to 30 seconds for standard RAG, Deep Analysis might take longer
// Consider adjusting this or using a different mechanism for long-running Deep Analysis tasks if they exceed this limit.
export const maxDuration = 300; // Increased for potentially longer Deep Analysis (e.g., 5 minutes)

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
    console.log(`Deep Analysis: getAllProjectDocumentReferences for projectId: ${projectId}. Found ${documents.length} raw document records.`);
    // Log each document found
    documents.forEach(doc => {
      console.log(`Deep Analysis: Document Record - ID: ${doc.id}, FileName: ${doc.fileName}`);
    });

    // Filter out documents with null or empty fileName before mapping, as these might be problematic
    const validDocuments = documents.filter(doc => doc.fileName && doc.fileName.trim() !== '');
    if (validDocuments.length !== documents.length) {
      console.warn(`Deep Analysis: Filtered out ${documents.length - validDocuments.length} documents with null or empty fileNames.`);
    }

    console.log(`Deep Analysis: Returning ${validDocuments.length} valid document references for project ${projectId}.`);
    return validDocuments.map((doc: { id: string; fileName: string }) => ({ id: doc.id, name: doc.fileName }));
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
      messages: currentMessagesArray, // Renamed to avoid conflict with chatHistory
      projectId, 
      isDeepAnalysisMode,
      chatHistory // New: Full chat history from the client
    }: { 
      messages: CoreMessage[]; // This is the current turn's messages, typically just the user query
      selectedSystemPromptContent?: string; 
      temperature?: number; 
      maxTokens?: number; 
      projectId?: string | null;
      isDeepAnalysisMode?: boolean;
      chatHistory?: CoreMessage[]; // Optional: Full history up to the current query
    } = body;

    // Use currentMessagesArray for extracting the latest user query
    const lastUserMessage = currentMessagesArray.findLast(m => m.role === 'user');
    const userQuery = lastUserMessage && typeof lastUserMessage.content === 'string' ? lastUserMessage.content : "";

    // Rename messages to allMessages to avoid confusion if chatHistory is used directly
    const allMessages = chatHistory || currentMessagesArray; // Use full history if available, else just current turn

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

    if (isDeepAnalysisMode && projectId && userQuery) {
      console.log(`--- DEEP ANALYSIS MODE FOR PROJECT ${projectId} ---`);
      
      let priorConversationSummary = "";
      if (allMessages && allMessages.length > 1) { // More than 1 message implies history beyond the current query
        // Create a simple summary of the conversation before the *current* user query.
        // The last message in `allMessages` is the current user query which is already in `userQuery`.
        // So, we process up to the second to last message.
        const historyToSummarize = allMessages.slice(0, -1);
        if (historyToSummarize.length > 0) {
          priorConversationSummary = "Prior conversation context:\n";
          historyToSummarize.forEach(msg => {
            priorConversationSummary += `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}\n`;
          });
          priorConversationSummary += "\n---\n";
          console.log("Deep Analysis: Generated prior conversation summary for prompts:", priorConversationSummary.substring(0, 200) + "...");
        }
      }

      const DEBUG_SINGLE_DOC_PREFIX = "DEBUG_MAP_PHASE_SINGLE_DOC: ";
      const isDebugSingleDocMode = userQuery.startsWith(DEBUG_SINGLE_DOC_PREFIX);
      let effectiveUserQuery = userQuery;
      if (isDebugSingleDocMode) {
        effectiveUserQuery = userQuery.substring(DEBUG_SINGLE_DOC_PREFIX.length);
        console.log(`Deep Analysis: DEBUG_SINGLE_DOC_MODE ENABLED. Processing only the first document for query: "${effectiveUserQuery}"`);
        data.append({ deepAnalysisStatus: `DEBUG MODE: Analyzing first document only for query: "${effectiveUserQuery}"` });
      } else {
        data.append({ deepAnalysisStatus: `Deep Analysis Mode started for query: "${effectiveUserQuery}"` });
      }

      // 1. Dynamic "Map" Prompt Generation
      data.append({ deepAnalysisStatus: "Generating analytical instructions (map prompt)..." });
      const mapPromptResult = await generateDynamicMapPromptAction(effectiveUserQuery, priorConversationSummary);
      if (!mapPromptResult.success || !mapPromptResult.mapPrompt) {
        console.error("Deep Analysis: Failed to generate dynamic map prompt:", mapPromptResult.error);
        data.append({ deepAnalysisStatus: `Error: Failed to generate map prompt - ${mapPromptResult.error}. Aborting.`});
        data.close();
        return new StreamingTextResponse(new ReadableStream({ start(c){c.close();}}), {}, data); // Send empty stream but data has error
      }
      const dynamicMapPrompt = mapPromptResult.mapPrompt;
      console.log("Deep Analysis: Generated Dynamic Map Prompt.", /* dynamicMapPrompt - avoid logging potentially large prompt */ "Length:", dynamicMapPrompt.length);
      data.append({ deepAnalysisStatus: "Analytical instructions (map prompt) generated." });

      // 2. Get list of all documents in the project
      data.append({ deepAnalysisStatus: "Fetching project documents..." });
      const documentReferences = await getAllProjectDocumentReferences(projectId);
      if (documentReferences.length === 0) {
        console.warn("Deep Analysis: No documents found for project", projectId);
        data.append({ deepAnalysisStatus: "No documents found in this project to analyze." });
        data.close();
        // Return an empty stream with the data object containing the message
        const emptyStream = new ReadableStream({ start(controller) { controller.close(); } });
        return new StreamingTextResponse(emptyStream, {}, data);
      }
      console.log(`Deep Analysis: Found ${documentReferences.length} documents for project ${projectId}.`);
      data.append({ deepAnalysisStatus: `Found ${documentReferences.length} documents to analyze.` });


      // 3. "Map" Phase: Process each document
      const intermediateResults: { docName: string, analysis: string }[] = [];
      const totalDocs = documentReferences.length;
      data.append({ deepAnalysisStatus: `Starting analysis of ${totalDocs} documents...`}); 

      for (let i = 0; i < totalDocs; i++) {
        const docRef = documentReferences[i];
        const currentDocNumber = i + 1;
        console.log(`Deep Analysis: Processing document ${currentDocNumber}/${totalDocs}: ${docRef.name} (ID: ${docRef.id})`);
        data.append({ deepAnalysisStatus: `Analyzing document ${currentDocNumber}/${totalDocs}: ${docRef.name}...`}); 
        const docContent = await getDocumentContentById(docRef.id);
        if (docContent) {
          const snippetLength = isDebugSingleDocMode ? 500 : 100;
          console.log(`Deep Analysis: Retrieved extractedText for ${docRef.name} (length: ${docContent.length}). Snippet (first ${snippetLength} chars): ${docContent.substring(0, snippetLength)}...`);
          const mapInstancePrompt = dynamicMapPrompt.replace("{text_content_of_single_document_will_be_injected_here}", docContent);
          
          console.log("Deep Analysis: MAP PHASE - Prompt for:", docRef.name); // Simplified logging
          
          try {
            const mapApiResponse = await generateText({
                model: azure(process.env.AZURE_DEEP_ANALYSIS_MAP_DEPLOYMENT_NAME!),
                prompt: mapInstancePrompt, 
                system: "You are an AI assistant performing a specific analysis task on the provided document text.",
                temperature: 0.3, 
                maxTokens: 32000, // Ensure this is appropriate for your model context window
            });
            intermediateResults.push({ docName: docRef.name, analysis: mapApiResponse.text });
            console.log(`Deep Analysis: MAP PHASE - LLM response for document ${docRef.name} (length: ${mapApiResponse.text.length})`);
            data.append({ deepAnalysisStatus: `Finished analyzing ${currentDocNumber}/${totalDocs}: ${docRef.name}.` });
          } catch (mapError) {
            console.error(`Deep Analysis: Error analyzing document ${docRef.name}:`, mapError);
            const errorMessage = mapError instanceof Error ? mapError.message : String(mapError);
            intermediateResults.push({ docName: docRef.name, analysis: `Error analyzing this document: ${errorMessage}` });
            data.append({ deepAnalysisStatus: `Error analyzing ${currentDocNumber}/${totalDocs}: ${docRef.name} - ${errorMessage.substring(0, 50)}...` });
          }
        } else {
          console.warn(`Deep Analysis: No content found for document ${docRef.name} (ID: ${docRef.id}). Skipping.`);
          intermediateResults.push({ docName: docRef.name, analysis: "No content could be retrieved for this document." });
          data.append({ deepAnalysisStatus: `Skipped ${currentDocNumber}/${totalDocs}: ${docRef.name} (no content).` });
        }
        
        if (isDebugSingleDocMode) {
          console.log("Deep Analysis: DEBUG_SINGLE_DOC_MODE - Processed first document. Breaking map loop.");
          data.append({ deepAnalysisStatus: `DEBUG MODE: Finished analysis of first document: ${docRef.name}.` });
          break; 
        }
      }
      
      if (isDebugSingleDocMode && intermediateResults.length > 0) {
        const debugResultText = `DEBUG MODE: Map Phase Analysis for ${intermediateResults[0].docName}:

${intermediateResults[0].analysis}`;
        console.log("Deep Analysis: DEBUG_SINGLE_DOC_MODE - Returning map phase result directly.");
        const debugStream = new ReadableStream({
          start(controller) {
            data.append({ deepAnalysisStatus: "DEBUG MODE: Streaming single document analysis result." });
            controller.enqueue(debugResultText);
            controller.enqueue("\n\n[End of Debug Single Document Analysis]");
            data.append({ deepAnalysisStatus: "DEBUG MODE: Analysis of first document complete." });
            controller.close();
          },
          cancel() {
            console.log("Debug stream cancelled.");
          }
        });
        data.close(); 
        return new StreamingTextResponse(debugStream, {}, data);
      }
      
      data.append({ deepAnalysisStatus: `Document analysis phase complete. Processed ${intermediateResults.length} documents. Preparing synthesis...`}); 

      // Generate a summary of map outputs (placeholder for now, can be made more sophisticated)
      let summaryOfMapOutputs = "Structured analysis from multiple documents, potentially including extracted text, themes, and source IDs.";
      // Heuristics for summary based on content can be refined or expanded
      const sampleAnalysis = intermediateResults.length > 0 ? intermediateResults[0].analysis.toLowerCase() : "";
      if (sampleAnalysis.includes("ceo statement") || userQuery.toLowerCase().includes("vd ord")) {
        summaryOfMapOutputs = "Analyses of CEO statements (VD ord), including themes, tone, and stylistic elements.";
      } else if (sampleAnalysis.includes("financial figure")) {
        summaryOfMapOutputs = "Extracted financial figures and related textual context.";
      }
      console.log("Deep Analysis: Summary of map outputs for reduce prompt generation:", summaryOfMapOutputs);
      data.append({ deepAnalysisStatus: "Generating synthesis instructions (reduce prompt)..." });

      let reduceSystemPromptToUse: string;
      const reducePromptResult = await generateDynamicReducePromptAction(effectiveUserQuery, summaryOfMapOutputs, priorConversationSummary);

      if (!reducePromptResult.success || !reducePromptResult.reducePrompt) {
        console.error("Deep Analysis: Failed to generate dynamic reduce prompt:", reducePromptResult.error);
        reduceSystemPromptToUse = `You are an AI Synthesizer. Based SOLELY AND EXCLUSIVELY on the provided extracted information from multiple documents, provide a comprehensive answer to the Original User Query: "${effectiveUserQuery}". Ensure you consolidate findings, identify patterns, and clearly cite information using the [Source ID: <ID_VALUE>] markers that were preserved in the extracted analysis. Do not use any external knowledge. If the information is insufficient, state that clearly.`;
        data.append({ deepAnalysisStatus: "Error generating synthesis instructions, using fallback. Preparing final answer..." });
      } else {
        reduceSystemPromptToUse = reducePromptResult.reducePrompt;
        console.log("Deep Analysis: Successfully generated dynamic 'Reduce System Prompt'. Length:", reduceSystemPromptToUse.length);
        data.append({ deepAnalysisStatus: "Synthesis instructions (reduce prompt) generated. Preparing final answer..." });
      }

      data.append({ deepAnalysisStatus: "Consolidating all analyzed information..." });
      let reduceInput = `Original User Query: ${effectiveUserQuery}\n\nExtracted Information from Documents:\n---\n`;
      intermediateResults.forEach(ir => {
        reduceInput += `Document: ${ir.docName}\nAnalysis:\n${ir.analysis}\n---\n`;
      });
      console.log(`Deep Analysis: Reduce phase input length: ${reduceInput.length}.`); 
      data.append({ deepAnalysisStatus: "All information consolidated. Generating final synthesized response..." });
      
      console.log("Deep Analysis: REDUCE PHASE - System prompt being used (first 200 chars):", reduceSystemPromptToUse.substring(0,200) + "...");
      
      let fullReduceResponseForLogging = ""; 

      const reduceResult = await streamText({
        model: azure(process.env.AZURE_DEEP_ANALYSIS_REDUCE_DEPLOYMENT_NAME!),
        messages: [{role: "user", content: reduceInput}],
        system: reduceSystemPromptToUse, 
        temperature: temperatureToUse, 
        maxTokens: 32000, // Ensure this is appropriate for the reduce model's context window
        async onFinish(event) { 
          console.log("[Deep Analysis Reduce onFinish] Fired.");
          if (event && event.text) {
            fullReduceResponseForLogging = event.text; 
            console.log('Deep Analysis: REDUCE PHASE - Full LLM final text from onFinish event (length):', fullReduceResponseForLogging.length);
          } else {
            console.log('Deep Analysis: REDUCE PHASE - onFinish event did not directly provide full text. Accumulated stream (if any, length):', fullReduceResponseForLogging.length);
          }
          data.append({ deepAnalysisStatus: "Deep Analysis Complete. Final answer stream finished."}); 
          console.log("[Deep Analysis Reduce onFinish] Appended final status. Calling data.close().");
          data.close();
          console.log("[Deep Analysis Reduce onFinish] data.close() called.");
        }
      });

      const consumeStreamForLogging = async (stream: ReadableStream<Uint8Array>) => {
        const reader = stream.getReader();
        const decoder = new TextDecoder();
        let accumulatedResponse = "";
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            accumulatedResponse += decoder.decode(value, { stream: true });
          }
          if (!fullReduceResponseForLogging) { 
            fullReduceResponseForLogging = accumulatedResponse;
            console.log('Deep Analysis: REDUCE PHASE - Full LLM response from consuming stream (length):', fullReduceResponseForLogging.length);
          }
        } catch (error) {
          console.error("Error consuming reduce stream for logging:", error);
        }
      };
      
      const [streamForClient, streamForLogging] = reduceResult.toAIStream().tee();
      consumeStreamForLogging(streamForLogging); // Consume for logging, don't await

      console.log("[Deep Analysis] Reduce streamText call finished. Returning StreamingTextResponse to client.");
      // Note: data object is passed along with the StreamingTextResponse.
      // The onFinish callback for streamText is responsible for calling data.close().
      return new StreamingTextResponse(streamForClient, {}, data); 

    } else {
      // --- Standard RAG Workflow (existing logic) ---
      const data = new StreamData(); // Standard RAG also needs its own StreamData
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
    
      const messagesWithContext: CoreMessage[] = [...currentMessagesArray]; // Use currentMessagesArray for standard RAG context building
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
      model: azure(process.env.AZURE_CHAT_DEPLOYMENT_NAME!),
      messages: messagesWithContext, // Ensure standard RAG uses the correctly scoped messages
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
