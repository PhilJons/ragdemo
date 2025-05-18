import { findRelevantContent } from "@/lib/ai/search";
import { azure } from "@ai-sdk/azure";
import { convertToCoreMessages, streamText, CoreMessage, StreamData } from "ai";
import { StreamingTextResponse } from "ai";
import prisma from "@/lib/prisma"; // Import Prisma client
import { DEFAULT_SYSTEM_PROMPTS } from "@/lib/prompt-constants"; // Import from correct location

// Allow streaming responses up to 30 seconds
export const maxDuration = 30;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      messages,
      // selectedSystemPromptContent, // This will be determined server-side based on project
      // temperature, // This will be determined server-side
      // maxTokens, // This will be determined server-side
      projectId, // New: projectId from client
    }: { 
      messages: CoreMessage[]; 
      selectedSystemPromptContent?: string; // Kept for fallback if no project
      temperature?: number; // Kept for fallback
      maxTokens?: number; // Kept for fallback
      projectId?: string | null;
    } = body;

    let systemPromptToUse = body.selectedSystemPromptContent || DEFAULT_SYSTEM_PROMPTS[0]?.content || "Fallback default prompt content";
    let temperatureToUse = body.temperature ?? 0.7;
    let maxTokensToUse = body.maxTokens ?? 2000;

    if (projectId) {
      console.log(`Chat request received for project: ${projectId}`);
      const projectSettings = await prisma.project.findUnique({
        where: { id: projectId },
        include: { activeProjectPrompt: true }, // Include the full related prompt object
      });

      if (projectSettings) {
        console.log(`Found settings for project ${projectId}:`, projectSettings);
        // Determine system prompt
        if (projectSettings.activeProjectPromptId && projectSettings.activeProjectPrompt) {
          systemPromptToUse = projectSettings.activeProjectPrompt.content;
          console.log(`Using specific project prompt: ${projectSettings.activeProjectPrompt.name}`);
        } else if (projectSettings.activeGlobalPromptName) {
          const globalPrompt = DEFAULT_SYSTEM_PROMPTS.find(p => p.name === projectSettings.activeGlobalPromptName);
          if (globalPrompt) {
            systemPromptToUse = globalPrompt.content;
            console.log(`Using global prompt for project: ${projectSettings.activeGlobalPromptName}`);
          } else {
            console.warn(`Global prompt named '${projectSettings.activeGlobalPromptName}' not found for project ${projectId}. Using default.`);
          }
        } else {
          console.log(`Project ${projectId} has no specific active prompt. Using client/global default.`);
        }
        // Determine temperature and maxTokens
        temperatureToUse = projectSettings.temperature ?? temperatureToUse; // Fallback to client/global if null on project
        maxTokensToUse = projectSettings.maxTokens ?? maxTokensToUse; // Fallback to client/global if null on project
        console.log(`Using Temperature: ${temperatureToUse}, MaxTokens: ${maxTokensToUse} for project ${projectId}`);
      } else {
        console.warn(`Project with ID ${projectId} not found. Using client/global defaults.`);
      }
    } else {
      console.log("No projectId provided. Using client/global defaults for chat.");
    }

    // --- Manual RAG Context Injection ---
    let retrievedContext = "";
    const lastUserMessage = messages.findLast(m => m.role === 'user');
    let sourceDocuments: any[] = [];
    const data = new StreamData();

    if (lastUserMessage && typeof lastUserMessage.content === 'string') {
      try {
        // TODO: Pass projectId to findRelevantContent
        const searchResults = await findRelevantContent(lastUserMessage.content, projectId || undefined);
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
          retrievedContext = retrievedContext.replace(/Stop working the way you always have! Challenge every step!/g, '');
          data.append({ sourceDocuments });
        } 
      } catch (searchError) {
        console.error("Error calling findRelevantContent:", searchError);
        retrievedContext = "Context: Error retrieving information from knowledge base.\n"; 
      }
    }
    
    const messagesWithContext = [...messages];
    if (retrievedContext && lastUserMessage) {
        const lastUserMessageIndex = messagesWithContext.findLastIndex(m => m.role === 'user');
        if (lastUserMessageIndex !== -1 && typeof messagesWithContext[lastUserMessageIndex].content === 'string') {
            messagesWithContext[lastUserMessageIndex].content = `${messagesWithContext[lastUserMessageIndex].content}\n\n${retrievedContext}`;
        } else {
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
  } catch (error: unknown) {
    console.error("API route error:", error);
    // Ensure a generic error is returned to the client
    const errorMessage = error instanceof Error ? error.message : "An unknown error occurred.";
    return new Response(JSON.stringify({ error: "An unexpected error occurred. Please try again later.", details: errorMessage }), { 
        status: 500,
        headers: {
            'Content-Type': 'application/json'
        }
    });
  }
}

// Helper to ensure DEFAULT_SYSTEM_PROMPTS is available if not directly exported
// This might be better if DEFAULT_SYSTEM_PROMPTS is in a shared lib/constants file
// For now, assuming it can be imported from chat-interface if exported there.
// If not, you might need to redefine it here or import from its actual source.
