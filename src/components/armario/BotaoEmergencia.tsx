import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ShieldAlert, Unlock } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";

interface BotaoEmergenciaProps {
  /** company_id para filtrar (opcional) */
  companyId?: string;
  /** IDs das portas com fechadura (fallback: abre porta a porta, sempre a porta exata) */
  doorIds?: string[];
  /** Callback após sucesso */
  onSuccess?: () => void;
  className?: string;
}

type EmergencyCommandResponse = {
  success?: boolean;
  message?: string;
  total?: number;
  command_id?: number;
  sent?: number;
  failed?: number;
  fallback?: "abrir-admin";
};

type SettingsRow = {
  key?: string;
  value?: unknown;
};

const buildApiUrl = (path: string) => {
  const baseUrl = String(api.defaults.baseURL || "").replace(/\/+$/, "");
  return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
};

const getStoredToken = () => localStorage.getItem("auth_token")?.trim() || "";

const extractSettingsRows = (payload: unknown): SettingsRow[] => {
  if (Array.isArray(payload)) return payload as SettingsRow[];
  if (payload && typeof payload === "object" && Array.isArray((payload as { data?: unknown }).data)) {
    return (payload as { data: SettingsRow[] }).data;
  }
  return [];
};

const extractApiKey = (payload: unknown) => {
  const setting = extractSettingsRows(payload).find((row) => row.key === "fechaduras_api_key");
  const rawValue = setting?.value;

  if (typeof rawValue === "string") return rawValue;
  if (rawValue && typeof rawValue === "object" && typeof (rawValue as { key?: unknown }).key === "string") {
    return (rawValue as { key: string }).key;
  }

  return "";
};

const extractErrorMessage = (payload: unknown, fallback: string) => {
  if (payload && typeof payload === "object") {
    const data = payload as Record<string, unknown>;
    if (typeof data.error === "string") return data.error;
    if (typeof data.message === "string") return data.message;
  }

  if (typeof payload === "string" && payload.trim()) return payload;
  return fallback;
};

const postCommand = async (
  path: string,
  body: Record<string, unknown>,
  extraHeaders: Record<string, string> = {}
) => {
  const headers = new Headers({
    "Content-Type": "application/json",
    ...extraHeaders,
  });

  const token = getStoredToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(buildApiUrl(path), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const contentType = response.headers.get("content-type") || "";
  const responseBody = contentType.includes("application/json")
    ? await response.json().catch(() => null)
    : await response.text().catch(() => "");

  if (!response.ok) {
    const error = new Error(
      extractErrorMessage(responseBody, `Falha ao executar ${path}`)
    ) as Error & { status?: number; body?: unknown };
    error.status = response.status;
    error.body = responseBody;
    throw error;
  }

  return (responseBody || {}) as EmergencyCommandResponse;
};

const enqueueAdminFallback = async (doorIds: string[]) => {
  const uniqueDoorIds = [...new Set(doorIds.filter(Boolean))];

  if (!uniqueDoorIds.length) {
    throw new Error("Nenhuma porta com fechadura configurada foi encontrada para a abertura de emergência.");
  }

  let sent = 0;
  const errors: string[] = [];
  const chunkSize = 10;

  for (let index = 0; index < uniqueDoorIds.length; index += chunkSize) {
    const chunk = uniqueDoorIds.slice(index, index + chunkSize);
    const results = await Promise.allSettled(
      chunk.map((doorId) =>
        postCommand("/fechaduras/abrir-admin", {
          door_id: doorId,
          origem: "emergencia",
        })
      )
    );

    results.forEach((result) => {
      if (result.status === "fulfilled") {
        sent += 1;
        return;
      }
      errors.push(result.reason?.message || "erro desconhecido");
    });
  }

  if (!sent) {
    throw new Error(errors[0] || "Nenhum comando pôde ser enviado.");
  }

  return {
    success: errors.length === 0,
    message: errors.length
      ? `Fallback enviado para ${sent} de ${uniqueDoorIds.length} porta(s).`
      : `Fallback enviado para ${uniqueDoorIds.length} porta(s).`,
    sent,
    failed: errors.length,
    total: uniqueDoorIds.length,
    fallback: "abrir-admin" as const,
  } satisfies EmergencyCommandResponse;
};

export function BotaoEmergencia({ companyId, doorIds = [], onSuccess, className }: BotaoEmergenciaProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const handleOpenAll = async () => {
    setIsLoading(true);
    try {
      let apiKey = "";
      try {
        const { data: settingsData } = await api.get("/settings", {
          params: { key: "fechaduras_api_key" },
        });
        apiKey = extractApiKey(settingsData);
      } catch {
        console.warn("[EMERGENCIA] Não foi possível carregar API Key de fallback");
      }

      const payload: Record<string, unknown> = {};
      if (companyId) payload.company_id = companyId;
      const apiKeyHeaders = apiKey ? { "X-API-Key": apiKey } : {};

      let data: EmergencyCommandResponse | null = null;
      let lastError: unknown = null;

      for (const endpoint of ["/fechaduras/emergencia", "/fechaduras/abrir-tudo"]) {
        try {
          data = await postCommand(endpoint, payload, apiKeyHeaders);
          break;
        } catch (error) {
          lastError = error;
          console.warn(
            `[EMERGENCIA] Falha em ${endpoint}, tentando próximo fallback...`,
            (error as { status?: number })?.status || 0
          );
        }
      }

      if (!data) {
        try {
          data = await enqueueAdminFallback(doorIds);
        } catch (fallbackError) {
          throw fallbackError instanceof Error ? fallbackError : lastError;
        }
      }

      console.log("[EMERGENCIA] Sucesso:", data);

      if (data.failed) {
        toast.warning("⚠️ Emergência enviada parcialmente", {
          description: data.message || `Comando enviado para ${data.sent} de ${data.total} fechadura(s).`,
        });
      } else {
        toast.success("⚠️ Comando de Emergência Enviado!", {
          description: data.message || `O agente iniciará a abertura em instantes.`,
        });
      }

      onSuccess?.();
    } catch (err: any) {
      console.error("[EMERGENCIA] Erro final:", err);
      toast.error("Falha ao executar emergência", {
        description:
          err?.message ||
          extractErrorMessage(err?.body, "Verifique a conexão com o servidor."),
      });
    } finally {
      setIsLoading(false);
      setOpen(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          variant="destructive"
          className={`shadow-lg shadow-red-500/20 font-semibold tracking-wide gap-2 ${className || ""}`}
          disabled={isLoading}
        >
          <ShieldAlert className="w-4 h-4" />
          Emergência
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-destructive">
            <ShieldAlert className="w-5 h-5" />
            Abertura de Emergência
          </AlertDialogTitle>
          <AlertDialogDescription className="space-y-2">
            <span className="block font-semibold text-destructive">
              ATENÇÃO: Esta ação abrirá TODAS as fechaduras físicas simultaneamente!
            </span>
            <span className="block">
              O comando será enviado ao agente IoT que disparará a abertura em broadcast
              para todas as placas controladoras configuradas. Esta ação é irreversível e
              será registrada nos logs de auditoria.
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isLoading}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleOpenAll}
            disabled={isLoading}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90 gap-2"
          >
            <Unlock className="w-4 h-4" />
            {isLoading ? "Enviando comando..." : "Confirmar Abertura Total"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
