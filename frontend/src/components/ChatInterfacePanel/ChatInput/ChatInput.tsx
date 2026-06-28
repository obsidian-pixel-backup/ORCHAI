import React, { useRef, useState, type ChangeEvent } from 'react';
import './ChatInput.css';

interface ChatInputProps {
  onSendMessage: (content: string, images: string[], documents: { name: string; content: string }[]) => void;
  isStreaming?: boolean;
  onStopGeneration?: () => void;
}

export function ChatInput({ onSendMessage, isStreaming, onStopGeneration }: ChatInputProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [inputValue, setInputValue] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);

  const handleContextClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files);
      setAttachedFiles((prev) => [...prev, ...newFiles]);
    }
    // Reset input so the same file can be selected again if needed
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const removeFile = (index: number) => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const readFileAsText = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target?.result as string);
      reader.onerror = (e) => reject(e);
      reader.readAsText(file);
    });
  };

  const readFileAsBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result as string;
        // Extract the raw base64 string from data URL
        const base64Data = result.split(',')[1];
        resolve(base64Data);
      };
      reader.onerror = (e) => reject(e);
      reader.readAsDataURL(file);
    });
  };

  const handleSend = async () => {
    if (!inputValue.trim() && attachedFiles.length === 0) return;

    let finalContent = inputValue.trim();
    const images: string[] = [];
    const documents: { name: string; content: string }[] = [];

    // Process attached files
    for (const file of attachedFiles) {
      const isImage = file.type.startsWith('image/') || file.name.match(/\.(jpg|jpeg|png)$/i);
      
      if (isImage) {
        try {
          const base64 = await readFileAsBase64(file);
          images.push(base64);
        } catch (err) {
          console.error("Failed to read image file:", err);
        }
      } else {
        // Assume text/md
        try {
          const text = await readFileAsText(file);
          documents.push({ name: file.name, content: text });
        } catch (err) {
          console.error("Failed to read text file:", err);
        }
      }
    }

    if (finalContent.trim() || images.length > 0 || documents.length > 0) {
      onSendMessage(finalContent, images, documents);
      setInputValue('');
      setAttachedFiles([]);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="chat-input-container">
      {attachedFiles.length > 0 && (
        <div className="file-preview-container">
          {attachedFiles.map((file, index) => (
            <div key={index} className="file-chip">
              <span className="file-name">{file.name}</span>
              <button 
                className="file-remove-btn" 
                onClick={() => removeFile(index)}
                title="Remove attachment"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="input-box">
        <button 
          className="context-btn" 
          onClick={handleContextClick}
          title="Add context (files, images)"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"></path>
          </svg>
        </button>
        <input 
          type="file" 
          ref={fileInputRef} 
          style={{ display: 'none' }} 
          multiple 
          accept=".jpg,.jpeg,.png,.txt,.md"
          onChange={handleFileChange}
        />
        <textarea 
          className="message-textarea" 
          placeholder="Message ORCHAI..."
          rows={1}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div className="input-actions" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {isStreaming && (
            <button className="stop-btn" title="Stop generation" onClick={onStopGeneration} style={{ color: '#ef4444', background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="6" y="6" width="12" height="12" rx="2"></rect>
              </svg>
            </button>
          )}
          <button className="send-btn" title={isStreaming ? "Queue message" : "Send message"} onClick={handleSend}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"></line>
              <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
