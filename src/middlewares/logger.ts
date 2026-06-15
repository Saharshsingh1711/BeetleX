import morgan from 'morgan';
import { Request } from 'express';

morgan.token('requestId', (req: Request) => {
  return (req.headers['x-request-id'] as string) || 'N/A';
});

export const loggerMiddleware = morgan(
  ':method :url :status :res[content-length] - :response-time ms [Request-ID: :requestId]'
);
