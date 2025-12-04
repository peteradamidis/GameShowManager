import { QueryClient, QueryFunction } from "@tanstack/react-query";

/**
 * Get the API base URL for fetch requests.
 * In development, uses relative URLs (same origin).
 * In production, can be configured via VITE_API_BASE_URL or uses window.location.origin.
 * This ensures API calls work correctly when deployed behind proxies/CDNs.
 */
function getApiBaseUrl(): string {
  // Check for explicit API base URL (useful for production deployments)
  if (import.meta.env.VITE_API_BASE_URL) {
    return import.meta.env.VITE_API_BASE_URL;
  }
  // In browser, use the current origin to ensure proper URL resolution
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }
  // Fallback for SSR or other environments
  return '';
}

/**
 * Resolve a relative API URL to an absolute URL.
 * Handles both relative paths (/api/...) and already-absolute URLs.
 */
function resolveApiUrl(url: string): string {
  // If URL is already absolute, return as-is
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  const baseUrl = getApiBaseUrl();
  // Ensure proper joining (avoid double slashes)
  if (baseUrl && !url.startsWith('/')) {
    return `${baseUrl}/${url}`;
  }
  return `${baseUrl}${url}`;
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const resolvedUrl = resolveApiUrl(url);
  const res = await fetch(resolvedUrl, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const url = queryKey.join("/") as string;
    const resolvedUrl = resolveApiUrl(url);
    const res = await fetch(resolvedUrl, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
