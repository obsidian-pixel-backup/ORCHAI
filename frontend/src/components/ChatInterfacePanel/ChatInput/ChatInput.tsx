import React, { useRef, useState, useEffect, useCallback, type ChangeEvent } from 'react';
import './ChatInput.css';

interface ChatInputProps {
  onSendMessage: (content: string, images: string[], documents: { name: string; content: string }[]) => void;
  isStreaming?: boolean;
  onStopGeneration?: () => void;
  sendOnEnter?: boolean;
}

export function ChatInput({ onSendMessage, isStreaming, onStopGeneration, sendOnEnter }: ChatInputProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [inputValue, setInputValue] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [showPlusMenu, setShowPlusMenu] = useState(false);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);

  interface Skill {
    id: string;
    label: string;
    icon: string;
    description: string;
  }

  // Functional skills are fetched from the backend registry (backend/skills.py).
  // Fallback to a static list if the backend is unreachable.
  const FALLBACK_SKILLS: Skill[] = [
    { id: 'code_review', label: 'Code review', icon: '🔍', description: 'Rigorous bug & quality audit' },
    { id: 'security_audit', label: 'Security audit', icon: '🛡️', description: 'Threat & vulnerability scan' },
    { id: 'deep_research', label: 'Deep research', icon: '🔬', description: 'Multi-source cited research' },
    { id: 'doc_writer', label: 'Documentation', icon: '📝', description: 'Generate docs from code' },
  ];
  const [skills, setSkills] = useState<Skill[]>(FALLBACK_SKILLS);

  useEffect(() => {
    let cancelled = false;
    fetch('http://127.0.0.1:8000/api/chat/skills')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data?.skills?.length) {
          setSkills(data.skills);
        }
      })
      .catch(() => {
        /* keep fallback skills */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handlePlusClick = () => {
    setShowPlusMenu(!showPlusMenu);
  };

  const handleSkillSelect = (skillName: string) => {
    if (!selectedSkills.includes(skillName)) {
      setSelectedSkills(prev => [...prev, skillName]);
    }
    setShowPlusMenu(false);
  };

  const removeSkill = (index: number) => {
    setSelectedSkills(prev => prev.filter((_, i) => i !== index));
  };

  // ── Voice dictation state (MediaRecorder + backend Whisper, live segments) ──
  const [isListening, setIsListening] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const segmentIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isStoppingRef = useRef(false);       // true when user clicked stop (final segment)
  const accumulatedTextRef = useRef('');      // all transcribed text so far
  const mimeTypeRef = useRef('');
  const isListeningRef = useRef(false);

  // Store onSendMessage in a ref so the transcription callback always has the latest
  const onSendMessageRef = useRef(onSendMessage);
  useEffect(() => { onSendMessageRef.current = onSendMessage; }, [onSendMessage]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (segmentIntervalRef.current) clearInterval(segmentIntervalRef.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  /** Send an audio blob to the backend and return the transcribed text. */
  const transcribeBlob = useCallback(async (audioBlob: Blob): Promise<string> => {
    if (audioBlob.size < 100) return '';
    try {
      const formData = new FormData();
      formData.append('audio', audioBlob, 'recording.webm');
      const response = await fetch('http://127.0.0.1:8000/api/speech/transcribe', {
        method: 'POST',
        body: formData,
      });
      if (!response.ok) return '';
      const data = await response.json();
      return data.text?.trim() ?? '';
    } catch (err) {
      console.error('Transcription error:', err);
      return '';
    }
  }, []);

  /** Create and start a continuous MediaRecorder on the existing stream. */
  const startRecorder = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;

    audioChunksRef.current = [];

    // Keep track of transcription sequence to ignore outdated responses
    let transcribingSequence = 0;

    const recorder = new MediaRecorder(
      stream,
      mimeTypeRef.current ? { mimeType: mimeTypeRef.current } : undefined,
    );

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunksRef.current.push(event.data);
        
        // Background live transcription (don't block)
        if (!isStoppingRef.current) {
          transcribingSequence++;
          const currentSeq = transcribingSequence;
          const blob = new Blob(audioChunksRef.current, { type: mimeTypeRef.current || 'audio/webm' });
          transcribeBlob(blob).then(text => {
            // Only update if this is the latest requested transcription and we are still listening
            if (currentSeq === transcribingSequence && isListeningRef.current && text) {
              accumulatedTextRef.current = text;
              setInputValue(text);
            }
          }).catch(err => console.error("Live transcription error:", err));
        }
      }
    };

    recorder.onstop = async () => {
      transcribingSequence++; // Invalidate any pending live transcriptions
      const chunks = audioChunksRef.current;
      audioChunksRef.current = [];
      const blob = new Blob(chunks, { type: mimeTypeRef.current || 'audio/webm' });

      // Transcribe the full blob
      const segmentText = await transcribeBlob(blob);
      if (segmentText) {
        accumulatedTextRef.current = segmentText;
      }

      // Done — auto-send the full accumulated text
      const finalText = accumulatedTextRef.current.trim();
      if (finalText) {
        onSendMessageRef.current(finalText, [], []);
        setInputValue('');
      }
      
      // Release mic
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
      accumulatedTextRef.current = '';
      setIsTranscribing(false);
    };

    mediaRecorderRef.current = recorder;
    recorder.start(1000);
  }, [transcribeBlob]);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: { 
          echoCancellation: true, 
          noiseSuppression: true, 
          autoGainControl: true 
        } 
      });
      streamRef.current = stream;
      audioChunksRef.current = [];
      accumulatedTextRef.current = '';
      isStoppingRef.current = false;
      isListeningRef.current = true;

      // Determine mime type once
      mimeTypeRef.current = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : '';

      // Start the continuous recording
      startRecorder();
      setIsListening(true);
    } catch (err) {
      console.error('Microphone access error:', err);
      alert('Could not access microphone. Please check your permissions.');
    }
  }, [startRecorder]);

  const stopRecording = useCallback(() => {
    if (segmentIntervalRef.current) {
      clearInterval(segmentIntervalRef.current);
      segmentIntervalRef.current = null;
    }

    isStoppingRef.current = true;
    isListeningRef.current = false;
    setIsListening(false);
    setIsTranscribing(true);

    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state === 'recording') {
      recorder.stop();
    } else {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
      const finalText = accumulatedTextRef.current.trim();
      if (finalText) {
        onSendMessageRef.current(finalText, [], []);
        setInputValue('');
      }
      accumulatedTextRef.current = '';
      setIsTranscribing(false);
    }
  }, []);

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopRecording();
    } else {
      startRecording();
    }
  }, [isListening, startRecording, stopRecording]);

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
    if (!inputValue.trim() && attachedFiles.length === 0 && selectedSkills.length === 0) return;

    let finalContent = inputValue.trim();
    if (selectedSkills.length > 0) {
      const skillsStr = selectedSkills.map(s => `[Skill: ${s}]`).join(' ');
      finalContent = finalContent ? `${skillsStr}\n\n${finalContent}` : skillsStr;
    }

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
      setSelectedSkills([]);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const enterToSend = sendOnEnter !== false; // defaults to true if undefined
    
    if (e.key === 'Enter') {
      if (enterToSend && !e.shiftKey) {
        e.preventDefault();
        if (!isListening && !isTranscribing) {
          handleSend();
        }
      } else if (!enterToSend && (e.ctrlKey || e.metaKey || e.shiftKey)) {
        // If sendOnEnter is false, we use Enter for newlines, and Shift+Enter or Ctrl+Enter for sending.
        e.preventDefault();
        if (!isListening && !isTranscribing) {
          handleSend();
        }
      }
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
          {selectedSkills.map((skill, index) => (
            <div key={`skill-${index}`} className="file-chip skill-chip">
              <span className="file-name">{skill}</span>
              <button 
                className="file-remove-btn" 
                onClick={() => removeSkill(index)}
                title="Remove skill"
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
        <div className="plus-menu-container" style={{ position: 'relative' }}>
          <button 
            className={`plus-btn ${showPlusMenu ? 'active' : ''}`}
            onClick={handlePlusClick}
            title="Add skills or files"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
          </button>
          
          {showPlusMenu && (
            <div className="plus-menu-dropdown">
              <div className="plus-menu-item" onClick={() => { handleContextClick(); setShowPlusMenu(false); }}>
                <span className="plus-menu-icon">📎</span>
                <div className="plus-menu-text">
                  <span className="plus-menu-title">Upload files</span>
                </div>
              </div>
              <div className="plus-menu-divider"></div>
              {skills.map(skill => (
                <div key={skill.id} className="plus-menu-item" onClick={() => handleSkillSelect(skill.label)}>
                  <span className="plus-menu-icon">{skill.icon}</span>
                  <div className="plus-menu-text">
                    <span className="plus-menu-title">{skill.label}</span>
                    {skill.description && <span className="plus-menu-desc">{skill.description}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        
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
          placeholder={isListening ? '🎙️ Listening... click mic to stop' : isTranscribing ? '⏳ Transcribing...' : 'Message ORCHAI...'}
          rows={1}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button
          className={`mic-btn${isListening ? ' mic-btn--active' : ''}${isTranscribing ? ' mic-btn--transcribing' : ''}`}
          onClick={toggleListening}
          title={isListening ? 'Stop recording & send' : isTranscribing ? 'Transcribing...' : 'Voice dictation'}
          type="button"
          disabled={isTranscribing}
        >
          {isTranscribing ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mic-spinner">
              <circle cx="12" cy="12" r="10" strokeDasharray="31.4 31.4" strokeLinecap="round"></circle>
            </svg>
          ) : isListening ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none">
              <rect x="6" y="6" width="12" height="12" rx="2"></rect>
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
              <line x1="12" y1="19" x2="12" y2="23"></line>
              <line x1="8" y1="23" x2="16" y2="23"></line>
            </svg>
          )}
        </button>
        <div className="input-actions" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {isStreaming && (
            <div className="working-indicator" title="Model is working">
              <span className="dot"></span>
              <span className="dot"></span>
              <span className="dot"></span>
            </div>
          )}
          {isStreaming && (
            <button className="stop-btn" title="Stop generation" onClick={onStopGeneration} style={{ color: '#ef4444', background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="6" y="6" width="12" height="12" rx="2"></rect>
              </svg>
            </button>
          )}
          {!isListening && !isTranscribing && (
            <button className="send-btn" title={isStreaming ? "Queue message" : "Send message"} onClick={handleSend}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13"></line>
                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
