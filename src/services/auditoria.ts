import { supabase } from "@/lib/supabase-compat";

type AuditAction =
  | "login_success"
  | "login_failed"
  | "logout"
  | "locker_access"
  | "locker_reserve"
  | "locker_release"
  | "locker_maintenance"
  | "permission_change"
  | "user_created"
  | "user_updated"
  | "password_change"
  | "branding_update"
  | "settings_update";

type ResourceType =
  | "auth"
  | "locker_door"
  | "locker"
  | "company"
  | "profile"
  | "permission"
  | "settings";

interface AuditEntry {
  action: AuditAction;
  resource_type: ResourceType;
  resource_id?: string;
  details?: Record<string, unknown>;
}

export async function registrarAuditoria(entry: AuditEntry) {
  try {
    const { data: { user } } = await supabase.auth.getUser();

    await supabase.from("audit_logs").insert({
      user_id: user?.id ?? null,
      action: entry.action,
      resource_type: entry.resource_type,
      resource_id: entry.resource_id ?? null,
      details: entry.details ?? {},
      user_agent: navigator.userAgent,
    } as any);
  } catch (err) {
    console.error("Erro ao registrar auditoria:", err);
  }
}

// Lockout: 5 failed attempts → 60-second block
const MAX_ATTEMPTS = 5;
const LOCKOUT_SECONDS = 60;
const WINDOW_MINUTES = 30; // observation window

export type NivelAlerta = "info" | "aviso" | "perigo" | "bloqueado";

export interface StatusBloqueio {
  bloqueado: boolean;
  tentativasRestantes: number;
  minutosRestantes: number;
  segundosRestantes: number;
  totalFalhas: number;
  nivel: NivelAlerta;
  mensagem: string;
}

function calcularNivel(falhas: number): NivelAlerta {
  if (falhas === 0) return "info";
  if (falhas <= 2) return "info";
  if (falhas <= 3) return "aviso";
  if (falhas <= 4) return "perigo";
  return "bloqueado";
}

function gerarMensagem(falhas: number, restantes: number, minutosRestantes: number): string {
  if (falhas === 0) return "";

  if (minutosRestantes > 0) {
    return `Sua conta foi temporariamente bloqueada por segurança. Aguarde ${minutosRestantes} minuto(s) antes de tentar novamente.`;
  }

  if (restantes <= 1) {
    return "⚠️ Última tentativa! Após esta, sua conta será bloqueada temporariamente.";
  }

  if (restantes <= 2) {
    return `Atenção: restam apenas ${restantes} tentativas. Verifique se o Caps Lock está desligado e confira seu e-mail.`;
  }

  return `E-mail ou senha incorretos. Você ainda tem ${restantes} tentativa(s).`;
}

export async function verificarBloqueioLogin(email: string): Promise<StatusBloqueio> {
  try {
    const { data, error } = await (supabase as any).rpc("get_login_lockout_status", {
      _email: email.toLowerCase().trim(),
    });

    if (error) throw error;

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
      return {
        bloqueado: false,
        tentativasRestantes: MAX_ATTEMPTS,
        minutosRestantes: 0,
        segundosRestantes: 0,
        totalFalhas: 0,
        nivel: "info",
        mensagem: "",
      };
    }

    return {
      bloqueado: Boolean(row.bloqueado),
      tentativasRestantes: Number(row.tentativas_restantes ?? 0),
      minutosRestantes: Number(row.minutos_restantes ?? 0),
      segundosRestantes: Number(row.segundos_restantes ?? 0),
      totalFalhas: Number(row.total_falhas ?? 0),
      nivel: (row.nivel as NivelAlerta) ?? "info",
      mensagem: String(row.mensagem ?? ""),
    };
  } catch (err) {
    console.error("Erro ao verificar bloqueio de login:", err);
    return {
      bloqueado: false,
      tentativasRestantes: MAX_ATTEMPTS,
      minutosRestantes: 0,
      segundosRestantes: 0,
      totalFalhas: 0,
      nivel: "info",
      mensagem: "",
    };
  }
}

/**
 * As tentativas de login são registradas pelo próprio servidor em /auth/login.
 * Mantida apenas por compatibilidade com chamadas existentes.
 */
export async function registrarTentativaLogin(_email: string, _sucesso: boolean) {
  return;
}
