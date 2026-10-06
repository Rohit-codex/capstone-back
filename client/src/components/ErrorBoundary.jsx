import { Component } from 'react';

class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { hasError: false }; }
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError) return <main className="fatal-error"><p className="eyebrow">Dastavez AI</p><h1>Something interrupted this page.</h1><p>Refresh to continue. Your saved conversations and documents are not affected.</p><button type="button" className="button button-dark" onClick={() => window.location.reload()}>Refresh page</button></main>;
    return this.props.children;
  }
}
export default ErrorBoundary;
