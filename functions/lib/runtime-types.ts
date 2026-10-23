export interface HandlerEvent {
  httpMethod: string;
  headers: Record<string, string | undefined>;
  body: string | null;
  queryStringParameters: Record<string, string | undefined>;
}

export interface HandlerResponse {
  statusCode: number;
  headers?: Record<string, string>;
  body?: string;
}

export type Handler = (event: HandlerEvent) => Promise<HandlerResponse> | HandlerResponse;

export interface KVNamespaceLike {
  get(key: string, type?: "text"): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface RuntimeEnv {
  FIREBASE_API_KEY: string;
  FIREBASE_DATABASE_URL: string;
  FIREBASE_PROJECT_ID: string;
  FIREBASE_SERVICE_ACCOUNT_JSON?: string;
  PIERO_EMAIL: string;
  PIERO_PIN_SHA512: string;
  PIERO_TOKEN_ENCRYPTION_KEY: string;
  PIERO_KV: KVNamespaceLike;
  CRON_SECRET?: string;
  PUBLIC_SITE_URL?: string;
}

export interface RuntimeRequestContext {
  request: Request;
  env: RuntimeEnv;
  params: Record<string, string | string[]>;
}
