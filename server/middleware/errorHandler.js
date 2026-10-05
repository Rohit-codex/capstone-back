export const errorHandler = (err, req, res, next) => {
  console.error(err);

  let status = err.status || err.statusCode || 500;
  let message = err.message || 'Internal Server Error';

  // Axios errors from OpenRouter / Groq / etc. — do not forward raw 401 to the client as "our" auth failure
  const upstreamStatus = err.response?.status;
  if (upstreamStatus) {
    const data = err.response?.data;
    const providerMsg =
      data?.error?.message
      || data?.error
      || data?.message
      || (typeof data === 'string' ? data : null);

    if (upstreamStatus === 401 || upstreamStatus === 403) {
      status = 502;
      message = 'Authentication with AI provider failed';
      // Log sensitive details server-side only
      console.error('[LLM Auth Error]', {
        upstreamStatus,
        envHint: 'Update OPENROUTER_API_KEY or GROQ_API_KEY in backend/server/.env, set LLM_PROVIDER correctly',
        providerMsg: providerMsg || 'unknown',
      });
    } else {
      status = 502;
      message = 'AI provider error';
      if (providerMsg && typeof providerMsg === 'string') {
        console.error('[LLM Provider Error]', { upstreamStatus, providerMsg });
      } else {
        console.error('[LLM Provider Error]', { upstreamStatus });
      }
    }
  }

  res.status(status).json({
    success: false,
    message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
}; 