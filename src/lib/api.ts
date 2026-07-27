import axios from "axios";

/**
 * Client HTTP configurado para comunicação com o backend Express.
 * Substitui o supabase client quando rodando em VPS própria.
 *
 * No .env.production do frontend, defina preferencialmente:
 *   VITE_API_URL=https://seudominio.com/api
 */
const resolveApiBaseUrl = () => {
  const rawBase = String(import.meta.env.VITE_API_URL || "").trim();
  if (rawBase) {
    const normalized = rawBase.replace(/\/+$/, "");
    const hasApiSegment = /(^|\/)api(\/|$)/i.test(normalized);
    if (hasApiSegment) return normalized;
    const withApi = `${normalized}/api`;
    console.warn(`[API] VITE_API_URL sem '/api'. Ajustando automaticamente para: ${withApi}`);
    return withApi;
  }

  // No preview do Lovable, o proxy do Vite não funciona — usar URL absoluta
  const isLocalhost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
  if (!isLocalhost) {
    // Produção sem VITE_API_URL: mesma origem (Nginx repassa /api ao backend)
    return `${window.location.origin.replace(/\/+$/, "")}/api`;
  }

  return "/api";
};

const api = axios.create({
  baseURL: resolveApiBaseUrl(),
  timeout: 30000,
  headers: {
    "Content-Type": "application/json",
  },
});

// ============================================
// Interceptor de Request: injeta JWT automaticamente
// ============================================
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem("auth_token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// ============================================
// Interceptor de Response: trata erros globais
// ============================================
api.interceptors.response.use(
  (response) => response,
  (error) => {
    // Token JWT expirado/inválido → redireciona para login.
    // NÃO deslogar em 401 de endpoints IoT (API Key): mensagem fala de X-API-Key
    // e o admin pode estar só sem chave no header — isso não invalida a sessão.
    if (error.response?.status === 401) {
      const apiError = String(error.response?.data?.error || "");
      const isApiKeyAuthError =
        /api key/i.test(apiError) ||
        /x-api-key/i.test(apiError) ||
        /endpoints iot/i.test(apiError);

      const currentPath = window.location.pathname;
      if (!isApiKeyAuthError && currentPath !== "/auth") {
        localStorage.removeItem("auth_token");
        window.location.href = "/auth";
      }
    }

    // Extrai mensagem de erro do backend para uso nos componentes
    const message =
      error.response?.data?.error ||
      error.response?.data?.message ||
      error.message ||
      "Erro de conexão com o servidor";

    // Preserva detalhes de validação (Zod)
    const details = error.response?.data?.details || null;

    return Promise.reject({
      message,
      details,
      status: error.response?.status || 0,
      original: error,
    });
  }
);

// ============================================
// Helpers tipados para uso nos componentes
// ============================================

/** GET com tipagem genérica */
export async function get<T = any>(url: string, params?: Record<string, any>): Promise<T> {
  const { data } = await api.get<T>(url, { params });
  return data;
}

/** POST com tipagem genérica */
export async function post<T = any>(url: string, body?: any): Promise<T> {
  const { data } = await api.post<T>(url, body);
  return data;
}

/** PUT com tipagem genérica */
export async function put<T = any>(url: string, body?: any): Promise<T> {
  const { data } = await api.put<T>(url, body);
  return data;
}

/** DELETE com tipagem genérica */
export async function del<T = any>(url: string): Promise<T> {
  const { data } = await api.delete<T>(url);
  return data;
}

/** Upload de arquivo (multipart/form-data) */
export async function upload<T = any>(
  bucket: string,
  file: File
): Promise<T> {
  const formData = new FormData();
  formData.append("file", file);

  const { data } = await api.post<T>(`/upload/${bucket}`, formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

// Export default para uso direto: import api from "@/lib/api"
export { api };
export default api;
