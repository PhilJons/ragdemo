import React, { useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Send } from "lucide-react";

interface ChatInputProps {
  input: string;
  onInputChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onSubmit: (event: React.FormEvent) => void;
  isLoading: boolean;
  renderDeepAnalysisToggle?: React.ReactNode;
}

const ChatInput: React.FC<ChatInputProps> = ({ input, onInputChange, onSubmit, isLoading, renderDeepAnalysisToggle }) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const scrollHeight = textareaRef.current.scrollHeight;
      const maxHeight = 6 * 24; // 6 rows, 24px per row (adjust if needed)
      textareaRef.current.style.height = Math.min(scrollHeight, maxHeight) + 'px';
    }
  }, [input]);

  // Handle Enter/Shift+Enter for textarea
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      // Only submit if not loading and input is not empty
      if (!isLoading && input.trim() !== '') {
        // Create a synthetic event for form submit
        const form = e.currentTarget.form;
        if (form) {
          const submitEvent = new Event('submit', { cancelable: true, bubbles: true });
          form.dispatchEvent(submitEvent);
        }
      }
    }
  };

  return (
    <div className="w-full max-w-3xl mx-auto flex justify-center mb-6">
      <div className="border border-gray-300 rounded-lg bg-background p-2 w-full">
        <form onSubmit={onSubmit} className="flex gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={onInputChange as any}
            onKeyDown={handleKeyDown}
            placeholder="Send a message..."
            className="flex-1 text-base resize-none bg-transparent outline-none border-none focus:ring-0 focus:outline-none min-h-[24px] max-h-[144px] py-1 px-2 rounded"
            rows={1}
            maxLength={2000}
            spellCheck={true}
            autoComplete="off"
            style={{ lineHeight: '24px' }}
          />
          <Button
            disabled={isLoading || !input}
            type="submit"
            className="flex-shrink-0 p-2 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-white"
          >
            <Send className="h-5 w-5" />
          </Button>
        </form>
        {renderDeepAnalysisToggle && (
          <div className="dark:text-white [&_.switch]:dark:bg-white [&_.switch]:dark:border-white [&_.switch]:dark:text-gray-900">{renderDeepAnalysisToggle}</div>
        )}
      </div>
    </div>
  );
};

export default ChatInput;
