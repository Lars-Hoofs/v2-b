import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';

const logsDir = path.join(process.cwd(), 'logs');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
  ),
  defaultMeta: {
    service: 'ai-chat-platform',
    environment: process.env.NODE_ENV || 'development',
  },
  transports: [
    ...(process.env.NODE_ENV === 'development'
      ? [
          new winston.transports.Console({
            format: winston.format.combine(
              winston.format.colorize(),
              winston.format.printf(({ level, message, timestamp, ...metadata }) => {
                let msg = `${timestamp} [${level}]: ${message}`;
                if (Object.keys(metadata).length > 0 && metadata.service) {
                  delete metadata.service;
                  delete metadata.environment;
                }
                if (Object.keys(metadata).length > 0) {
                  msg += ` ${JSON.stringify(metadata)}`;
                }
                return msg;
              })
            ),
          }),
        ]
      : []),

    new DailyRotateFile({
      dirname: logsDir,
      filename: 'application-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '14d',
      format: winston.format.json(),
    }),

    new DailyRotateFile({
      dirname: logsDir,
      filename: 'error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      maxSize: '20m',
      maxFiles: '30d',
      format: winston.format.json(),
    }),
  ],
  exceptionHandlers: [
    new DailyRotateFile({
      dirname: logsDir,
      filename: 'exceptions-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '30d',
    }),
  ],
  rejectionHandlers: [
    new DailyRotateFile({
      dirname: logsDir,
      filename: 'rejections-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '30d',
    }),
  ],
});

export default logger;
