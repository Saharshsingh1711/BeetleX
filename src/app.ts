import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { requestIdMiddleware } from './middlewares/requestId';
import { loggerMiddleware } from './middlewares/logger';
import { errorHandlerMiddleware } from './middlewares/errorHandler';
import authRouter from './routes/auth';
import eventsRouter from './routes/events';
import teamsRouter from './routes/teams';
import projectsRouter from './routes/projects';

const app = express();

// Middleware
app.use(requestIdMiddleware);
app.use(helmet());
app.use(cors({ origin: true, credentials: true })); // Enable credentials for HTTP-only cookie transfer
app.use(express.json());
app.use(cookieParser());
app.use(loggerMiddleware);

// Routes
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    requestId: req.headers['x-request-id'],
  });
});

app.use('/api/auth', authRouter);
app.use('/api/events', eventsRouter);
app.use('/api/teams', teamsRouter);
app.use('/api/projects', projectsRouter);

// 404 Route handler
app.use((req: Request, res: Response, next: NextFunction) => {
  res.status(404).json({ error: 'Not Found' });
});

// Error handling middleware
app.use(errorHandlerMiddleware);

export default app;
