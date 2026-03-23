import { supabase } from './supabaseClient';

const apiBaseUrl = import.meta.env.VITE_API_URL;

if (!apiBaseUrl) {
  throw new Error('Missing VITE_API_URL. Add it to your .env file.');
}

type ApiRequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  auth?: boolean;
  query?: Record<string, string | number | undefined | null>;
};

function normalizeErrorDetail(detail: unknown, fallback: string): string {
  if (typeof detail === 'string' && detail.trim()) {
    return detail;
  }
  if (Array.isArray(detail) && detail.length) {
    return detail.map((item) => (typeof item === 'string' ? item : JSON.stringify(item))).join(', ');
  }
  if (detail && typeof detail === 'object') {
    return JSON.stringify(detail);
  }
  return fallback;
}

function buildUrl(path: string, query?: ApiRequestOptions['query']) {
  const url = new URL(path, apiBaseUrl);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function getAccessToken() {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    throw new Error(error.message);
  }
  const token = data.session?.access_token;
  if (!token) {
    throw new Error('No authenticated session.');
  }
  return token;
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const { auth = true, body, method = body ? 'POST' : 'GET', query } = options;
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };

  if (auth) {
    headers.Authorization = `Bearer ${await getAccessToken()}`;
  }

  let payload: string | undefined;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  let response: Response;
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      headers,
      body: payload,
    });
  } catch (error) {
    throw new Error(
      `Unable to reach the backend API at ${apiBaseUrl}. Start the FastAPI server and confirm VITE_API_URL is correct.`,
      { cause: error },
    );
  }

  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const payload = (await response.json()) as { detail?: unknown };
      detail = normalizeErrorDetail(payload.detail, detail);
    } catch {
      // Ignore non-JSON error bodies and fall back to the HTTP status.
    }
    throw new Error(detail);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}
