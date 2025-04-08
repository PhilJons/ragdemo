import { findRelevantContent } from "@/lib/ai/search";
import { azure } from "@ai-sdk/azure";
import { convertToCoreMessages, streamText, CoreMessage, StreamData } from "ai";
import { StreamingTextResponse } from "ai";
import { z } from "zod";

// Allow streaming responses up to 30 seconds
export const maxDuration = 30;

export async function POST(req: Request) {
  try {
    const { messages }: { messages: CoreMessage[] } = await req.json();

    // --- Manual RAG Context Injection ---
    let retrievedContext = "";
    const lastUserMessage = messages.findLast(m => m.role === 'user');
    let sourceDocuments: any[] = [];

    // Create a StreamData instance early
    const data = new StreamData();

    if (lastUserMessage && typeof lastUserMessage.content === 'string') {
      console.log(`Manually fetching context for: "${lastUserMessage.content}"`);
      try {
        const searchResults = await findRelevantContent(lastUserMessage.content);
        const validResults = searchResults.filter(r => r.id !== 'error' && r.id !== 'no-results');
        
        if (validResults.length > 0) {
          sourceDocuments = validResults;
          retrievedContext = "Context from knowledge base:\n";
          validResults.forEach((result, index) => {
            retrievedContext += `[Source ID: ${result.id}] ${result.text}\n`;
          });
          console.log("Context prepared (with IDs):", retrievedContext);
          // Append sourceDocuments to the stream data immediately
          data.append({ sourceDocuments });
        } else {
          console.log("No valid context found by findRelevantContent.");
        }
      } catch (searchError) {
        console.error("Error calling findRelevantContent manually:", searchError);
        retrievedContext = "Context: Error retrieving information from knowledge base.\n"; 
      }
    } else {
      console.log("No user message found to fetch context for.");
    }
    
    const messagesWithContext: CoreMessage[] = retrievedContext
      ? [{ role: 'system', content: retrievedContext }, ...messages]
      : messages;
    // --- End Manual RAG Context Injection ---

    const result = await streamText({
      model: azure(process.env.AZURE_DEPLOYMENT_NAME!),
      messages: messagesWithContext,
      system: `You are a helpful assistant. Answer the user's question based *only* on the provided context prefixed with [Source ID: ...].
Cite the Source IDs you used *immediately* after the information derived from that source, formatted like this: [Source: ID]. Do not group citations at the end.`,
      onFinish() {
        // Close the data stream when the LLM stream finishes
        console.log("LLM stream finished, closing data stream.");
        data.close();
      }
    });

    // Return a StreamingTextResponse that includes the data stream
    console.log("Returning StreamingTextResponse with data prepared.");
    return new StreamingTextResponse(result.toAIStream(), {}, data);
  } catch (error: unknown) {
    console.error("API route error:", error);
    return new Response(JSON.stringify({ error: "An unexpected error occurred. Please try again later." }), { 
      status: 500,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }
}
