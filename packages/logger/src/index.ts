import pino, { LoggerOptions } from 'pino';

export function createLogger(serviceName: string) {
  const isProduction = process.env.NODE_ENV === 'production';
  const logLevel = process.env.LOG_LEVEL || 'info';

  const options: LoggerOptions = {
    name: serviceName,
    level: logLevel,
    base: {
      service: serviceName,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  if (!isProduction) {
    options.transport = {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
        ignore: 'pid,hostname',
      },
    };
  }

  return pino(options);
}

export type Logger = ReturnType<typeof createLogger>;
