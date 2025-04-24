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
          
          // TEMP FIX: Remove potentially problematic phrase flagged by Azure Content Filter
          retrievedContext = retrievedContext.replace(/Stop working the way you always have! Challenge every step!/g, '');
          
          console.log("Context prepared (with IDs):", retrievedContext);

          // *** ADD LOGGING HERE ***
          console.log("Source documents being appended to data stream:", JSON.stringify(sourceDocuments, null, 2));
          
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
    
    // --- Modified Context Injection ---
    const messagesWithContext = [...messages]; // Create a copy
    if (retrievedContext && lastUserMessage) {
        const lastUserMessageIndex = messagesWithContext.findLastIndex(m => m.role === 'user');
        if (lastUserMessageIndex !== -1 && typeof messagesWithContext[lastUserMessageIndex].content === 'string') {
            // Directly modify the content property of the object in the copied array
            messagesWithContext[lastUserMessageIndex].content = `${messagesWithContext[lastUserMessageIndex].content}\n\n${retrievedContext}`;
            console.log("Appended context to the last user message.");
        } else {
             console.warn("Could not find last user message or its content is not a string to append context.");
             // Fallback: Prepend as a system message if appending fails, though less ideal
             messagesWithContext.unshift({ role: 'system', content: retrievedContext });
        }
    }
    // --- End Modified Context Injection ---
    // --- End Manual RAG Context Injection ---

    const result = await streamText({
      model: azure(process.env.AZURE_DEPLOYMENT_NAME!),
      messages: messagesWithContext, // Use the potentially modified messages array
      system: `You are an insightful and accurate AI assistant whose primary responsibility is to generate nuanced, context-rich responses based exclusively on provided context documents (RAG). Your task is to interpret and synthesize information from these documents.

Instructions:

Contextual Accuracy:

Respond exclusively based on the provided context documents, typically marked with [Source ID: ...].

Never reference or rely on external knowledge outside the provided context.

Nuanced and Insightful Answers:

Provide nuanced responses by synthesizing relevant information from the documents.

Explicit Source Referencing:

Always explicitly cite your sources inline immediately after each referenced piece of information using the format [Source ID: ID].

When synthesizing across multiple documents, clearly attribute each piece of information to the correct source ID.

Avoiding Hallucinations:

If the provided context does not contain sufficient information to reliably answer a query, explicitly state: "I cannot answer this question based on the provided information."

Formatting and Clarity:

Structure your responses clearly using Markdown (bold, italics, bullet points, numbered lists) to enhance readability.

Be concise yet thorough—clearly communicate your interpretation of the source materials without unnecessary filler.`, // Simplified prompt, removed file naming convention, adjusted citation format
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
