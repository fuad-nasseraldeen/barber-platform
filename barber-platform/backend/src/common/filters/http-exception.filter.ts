import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      message = typeof res === 'object' && res !== null && 'message' in res
        ? (res as { message: string | string[] }).message
        : String(res);
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    const isAuthError = status === 401 || status === 403;
    const isDbError =
      exception instanceof Error &&
      (exception.message?.includes('Prisma') ||
        exception.message?.includes('database') ||
        exception.message?.includes('unique') ||
        exception.message?.includes('foreign'));

    if (isAuthError) {
      this.logger.warn(
        `[Auth] ${request.method} ${request.url} - ${status} - ${Array.isArray(message) ? message.join(', ') : message}`,
      );
    } else if (isDbError) {
      this.logger.error(
        `[Database] ${request.method} ${request.url} - ${exception instanceof Error ? exception.stack : message}`,
      );
    } else if (status >= 500) {
      this.logger.error(
        `[API] ${request.method} ${request.url} - ${status} - ${exception instanceof Error ? exception.stack : message}`,
      );
    }

    response.status(status).json({
      statusCode: status,
      message,
      error: HttpStatus[status] || 'Error',
    });
  }
}
