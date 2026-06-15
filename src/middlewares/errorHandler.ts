import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/errors';

export const errorHandlerMiddleware = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const requestId = req.headers['x-request-id'] as string;
  
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: err.message,
      code: err.code,
      statusCode: err.statusCode,
      requestId,
    });
    return;
  }

  if (err instanceof SyntaxError && 'status' in err && 'body' in err) {
    res.status(400).json({
      error: 'Malformed JSON payload',
      code: 'BAD_REQUEST',
      statusCode: 400,
      requestId,
    });
    return;
  }

  console.error(`[Error] Request-ID: ${requestId}`, err);
  res.status(500).json({
    error: 'Internal Server Error',
    code: 'INTERNAL_SERVER_ERROR',
    statusCode: 500,
    requestId,
  });
};
