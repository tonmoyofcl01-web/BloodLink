export function notFound(_req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found.' } });
}

export function errorHandler(error, _req, res, _next) {
  if (error?.name === 'ZodError') {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Request validation failed.', details: error.issues.map(({ path, message }) => ({ path, message })) } });
  }
  if (error?.type === 'entity.too.large') return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large.' } });
  if (error?.code === 'EMAIL_DELIVERY_FAILED') return res.status(503).json({ error: { code: error.code, message: error.message } });
  if (error?.code === 'P2002') return res.status(409).json({ error: { code: 'CONFLICT', message: 'An account with those details already exists.' } });
  if (error?.type === 'entity.parse.failed') return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } });
  if (process.env.NODE_ENV !== 'production') console.error(error);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' } });
}
