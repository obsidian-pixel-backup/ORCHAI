import React, { useState } from 'react';
import * as markedModule from 'marked';
import './MarkdownRenderer.css';

// Safe resolver to handle bundler/CommonJS/ESM interop resolution anomalies
const marked = (markedModule as any).marked || (markedModule as any).default?.marked || (markedModule as any).default || markedModule;

interface CodeBlockCardProps {
  code: string;
  language: string;
}

export function CodeBlockCard({ code, language }: CodeBlockCardProps) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy: ', err);
    }
  };

  return (
    <div className={`code-block-card ${expanded ? 'expanded' : 'collapsed'}`}>
      <div className="code-block-header clickable" onClick={() => setExpanded(!expanded)}>
        <span className="code-block-lang" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <svg className={`collapse-chevron ${expanded ? 'expanded' : ''}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
          <span>{language}</span>
        </span>
        <button className="code-block-copy-btn" onClick={handleCopy} aria-label="Copy code block">
          {copied ? (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="copy-icon-success">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
              <span className="copy-success-text">Copied!</span>
            </>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      {expanded && (
        <div className="code-block-body">
          <pre>
            <code>{code}</code>
          </pre>
        </div>
      )}
    </div>
  );
}

export function ToolExecutionCard({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  
  let data;
  try {
    data = JSON.parse(code);
  } catch(e) {
    return <div className="code-block-card error">Invalid tool execution data</div>;
  }

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const copyText = `Tool Executed: ${data.name}\n\nInput:\n${JSON.stringify(data.input, null, 2)}\n\nOutput:\n${data.output}`;
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy: ', err);
    }
  };

  return (
    <div className={`code-block-card tool-execution-card ${expanded ? 'expanded' : 'collapsed'}`}>
      <div className="code-block-header clickable" onClick={() => setExpanded(!expanded)}>
        <span className="code-block-lang" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <svg className={`collapse-chevron ${expanded ? 'expanded' : ''}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: '4px' }}>
            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path>
          </svg>
          <span>TOOL: {data.name}</span>
        </span>
        <button className="code-block-copy-btn" onClick={handleCopy} aria-label="Copy tool execution details">
          {copied ? (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="copy-icon-success">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
              <span className="copy-success-text">Copied!</span>
            </>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      {expanded && (
        <div className="tool-execution-body-new">
          <div className="tool-section">
            <div className="tool-section-label">Input:</div>
            <pre className="tool-code-block">{JSON.stringify(data.input, null, 2)}</pre>
          </div>
          <div className="tool-section">
            <div className="tool-section-label">Output:</div>
            <pre className="tool-code-block">{data.output}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

function renderInlineTokens(tokens?: any[]): React.ReactNode {
  if (!tokens) return null;
  return tokens.map((token: any, i: number) => {
    switch (token.type) {
      case 'strong':
        return <strong key={i}>{renderInlineTokens(token.tokens)}</strong>;
      case 'em':
        return <em key={i}>{renderInlineTokens(token.tokens)}</em>;
      case 'codespan':
        return <code key={i} className="inline-code">{token.text}</code>;
      case 'del':
        return <del key={i}>{renderInlineTokens(token.tokens)}</del>;
      case 'br':
        return <br key={i} />;
      case 'link':
        return (
          <a key={i} href={token.href} target="_blank" rel="noopener noreferrer" className="markdown-link">
            {renderInlineTokens(token.tokens)}
          </a>
        );
      case 'image':
        return <img key={i} src={token.href} alt={token.text} title={token.title} className="markdown-image" />;
      case 'text':
        return token.tokens ? <span key={i}>{renderInlineTokens(token.tokens)}</span> : token.text;
      default:
        return token.raw;
    }
  });
}

function renderBlockToken(token: any, index: number): React.ReactNode {
  switch (token.type) {
    case 'space':
      return null;
    case 'heading': {
      const Tag = `h${Math.min(6, Math.max(1, token.depth))}` as any;
      return <Tag key={index}>{renderInlineTokens(token.tokens)}</Tag>;
    }
    case 'paragraph':
      return <p key={index}>{renderInlineTokens(token.tokens)}</p>;
    case 'blockquote':
      return (
        <blockquote key={index}>
          {token.tokens ? token.tokens.map((t: any, idx: number) => renderBlockToken(t, idx)) : token.text}
        </blockquote>
      );
    case 'hr':
      return <hr key={index} />;
    case 'list': {
      const Tag = token.ordered ? 'ol' : 'ul';
      return (
        <Tag key={index} start={token.ordered && token.start ? token.start : undefined} className="markdown-list">
          {token.items.map((item: any, idx: number) => (
            <li key={idx} className={item.task ? 'task-item' : ''}>
              {item.task ? (
                <div className="task-list-item">
                  <input type="checkbox" checked={item.checked} readOnly className="task-checkbox" />
                  <div className="task-text">
                    {item.tokens ? item.tokens.map((t: any, sIdx: number) => renderBlockToken(t, sIdx)) : null}
                  </div>
                </div>
              ) : (
                <>
                  {item.tokens ? item.tokens.map((t: any, sIdx: number) => renderBlockToken(t, sIdx)) : null}
                </>
              )}
            </li>
          ))}
        </Tag>
      );
    }
    case 'text':
      return <span key={index}>{renderInlineTokens(token.tokens)}</span>;
    case 'code':
      if (token.lang === 'tool_execution') {
        return <ToolExecutionCard key={index} code={token.text} />;
      }
      return (
        <CodeBlockCard
          key={index}
          code={token.text}
          language={token.lang || 'plaintext'}
        />
      );
    case 'table':
      return (
        <div key={index} className="table-container">
          <table className="markdown-table">
            <thead>
              <tr>
                {token.header.map((cell: any, idx: number) => (
                  <th key={idx} style={{ textAlign: cell.align || 'left' }}>
                    {renderInlineTokens(cell.tokens)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {token.rows.map((row: any, rIdx: number) => (
                <tr key={rIdx}>
                  {row.map((cell: any, cIdx: number) => (
                    <td key={cIdx} style={{ textAlign: token.header[cIdx]?.align || 'left' }}>
                      {renderInlineTokens(cell.tokens)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'html':
      return <div key={index} className="html-raw">{token.text}</div>;
    default:
      return <div key={index} className="markdown-raw">{token.raw}</div>;
  }
}

interface MarkdownRendererProps {
  content: string;
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  try {
    const tokens = marked.lexer(content);
    return (
      <div className="markdown-container">
        {tokens.map((token: any, index: number) => renderBlockToken(token, index))}
      </div>
    );
  } catch (error) {
    console.error('Error rendering markdown: ', error);
    // Safe fallback to raw formatted text
    return (
      <div className="markdown-fallback">
        {content.split('\n').map((line, index, arr) => (
          <span key={index}>
            {line}
            {index < arr.length - 1 && <br />}
          </span>
        ))}
      </div>
    );
  }
}
