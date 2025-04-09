import React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Message } from "ai";
import ProjectOverview from "./project-overview";
import { Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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
  // Fix spacing in paragraphs
  p: (props: any) => (
    <p className="my-1" {...props} />
  ),
};

interface MessageContainerProps {
  messages: Message[];
  error: string | null;
  toolCall: string | undefined;
  isLoading: boolean;
  showCitation: (id: string) => void;
  messagesEndRef: React.RefObject<HTMLDivElement>;
}

const MessageItem: React.FC<{
  message: Message;
  showCitation: (id: string) => void;
}> = React.memo(
  ({ message, showCitation }) => {
    const replaceCitationFlags = (response: string): JSX.Element => {
      // If no citations, just render the whole text as markdown
      if (!response.includes("[Source:")) {
        return (
          <ReactMarkdown 
            remarkPlugins={[remarkGfm]}
            components={MarkdownComponents}
          >
            {response}
          </ReactMarkdown>
        );
      }

      // Simple split approach that preserves text spacing
      const segments = response.split(/(\[Source: [^\]]+\])/g);
      const citationRegex = /\[Source: ([^\]]+)\]/;
      
      // Map citation IDs to numbers for consistent referencing
      const citationMapping: Record<string, number> = {};
      let citationIndex = 1;
      
      segments.forEach(segment => {
        const match = segment.match(citationRegex);
        if (match && match[1]) {
          const citationId = match[1];
          if (!(citationId in citationMapping)) {
            citationMapping[citationId] = citationIndex++;
          }
        }
      });
      
      // Render segments with citations as buttons
      return (
        <div className="prose prose-sm dark:prose-invert max-w-none">
          {segments.map((segment, index) => {
            const match = segment.match(citationRegex);
            
            if (match && match[1]) {
              // This is a citation
              const citationId = match[1];
              return (
                <button
                  key={`citation-${index}`}
                  onClick={() => showCitation(citationId)}
                  className="inline text-muted-foreground hover:text-primary"
                >
                  <span className="underline">[{citationMapping[citationId]}]</span>
                </button>
              );
            } else {
              // This is regular text
              return (
                <span key={`text-${index}`} className="inline">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={MarkdownComponents}
                  >
                    {segment}
                  </ReactMarkdown>
                </span>
              );
            }
          })}
        </div>
      );
    };

    return (
      <motion.div
        key={message.id}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        className={`max-w-3xl mx-auto px-4 flex ${
          message.role === "user" ? "justify-end" : "justify-start"
        }`}
      >
        <div
          className={`rounded-lg px-4 py-2 max-w-[85%] ${
            message.role === "user"
              ? "bg-primary text-primary-foreground"
              : "bg-muted"
          }`}
        >
          <div 
            className={message.role === "assistant" 
              ? "prose prose-sm dark:prose-invert max-w-none" 
              : "whitespace-pre-wrap text-primary-foreground"
            }
          >
            {message.role === "assistant" ? (
              replaceCitationFlags(message.content)
            ) : (
              <span>{message.content}</span>
            )}
          </div>
        </div>
      </motion.div>
    );
  },
  (prev, next) => prev.message == next.message
);

MessageItem.displayName = "MessageItem";

// Use React.memo to prevent unnecessary re-renders
const MessageContainer: React.FC<MessageContainerProps> = React.memo(
  ({ messages, error, toolCall, isLoading, showCitation, messagesEndRef }) => {
    return (
      <div className="flex-1 overflow-y-auto space-y-4 w-full">
        {messages.length === 0 && (
          <div className="flex p-2 overflow-y-auto mb-4 space-y-4 justify-center items-center">
            <ProjectOverview />
          </div>
        )}
        <AnimatePresence initial={false}>
          {messages.map(
            (message: Message) =>
              message.content && message.content.trim() !== "" && (
                <MessageItem
                  key={message.id}
                  message={message}
                  showCitation={showCitation}
                />
              )
          )}
        </AnimatePresence>

        {/* Error Banner */}
        {error && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="flex justify-center"
          >
            <div className="flex items-center gap-2 rounded-lg px-4 py-2 bg-red-500 text-white">
              <span>{error}</span>
            </div>
          </motion.div>
        )}

        {isLoading && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex justify-center"
          >
            <div className="flex items-center gap-2 rounded-lg px-4 py-2 bg-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>
                {toolCall === "getInformation"
                  ? "Getting information..."
                  : "Thinking..."}
              </span>
            </div>
          </motion.div>
        )}
        <div ref={messagesEndRef} />
      </div>
    );
  },
  (prev, next) =>
    prev.messages === next.messages &&
    prev.isLoading === next.isLoading &&
    prev.error === next.error
);

MessageContainer.displayName = "MessageContainer";

export default MessageContainer;
