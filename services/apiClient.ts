import { AppError, ErrorCode } from '../types';
import { logger } from './logger';

type ApiResponse<T> = {
  success?: boolean;
  data?: T;
  code?: ErrorCode;
  message?: string;
  correlationId?: string;
};

const toAppError = (payload: ApiResponse<unknown> | null, fallbackMessage: string) => {
  return new AppError(
    payload?.code || 'ERR_NETWORK',
    payload?.message || fallbackMessage,
    payload?.correlationId
  );
};

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const url = path.startsWith('/api/') ? path : `/api${path.startsWith('/') ? path : `/${path}`}`;
  const headers = new Headers(init.headers || {});

  if (!headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json');
  }

  const sessionId = typeof localStorage !== 'undefined'
    ? localStorage.getItem('cruzpham_active_session_id')
    : null;
  if (sessionId && !headers.has('X-CPJS-Session')) {
    headers.set('X-CPJS-Session', sessionId);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers,
      credentials: 'same-origin',
    });
  } catch (error: any) {
    logger.warn('apiRequestNetworkFailure', { path: url, message: error?.message });
    throw new AppError('ERR_NETWORK', 'Service unavailable. Please try again.', logger.getCorrelationId());
  }

  let payload: ApiResponse<T> | null = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok || payload?.success === false) {
    throw toAppError(payload, 'Service unavailable. Please try again.');
  }

  return (payload && 'data' in payload ? payload.data : payload) as T;
}
