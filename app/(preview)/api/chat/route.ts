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
        // Ensure the returned type matches the expected structure (including sourcefile)
        const validResults = searchResults.filter(r => r.id !== 'error' && r.id !== 'no-results') as Array<{ id: string, text: string, sourcefile: string }>; 
        
        if (validResults.length > 0) {
          // Construct the sourceDocuments with id, text, and sourcefile
          sourceDocuments = validResults.map(doc => ({ 
            id: doc.id,
            text: doc.text, // Use 'text' as expected by annotation component?
            sourcefile: doc.sourcefile // Ensure sourcefile is included
          }));

          retrievedContext = "Context from knowledge base:\n";
          // Include sourcefile in the system prompt context if desired, or just use ID
          validResults.forEach((result, index) => {
            retrievedContext += `[Source ID: ${result.id}] ${result.text}\n`;
          });
          console.log("Context prepared (with IDs):", retrievedContext);
          
          // Append the correctly structured sourceDocuments to the stream data
          data.append({ sourceDocuments }); // Frontend expects this shape { sourceDocuments: [{ id, text, sourcefile }] }
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
      system: `You are a helpful AI assistant. Your primary goal is to answer user questions based *exclusively* on the provided context documents prefixed with [Source ID: ...]. \n \nInstructions: \n1. **Answer ONLY using the provided context.** Do not use any prior knowledge or information outside of the given documents. \n2. **If the answer cannot be found in the context, state clearly:** \"I cannot answer this question based on the provided information.\" Do NOT attempt to answer from general knowledge. \n3. **Cite Sources Inline Immediately:** Place the citation \`[Source: ID]\` *directly* after the specific sentence, phrase, or fact extracted from the source document. Do not wait until the end of a paragraph or group citations together. Cite *only* the source(s) used for that specific piece of information. \n4. **Use Markdown for clarity:** Format your response using Markdown (bold, italics, lists) when it enhances readability. \n5. **Be concise:** Provide direct answers based on the context.`,
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
