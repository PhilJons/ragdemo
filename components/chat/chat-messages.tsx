import { Message } from "ai/react";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Define the expected shape of a citation object (matching chat-citations.tsx)
interface Citation {
  id: string;
  text: string; // Content of the citation
  sourcefile: string; // Filename
  // Potentially other fields
}

// Function to handle citation clicks (placeholder)
// Now accepts the full citation object or relevant parts
const handleCitationClick = (citation: { id: string, sourcefile: string }) => {
  console.log(`Citation clicked: ID=${citation.id}, File=${citation.sourcefile}`);
  // TODO: Implement logic to open citation panel with citation data
};

// Custom component to render citations as buttons
const CitationComponent = ({ node, citations }: { node: any, citations: Citation[] | undefined }) => {
  // Add extensive logging here
  console.log("CitationComponent received node:", node);
  console.log("CitationComponent received citations:", citations);

  if (!node || !node.children || !node.children[0] || typeof node.children[0].value !== 'string') {
    console.log("CitationComponent: Invalid node structure");
    return <span></span>; // Return empty span if node structure is unexpected
  }
  const text = node.children[0].value as string;
  console.log("CitationComponent processing text:", text);
  const match = text.match(/\[Source ID: (.*?)\]/);
  console.log("CitationComponent regex match:", match);

  if (match && match[1] && citations) {
    const sourceId = match[1];
    console.log("CitationComponent found sourceId:", sourceId);
    // Find the citation object that matches the sourceId
    const citation = citations.find(c => c.id === sourceId);
    console.log("CitationComponent found citation object:", citation);

    if (citation) {
      // Extract filename from sourcefile path if needed
      const fileName = citation.sourcefile.split('/').pop() || citation.sourcefile;
      console.log("CitationComponent rendering button for fileName:", fileName);
      return (
        <button
          onClick={() => handleCitationClick({ id: citation.id, sourcefile: citation.sourcefile })}
          className="inline-block bg-gray-300 dark:bg-gray-700 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded text-sm hover:bg-gray-400 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 mx-1 align-middle"
          title={`Source: ${citation.sourcefile}`} // Tooltip shows full path
        >
          Source [{fileName}]
        </button>
      );
    } else {
       console.log("CitationComponent: Citation data not found for ID:", sourceId);
       // Fallback if citation data not found for this ID
       return (
         <span className="inline-block bg-red-200 text-red-800 px-2 py-0.5 rounded text-sm mx-1 align-middle" title={`Citation data not found for ID: ${sourceId}`}>
           Source [?]
         </span>
       );
    }
  }
  // Render as plain text if not a citation pattern or no citations data
  console.log("CitationComponent rendering plain text:", text);
  return <span>{text}</span>;
};

export default function ChatMessages({ messages }: { messages: Message[] }) {
  if (!messages.length) {
    return null;
  }

  return (
    <>
      {messages.map((message: Message, index: number) => {
        // Correctly access the nested sourceDocuments array from message.data
        const citations = (message.data as { sourceDocuments?: Citation[] })?.sourceDocuments;

        // Custom renderer for ReactMarkdown, passing citations
        const renderers = {
          text: (props: any) => <CitationComponent node={props.node} citations={citations} />,
        };

        return (
          <div
            key={`message-${index}`}
            className={`flex items-end mb-4 ${message.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`relative rounded-lg px-4 py-2 max-w-lg lg:max-w-xl xl:max-w-2xl break-words ${message.role === "user" ? "bg-blue-600 text-white" : "bg-gray-200 text-gray-800"}`}
            >
              {message.role === "assistant" ? (
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={renderers} // Use custom renderers with citation data
                >
                  {message.content}
                </ReactMarkdown>
              ) : (
                message.content
              )}
            </div>
          </div>
        );
      })}
    </>
  );
} 