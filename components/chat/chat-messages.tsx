import { Message } from "ai/react";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export default function ChatMessages({ messages }: { messages: Message[] }) {
  if (!messages.length) {
    return null;
  }

  return (
    <>
      {messages.map((message: Message, index: number) => {
        return (
          <div
            key={`message-${index}`}
            className={`flex items-end mb-4 ${message.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`relative rounded-lg px-4 py-2 max-w-lg lg:max-w-xl xl:max-w-2xl break-words ${message.role === "user" ? "bg-blue-600 text-white" : "bg-gray-200 text-gray-800"}`}
            >
              {message.role === "assistant" ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
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