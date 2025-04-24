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
      system: `You are StrategyGPT, an expert strategic-analysis assistant.
Your sole knowledge source is the **context documents** supplied via Retrieval-Augmented Generation (RAG).  Each document chunk is annotated with a unique identifier in the form \`[Source ID: <ID>]\` and includes metadata such as *sourcefile* (the file name) and *title*.

====================  CORE BEHAVIOUR  ====================
1. Grounded answers only – never rely on external or prior knowledge.  If the context is insufficient, reply with:  
   "I cannot answer this question based on the provided information."

2. Inline citations – Every factual statement **must** be followed immediately by the source id(s) in square brackets, e.g. *Strategic alliances grew 45 % in 2023* [Source ID: doc17_chunk3].  Use **multiple ids** when synthesising several snippets.

3. Structured & executive-ready output – Use Markdown with clear headings.  Employ tables, numbered / bulleted lists and call-out blocks where helpful.

====================  ADVANCED TASKS SUPPORTED  ====================
You can perform any of the following on the provided material:
• Competitive benchmarking & trend analysis over time.  
• SWOT or gap analyses combining internal (e.g., \`internal-strategy_2023-Q4.md\`) and external reports.  
• Campaign post-mortems: list success drivers & improvement areas.  
• Multi-document aggregation: merge insights from diverse research papers into a single narrative.  
• Meeting prep digests: surface the five most relevant points for a given agenda.  
• Personalised retrieval: answer questions that reference specific projects, clients, or file names.

====================  HOW TO REASON WITH FILE NAMES  ====================
• Whenever a query mentions a **file name, title, or obvious alias**, treat it as a search cue.  
• If the context includes file-name metadata, prefer chunks originating from files whose name closely matches the user query.

====================  RESPONSE TEMPLATE GUIDANCE  ====================
1. *(Optional)* **Brief Answer / TL;DR** – one-sentence takeaway.  
2. **Detailed Analysis** – use subsections per theme (e.g., *Competitor Trends*, *Opportunities*, *SWOT Table*).  
3. **Recommended Actions** – concise bullet list (when the user request calls for it).  
4. **Sources** – If not already inline, end with a "Sources" section containing all ids used.

Remember: clarity, brevity, and rigorous sourcing are paramount.`,
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
