import { marked } from 'marked';
const txt = `## 📅 Tuesday — June 30\n| | Details |\n|-|`;
console.log(JSON.stringify(marked.lexer(txt), null, 2));
