import React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Message } from "ai";
import ProjectOverview from "./project-overview";
import { Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MessageContainerProps {
  messages: Message[];
  error: string | null;
  toolCall: string | undefined;
  isLoading: boolean;
  showCitation: (citation: { id: string; text: string; sourcefile: string }) => void;
  messagesEndRef: React.RefObject<HTMLDivElement>;
  documentMap: Record<string, { text: string; sourcefile: string }>;
  scrollContainerRef: React.RefObject<HTMLDivElement>;
  onScroll: () => void;
}

// Custom components for Markdown rendering using standard Tailwind
const MarkdownComponents = {
  a: (props: any) => (
    <a {...props} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline" style={{ color: 'inherit' }} />
  ),
  code: ({ node, inline, className, children, ...props }: any) => {
    const match = /language-(\w+)/.exec(className || "");
    return !inline && match ? (
      <pre className="p-2 rounded bg-gray-100 dark:bg-gray-800 overflow-x-auto" style={{ color: 'inherit' }}>
        <code className={className} {...props} style={{ color: 'inherit' }}>{children}</code>
      </pre>
    ) : (
      <code
        className={
          inline
            ? "px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-sm"
            : "block p-2 rounded bg-gray-100 dark:bg-gray-800 overflow-x-auto"
        }
        {...props}
        style={{ color: 'inherit' }}
      >
        {children}
      </code>
    );
  },
  blockquote: (props: any) => (
    <blockquote
      className="pl-4 border-l-4 border-gray-300 dark:border-gray-500 italic text-gray-800 dark:text-gray-100"
      style={{ color: 'inherit' }}
      {...props}
    />
  ),
  table: (props: any) => (
    <div className="overflow-x-auto my-4">
      <table className="min-w-full border-collapse" {...props} />
    </div>
  ),
  th: (props: any) => (
    <th className="bg-gray-100 text-gray-900 border border-gray-300 dark:border-gray-600 px-4 py-2 text-left font-semibold" {...props} />
  ),
  td: (props: any) => (
    <td
      className="border border-gray-300 dark:border-gray-600 px-4 py-2 text-gray-900 dark:text-white"
      style={{ color: 'inherit' }}
      {...props}
    />
  ),
  p: (props: any) => <p style={{ color: 'inherit' }} {...props} />,
  h1: (props: any) => (
    <h1 className="font-bold text-xl mt-6 mb-4" style={{ color: 'inherit' }} {...props} />
  ),
  h2: (props: any) => (
    <h2 className="font-bold text-lg mt-5 mb-3" style={{ color: 'inherit' }} {...props} />
  ),
  h3: (props: any) => (
    <h3 className="font-bold text-md mt-4 mb-2" style={{ color: 'inherit' }} {...props} />
  ),
  ul: (props: any) => (
    <ul className="list-disc pl-5 my-2" style={{ color: 'inherit' }} {...props} />
  ),
  ol: (props: any) => (
    <ol className="list-decimal pl-5 my-2" style={{ color: 'inherit' }} {...props} />
  ),
  li: (props: any) => (
    <li className="my-1" style={{ color: 'inherit' }} {...props} />
  ),
};

const MessageItem: React.FC<{
  message: Message;
  showCitation: (citation: { id: string; text: string; sourcefile: string }) => void;
  documentMap: Record<string, { text: string; sourcefile: string }>;
}> = React.memo(
  ({ message, showCitation, documentMap }) => {
    const replaceCitationFlags = (response: string): JSX.Element => {
      const citationRegex = /\[Source ID: (.*?)\]/g;

      // Split the response into segments, removing the citation pattern from the Markdown text
      const segments = response.split(citationRegex);
      const elements: JSX.Element[] = [];
      let citationIndex = 0;

      for (let i = 0; i < segments.length; i++) {
        if (i % 2 === 0) {
          // Only render non-empty text segments
          if (segments[i] && segments[i].length > 0) {
            elements.push(
              <span key={`text-${i}`} className="inline [&_a]:!text-blue-600 [&_a]:!dark:text-white [&_strong]:!text-gray-900 [&_strong]:!dark:text-white [&_em]:!text-gray-900 [&_em]:!dark:text-white">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={MarkdownComponents}>
                  {segments[i].replace(/\[.*?\]/g, '')}
                </ReactMarkdown>
              </span>
            );
          }
        } else {
          // Only render the custom citation <span>, do not let Markdown see the citation pattern
          const citationId = segments[i];
          const citationData = documentMap[citationId];
          const sourcefile = citationData?.sourcefile || 'Unknown File';
          const displayFilename = sourcefile.split('/').pop() || sourcefile;

          if (citationData) {
            elements.push(
              <span
                key={`citation-${citationIndex++}`}
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  showCitation({ id: citationId, ...citationData });
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    showCitation({ id: citationId, ...citationData });
                  }
                }}
                className="inline underline text-blue-600 dark:text-white hover:text-primary dark:hover:text-gray-300 citation font-medium px-1 rounded-sm bg-blue-100 dark:bg-blue-900/50 transition-colors cursor-pointer"
                title={`Source: ${sourcefile} (ID: ${citationId})`}
              >
                [{displayFilename}]
              </span>
            );
          } else {
            elements.push(
              <span key={`missing-citation-${citationIndex++}`} title={`Citation ID ${citationId} not found in document map.`} className="inline text-red-500 font-semibold">
                [Source ID: {citationId}]
              </span>
            );
          }
        }
      }

      return (
        <div className="prose prose-sm max-w-none text-foreground dark:text-gray-100 [&_a]:!text-blue-600 [&_a]:!dark:text-white [&_strong]:!text-gray-900 [&_strong]:!dark:text-white [&_em]:!text-gray-900 [&_em]:!dark:text-white">
          {elements}
        </div>
      );
    };

    return (
      <motion.div
        key={message.id}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        className={`max-w-3xl mx-auto px-4 flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
      >
        <div
          className={`rounded-lg px-4 py-2 max-w-[85%] ${
            message.role === "user"
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-foreground dark:bg-gray-800 dark:text-gray-100"
          }`}
        >
          {message.role === "assistant" ? (
            replaceCitationFlags(message.content)
          ) : (
            <span>{message.content}</span>
          )}
        </div>
      </motion.div>
    );
  },
  (prev, next) => prev.message.id === next.message.id && prev.documentMap === next.documentMap
);

MessageItem.displayName = "MessageItem";

const MessageContainer: React.FC<MessageContainerProps> = React.memo(
  ({ messages, error, toolCall, isLoading, showCitation, messagesEndRef, documentMap, scrollContainerRef, onScroll }) => {
    return (
      <div
        ref={scrollContainerRef}
        onScroll={onScroll}
        className="flex-1 overflow-y-auto space-y-4 w-full"
      >
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
                  documentMap={documentMap}
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
            <div className="flex items-center gap-2 rounded-lg px-4 py-2 bg-muted dark:bg-gray-800 text-foreground dark:text-gray-100">
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
    prev.error === next.error &&
    prev.documentMap === next.documentMap
);

MessageContainer.displayName = "MessageContainer";

export default MessageContainer;
