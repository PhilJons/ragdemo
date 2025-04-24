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
  showCitation: (id: string) => void;
  messagesEndRef: React.RefObject<HTMLDivElement>;
  documentMap: Record<string, { text: string; sourcefile: string }>;
  scrollContainerRef: React.RefObject<HTMLDivElement>;
  onScroll: () => void;
}

// Custom components for Markdown rendering using standard Tailwind
const MarkdownComponents = {
  a: (props: any) => (
    <a {...props} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-white hover:underline citation" style={{ color: 'var(--link-color, white) !important' }} />
  ),
  p: (props: any) => <p className="mb-4" style={{ color: 'inherit' }} {...props} />,
  ul: (props: any) => <ul className="list-disc pl-5 my-2" style={{ color: 'inherit' }} {...props} />,
  ol: (props: any) => <ol className="list-decimal pl-5 my-2" style={{ color: 'inherit' }} {...props} />,
  li: (props: any) => <li className="my-1" style={{ color: 'inherit' }} {...props} />,
  blockquote: (props: any) => (
    <blockquote className="pl-4 border-l-4 border-gray-300 dark:border-gray-600 italic my-3 text-muted-foreground" style={{ color: 'inherit' }} {...props} />
  ),
  strong: (props: any) => (
    <strong className="font-semibold text-gray-900 dark:text-white" style={{ color: 'white !important', fontWeight: '500' }} {...props} />
  ),
  em: (props: any) => (
    <em className="italic text-gray-900 dark:text-white" style={{ color: 'white !important' }} {...props} />
  ),
  code: ({ node, inline, className, children, ...props }: any) => {
    const match = /language-(\w+)/.exec(className || "");
    if (!inline && match) {
      return (
        <pre className="p-2 rounded bg-gray-100 dark:bg-gray-800 overflow-x-auto my-3" style={{ color: 'inherit' }}>
          <code className={className} {...props} style={{ color: 'inherit' }}>{children}</code>
        </pre>
      );
    }
    return (
      <code
        className={inline ? "px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-sm" : "block p-2 rounded bg-gray-100 dark:bg-gray-800 overflow-x-auto"}
        {...props}
        style={{ color: 'inherit' }}
      >
        {children}
      </code>
    );
  },
};

const MessageItem: React.FC<{
  message: Message;
  showCitation: (id: string) => void;
  documentMap: Record<string, { text: string; sourcefile: string }>;
}> = React.memo(
  ({ message, showCitation, documentMap }) => {
    const replaceCitationFlags = (response: string): JSX.Element => {
      // Updated pattern to handle new citation format [Source ID: <id>]
      const citationPattern = "[Source ID:";
      if (!response.includes(citationPattern)) {
        return (
          <div className="text-foreground dark:text-gray-100 [&_a]:!text-blue-600 [&_a]:!dark:text-white [&_strong]:!text-gray-900 [&_strong]:!dark:text-white [&_em]:!text-gray-900 [&_em]:!dark:text-white" style={{ color: 'inherit' }}>
            <style>{`
              [data-theme='dark'] a, .dark a { color: white !important; }
              [data-theme='dark'] strong, .dark strong { color: white !important; }
            `}</style>
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={MarkdownComponents}>
              {response}
            </ReactMarkdown>
          </div>
        );
      }

      // Split response into segments that include citation tokens
      const segments = response.split(/(\[Source ID: [^\]]+\])/g);
      const citationRegex = /\[Source ID: ([^\]]+)\]/;
      
      return (
        <div className="prose prose-sm max-w-none text-foreground dark:text-gray-100 [&_a]:!text-blue-600 [&_a]:!dark:text-white [&_strong]:!text-gray-900 [&_strong]:!dark:text-white [&_em]:!text-gray-900 [&_em]:!dark:text-white">
          {segments.map((segment, index) => {
            const match = segment.match(citationRegex);
            if (match && match[1]) {
              const citationId = match[1];
              const fileName = documentMap[citationId]?.sourcefile?.split('/')?.pop() || citationId;
              return (
                <button
                  key={`citation-${index}`}
                  onClick={() => showCitation(citationId)}
                  className="inline underline text-blue-600 dark:text-white hover:text-primary dark:hover:text-gray-300 citation"
                  style={{ fontWeight: 'bold' }}
                >
                  <span>Source [{fileName}]</span>
                </button>
              );
            }
            return (
              <span key={`text-${index}`} className="inline [&_a]:!text-blue-600 [&_a]:!dark:text-white [&_strong]:!text-gray-900 [&_strong]:!dark:text-white [&_em]:!text-gray-900 [&_em]:!dark:text-white">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={MarkdownComponents}>
                  {segment}
                </ReactMarkdown>
              </span>
            );
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
          className={`rounded-lg px-4 py-2 max-w-[85%] ${ // Use standard Tailwind classes
            message.role === "user"
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-foreground dark:bg-gray-800 dark:text-gray-100"
          }`}
        >
          {/* Render content directly, inheriting text color from parent */} 
          {message.role === "assistant" ? (
            replaceCitationFlags(message.content)
          ) : (
            <span>{message.content}</span>
          )}
        </div>
      </motion.div>
    );
  },
  (prev, next) => prev.message == next.message && prev.documentMap === next.documentMap
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
