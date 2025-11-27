import { Request, Response, NextFunction } from 'express';
import logger from '../lib/logger';

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  
  // Log request
  logger.info('HTTP Request Started', {
    method: req.method,
    url: req.url,
    ip: req.ip,
    userAgent: req.get('user-agent'),
  });

  // Capture response
  res.on('finish', () => {
    const duration = Date.now() - start;
    const logLevel = res.statusCode >= 400 ? 'warn' : 'info';
    
    logger.log(logLevel, 'HTTP Request Completed', {
      method: req.method,
      url: req.url,
      status: res.statusCode,
      duration,
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });
  });

  next();
}
