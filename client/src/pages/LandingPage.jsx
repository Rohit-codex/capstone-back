import { Link, useNavigate } from 'react-router-dom';
import { FiArrowRight, FiCheck, FiFileText, FiLock, FiMessageCircle, FiShield, FiStar } from 'react-icons/fi';
import { useAuth } from '../context/AuthContext';
import Logo from '../components/Logo';

const features = [
  { icon: FiMessageCircle, title: 'Ask with confidence', text: 'Work through legal questions in a focused, private workspace.' },
  { icon: FiFileText, title: 'Understand documents', text: 'Upload documents and request an AI-assisted analysis in context.' },
  { icon: FiLock, title: 'Designed for control', text: 'Your account, conversations, and document workflow stay in one place.' },
];
export default function LandingPage() {
  const { isAuthenticated } = useAuth(); const navigate = useNavigate(); const start = () => navigate(isAuthenticated ? '/dashboard' : '/register');
  return <div className="landing-page"><header className="landing-nav"><Link to="/"><Logo /></Link><nav><a href="#how-it-works">How it works</a><a href="#features">Features</a></nav><div><Link className="text-link" to="/login">Sign in</Link><button className="button button-dark nav-cta" onClick={start}>Get started <FiArrowRight /></button></div></header>
    <main><section className="hero"><div className="hero-copy"><p className="eyebrow"><FiStar /> LEGAL INTELLIGENCE, MADE CLEAR</p><h1>Sharper legal work begins with <em>clarity.</em></h1><p className="hero-lede">Dastavez AI helps you explore legal questions, understand documents, and prepare your next step in one considered workspace.</p><div className="hero-actions"><button className="button button-dark" onClick={start}>Start a conversation <FiArrowRight /></button><a className="button button-quiet" href="#how-it-works">See how it works</a></div><p className="disclaimer"><FiShield /> AI-assisted legal information, not a replacement for advice from a qualified lawyer.</p></div><div className="hero-art" aria-hidden="true"><div className="art-sun" /><div className="art-arch art-arch-back" /><div className="art-arch art-arch-front" /><div className="art-plinth"><span /><span /><span /></div><p>BUILT FOR THE WORK<br />BEHIND THE CASE</p></div></section>
      <section id="features" className="feature-intro"><div><p className="eyebrow">A QUIETER WAY TO WORK</p><h2>Everything you need to turn legal complexity into a practical next move.</h2></div><p>From first questions to document review, the workspace keeps your essential legal work accessible, organized, and understandable.</p></section>
      <section className="feature-grid">{features.map(({ icon: Icon, title, text }, index) => <article className="feature-card" key={title}><span className="feature-number">0{index + 1}</span><Icon className="feature-icon" /><h3>{title}</h3><p>{text}</p><span className="feature-line" /></article>)}</section>
      <section id="how-it-works" className="process"><div className="process-copy"><p className="eyebrow">HOW IT WORKS</p><h2>A considered path from question to understanding.</h2><p>Start with the facts you have. Dastavez AI helps you structure the conversation, read the document, and identify useful next questions.</p><button className="button button-outline" onClick={start}>Open your workspace <FiArrowRight /></button></div><ol>{[['01', 'Begin with your question', 'Describe the situation or upload a supporting document.'], ['02', 'Review the response', 'Work through clear, contextual information at your own pace.'], ['03', 'Decide your next step', 'Save context and consult a qualified lawyer when legal advice is needed.']].map(([number, title, text]) => <li key={number}><span>{number}</span><div><h3>{title}</h3><p>{text}</p></div><FiCheck /></li>)}</ol></section>
    </main><footer className="landing-footer"><Logo light /><p>© {new Date().getFullYear()} Dastavez AI. Legal information, presented thoughtfully.</p><div><Link to="/login">Sign in</Link><Link to="/register">Create account</Link></div></footer>
  </div>;
}
