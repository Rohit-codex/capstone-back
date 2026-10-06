import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { FiDownload, FiFileText, FiUser } from 'react-icons/fi';
import { GiGavel } from 'react-icons/gi';
export default function ChatMessage({ message }) {
  const isUser = message.role === 'user'; const downloadUrl = message.file?.fileUrl || message.document?.downloadUrl; const fileName = message.file?.fileName || message.document?.fileName;
  return <article className={`chat-message ${isUser ? 'from-user' : 'from-assistant'}`}><div className="message-avatar">{isUser ? <FiUser /> : <GiGavel />}</div><div className="message-content"><div className="message-meta"><strong>{isUser ? 'You' : 'Dastavez AI'}</strong>{message.timestamp && <time>{new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>}</div><div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content || ''}</ReactMarkdown></div>{downloadUrl && <a className="generated-file" href={downloadUrl} target="_blank" rel="noreferrer"><FiFileText /><span><strong>{fileName || 'Generated document'}</strong><small>Open or download file</small></span><FiDownload /></a>}</div></article>;
}
