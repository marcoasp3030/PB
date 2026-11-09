import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Archive, Clock, MapPin, User, LogOut, Sun, Moon, KeyRound,
  CheckCircle2, AlertCircle, Lock, Shield, RefreshCw, Unlock,
  Building2, Eye, EyeOff, Loader2,
  ClockArrowUp, Hourglass, Bell, ListOrdered,
  DoorOpen, History, ChevronDown, ChevronUp, Package, Zap
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import api from "@/lib/api";
import { supabase } from "@/lib/supabase-compat";
import { useAuth } from "@/contexts/ContextoAutenticacao";
import { useTheme } from "next-themes";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import HistoricoPortal from "@/components/portal/HistoricoPortal";
import PerfilPortal from "@/components/portal/PerfilPortal";
import NotificacoesPortal from "@/components/portal/NotificacoesPortal";
import FilaEsperaPortal from "@/components/portal/FilaEsperaPortal";
import PWAInstallBanner from "@/components/portal/PWAInstallBanner";

interface PersonInfo {
  id: string;
  nome: string;
  cargo: string | null;
  tipo: string;
  company_id: string;
  email: string | null;
  telefone: string | null;
  matricula: string | null;
  avatar_url?: string | null;
  notification_email?: boolean;
  notification_whatsapp?: boolean;
  notification_expiry?: boolean;
  notification_renewal?: boolean;
}

interface DoorInfo {
  id: string;
  door_number: number;
  label: string | null;
  size: string;
  status: string;
  expires_at: string | null;
  occupied_at: string | null;
  usage_type: string;
  lock_id: number | null;
  locker: {
    name: string;
    location: string;
  };
}

interface ReservationInfo {
  id: string;
  starts_at: string;
  expires_at: string | null;
  status: string;
  usage_type: string;
  renewed_count: number;
}

interface RenewalRequest {
  id: string;
  door_id: string;
  status: string;
  requested_hours: number;
  created_at: string;
}

interface AppFeatures {
  abrir_fechadura: boolean;
  historico_comandos: boolean;
  notificacoes: boolean;
  renovacao: boolean;
  liberar_porta: boolean;
  perfil_edicao: boolean;
  fila_espera: boolean;
  branding_personalizado: boolean;
}

const DEFAULT_APP_FEATURES: AppFeatures = {
  abrir_fechadura: true,
  historico_comandos: true,
  notificacoes: true,
  renovacao: true,
  liberar_porta: true,
  perfil_edicao: true,
  fila_espera: true,
  branding_personalizado: false,
};

export default function Portal() {
  const { user, signOut } = useAuth();
  const { theme, setTheme } = useTheme();
  const [person, setPerson] = useState<PersonInfo | null>(null);
  const [doors, setDoors] = useState<DoorInfo[]>([]);
  const [reservations, setReservations] = useState<ReservationInfo[]>([]);
  const [companyName, setCompanyName] = useState("");
  const [loading, setLoading] = useState(true);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [activeTab, setActiveTab] = useState("armarios");
  const [renewalRequests, setRenewalRequests] = useState<RenewalRequest[]>([]);
  const [showRenewalDialog, setShowRenewalDialog] = useState(false);
  const [renewalDoor, setRenewalDoor] = useState<DoorInfo | null>(null);
  const [renewalHours, setRenewalHours] = useState("1");
  const [renewalLoading, setRenewalLoading] = useState(false);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [openingLockId, setOpeningLockId] = useState<string | null>(null);
  const [expandedDoor, setExpandedDoor] = useState<string | null>(null);
  const [doorHistory, setDoorHistory] = useState<Record<string, any[]>>({});
  const [loadingHistory, setLoadingHistory] = useState<string | null>(null);
  const [releasingDoor, setReleasingDoor] = useState<string | null>(null);
  const [showReleaseDialog, setShowReleaseDialog] = useState(false);
  const [releaseDoor, setReleaseDoor] = useState<DoorInfo | null>(null);
  const [appFeatures, setAppFeatures] = useState<AppFeatures>(DEFAULT_APP_FEATURES);

  // Helper to check if a feature is enabled
  const featureEnabled = (key: keyof AppFeatures) => appFeatures[key];

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      // Check if password change is required via API
      try {
        const profileRes = await api.get("/compat/profiles", {
          params: { user_id: `eq.${user.id}`, select: "password_changed", limit: 1 }
        });
        const profileData = profileRes.data?.data?.[0] || profileRes.data?.[0];
        if (profileData && profileData.password_changed === false) {
          setMustChangePassword(true);
          setShowPasswordDialog(true);
        }
      } catch (err) {
        console.warn("[PORTAL] Erro ao verificar senha:", err);
      }

      let personLoaded = false;
      try {
        // Load profile + features via mobile API
        const meRes = await api.get("/mobile/me");
        const meData = meRes.data?.data;

        if (meData?.person) {
          personLoaded = true;
          setPerson(meData.person as PersonInfo);
          setCompanyName(meData.person.company_name || "");

          // Load app features from API response
          if (meData.app_features && typeof meData.app_features === "object") {
            setAppFeatures({ ...DEFAULT_APP_FEATURES, ...meData.app_features });
          }

          // Fetch doors, reservations and renewals in parallel via mobile API
          const [doorsRes, reservasRes, renewalsRes] = await Promise.all([
            api.get("/mobile/portas"),
            api.get("/mobile/reservas"),
            api.get("/mobile/renovacoes"),
          ]);

          const doorsData = doorsRes.data?.data || [];
          setDoors(doorsData.map((d: any) => ({
            ...d,
            locker: { name: d.locker_name || "—", location: d.locker_location || "—" },
          })));

          const resData = reservasRes.data?.data || [];
          setReservations(resData.filter((r: any) => r.status === "active") as ReservationInfo[]);

          setRenewalRequests((renewalsRes.data?.data || []) as RenewalRequest[]);
        }
      } catch (err) {
        console.error("[PORTAL] Erro ao carregar dados via API:", err);
      }

      // Fallback: load app features directly from platform_settings if mobile API failed or didn't return them
      if (!personLoaded) {
        try {
          // Try to get person from compat layer
          const persRes = await api.get("/compat/funcionarios_clientes", {
            params: { user_id: `eq.${user.id}`, select: "*", limit: 1 }
          });
          const personData = persRes.data?.data?.[0] || persRes.data?.[0];
          if (personData) {
            setPerson(personData as PersonInfo);
            setCompanyName(personData.company_name || "");

            // Load features from platform_settings
            const featRes = await api.get("/compat/platform_settings", {
              params: { key: `eq.app_features_${personData.company_id}`, select: "value", limit: 1 }
            });
            const featData = featRes.data?.data?.[0] || featRes.data?.[0];
            if (featData?.value && typeof featData.value === "object") {
              setAppFeatures({ ...DEFAULT_APP_FEATURES, ...(featData.value as Partial<AppFeatures>) });
            }

            // Load doors
            try {
              const doorsRes = await api.get("/compat/locker_doors", {
                params: { occupied_by_person: `eq.${personData.id}`, select: "*,lockers(*)", status: "eq.occupied" }
              });
              const doorsData = doorsRes.data?.data || doorsRes.data || [];
              setDoors(doorsData.map((d: any) => ({
                ...d,
                locker: d.lockers || { name: "—", location: "—" },
              })));
            } catch {
              // silent
            }
          }
        } catch (err) {
          console.warn("[PORTAL] Fallback também falhou:", err);
        }
      }

      setLoading(false);
    };
    load();
  }, [user]);

  const displayName = person?.nome || user?.user_metadata?.full_name || "Usuário";
  const initials = displayName.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2);

  const sizeLabels: Record<string, string> = {
    small: "Pequena", medium: "Média", large: "Grande",
  };

  const usageLabels: Record<string, string> = {
    temporary: "Temporário", permanent: "Permanente",
  };

  const isExpiringSoon = (expiresAt: string | null) => {
    if (!expiresAt) return false;
    const diff = new Date(expiresAt).getTime() - Date.now();
    return diff > 0 && diff < 24 * 60 * 60 * 1000;
  };

  const isExpired = (expiresAt: string | null) => {
    if (!expiresAt) return false;
    return new Date(expiresAt).getTime() < Date.now();
  };

  const getPendingRenewal = (doorId: string) => {
    return renewalRequests.find(r => r.door_id === doorId && r.status === "pending");
  };

  const handleRequestRenewal = async () => {
    if (!renewalDoor || !person) return;
    setRenewalLoading(true);
    try {
      await api.post("/mobile/renovacao", {
        door_id: renewalDoor.id,
        requested_hours: parseInt(renewalHours),
      });

      // Refresh requests via mobile API
      const { data: renewalsRes } = await api.get("/mobile/renovacoes");
      setRenewalRequests((renewalsRes?.data || []) as RenewalRequest[]);

      toast.success("Solicitação de renovação enviada! O administrador será notificado.");
      setShowRenewalDialog(false);
      setRenewalDoor(null);
    } catch (err: any) {
      const msg = err.response?.data?.error || err.message || "Erro ao solicitar renovação";
      toast.error(msg);
    } finally {
      setRenewalLoading(false);
    }
  };

  const handleChangePassword = async () => {
    if (newPassword.length < 6) {
      toast.error("A nova senha deve ter pelo menos 6 caracteres");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("As senhas não coincidem");
      return;
    }
    setChangingPassword(true);
    try {
      await api.post("/auth/change-password", {
        currentPassword,
        newPassword,
      });

      // Mark password as changed in profile
      await api.put("/compat/profiles", {
        password_changed: true,
      }, {
        params: { user_id: `eq.${user!.id}` }
      });

      setMustChangePassword(false);
      toast.success("Senha alterada com sucesso!");
      setShowPasswordDialog(false);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: any) {
      toast.error(err.response?.data?.error || err.message || "Erro ao alterar senha");
    } finally {
      setChangingPassword(false);
    }
  };

  const handleOpenLock = async (door: DoorInfo) => {
    if (!door.lock_id) {
      toast.error("Esta porta não possui fechadura vinculada.");
      return;
    }
    setOpeningLockId(door.id);
    try {
      const res = await api.post("/fechaduras/abrir-portal", { door_id: door.id, origem: "portal" });
      const data = res.data?.data || res.data;
      if (data?.success) {
        toast.success(`Comando de abertura enviado para ${door.label || "Porta " + door.door_number}`);
      } else {
        toast.error(data?.error || "Erro ao enviar comando de abertura");
      }
    } catch (err: any) {
      toast.error(err.message || "Erro ao abrir fechadura");
    } finally {
      setOpeningLockId(null);
    }
  };

  const handleReleaseDoor = async () => {
    if (!releaseDoor || !person) return;
    setReleasingDoor(releaseDoor.id);
    try {
      await api.post("/mobile/liberar", { door_id: releaseDoor.id });

      setDoors(prev => prev.filter(d => d.id !== releaseDoor.id));
      setShowReleaseDialog(false);
      setReleaseDoor(null);
      toast.success("Porta liberada com sucesso!");
    } catch (err: any) {
      const msg = err.response?.data?.error || err.message || "Erro ao liberar porta";
      toast.error(msg);
    } finally {
      setReleasingDoor(null);
    }
  };

  const loadDoorHistory = useCallback(async (doorId: string, lockId: number | null) => {
    if (doorHistory[doorId]) return;
    if (!lockId) return;
    setLoadingHistory(doorId);
    try {
      const res = await api.get("/fechaduras/meu-historico");
      const data = res.data?.data || res.data || [];
      const filtered = Array.isArray(data) ? data.filter((c: any) => c.lock_id === lockId).slice(0, 10) : [];
      setDoorHistory(prev => ({ ...prev, [doorId]: filtered }));
    } catch {
      setDoorHistory(prev => ({ ...prev, [doorId]: [] }));
    } finally {
      setLoadingHistory(null);
    }
  }, [doorHistory]);

  const toggleDoorExpand = (door: DoorInfo) => {
    if (expandedDoor === door.id) {
      setExpandedDoor(null);
    } else {
      setExpandedDoor(door.id);
      if (door.lock_id) loadDoorHistory(door.id, door.lock_id);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Carregando seu portal...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-xl border-b border-border">
        <div className="max-w-2xl mx-auto flex items-center justify-between px-4 h-16">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full gradient-primary flex items-center justify-center text-primary-foreground text-sm font-bold shadow-md shadow-primary/20">
              {initials}
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground leading-tight">{displayName}</p>
              <div className="flex items-center gap-1.5">
                <Building2 className="h-3 w-3 text-muted-foreground" />
                <p className="text-[11px] text-muted-foreground">{companyName}</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              title={theme === "dark" ? "Modo claro" : "Modo escuro"}
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <Button variant="ghost" size="icon" className="h-9 w-9 text-destructive hover:text-destructive" onClick={signOut} title="Sair">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {/* PWA Install Banner */}
        <PWAInstallBanner />
        {/* Greeting + Stats */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-2xl font-bold text-foreground">
            Olá, {displayName.split(" ")[0]}! 👋
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Bem-vindo ao seu portal de armários
          </p>

          {/* Quick stats */}
          <div className="grid grid-cols-3 gap-3 mt-4">
            <Card className="border-border/50">
              <CardContent className="p-3 text-center">
                <p className="text-2xl font-bold text-primary">{doors.length}</p>
                <p className="text-[11px] text-muted-foreground">Armário{doors.length !== 1 ? "s" : ""}</p>
              </CardContent>
            </Card>
            <Card className="border-border/50">
              <CardContent className="p-3 text-center">
                <p className="text-2xl font-bold text-secondary">{reservations.length}</p>
                <p className="text-[11px] text-muted-foreground">Reserva{reservations.length !== 1 ? "s" : ""}</p>
              </CardContent>
            </Card>
            <Card className="border-border/50">
              <CardContent className="p-3 text-center">
                <p className="text-2xl font-bold text-accent">
                  {doors.filter(d => isExpiringSoon(d.expires_at)).length}
                </p>
                <p className="text-[11px] text-muted-foreground">Expirando</p>
              </CardContent>
            </Card>
          </div>
        </motion.div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="w-full flex">
            <TabsTrigger value="armarios" className="text-xs flex-1">
              <Archive className="h-4 w-4 sm:mr-1" />
              <span className="hidden sm:inline">Armários</span>
            </TabsTrigger>
            {featureEnabled("fila_espera") && (
              <TabsTrigger value="fila" className="text-xs flex-1">
                <ListOrdered className="h-4 w-4 sm:mr-1" />
                <span className="hidden sm:inline">Fila</span>
              </TabsTrigger>
            )}
            {featureEnabled("historico_comandos") && (
              <TabsTrigger value="historico" className="text-xs flex-1">
                <Clock className="h-4 w-4 sm:mr-1" />
                <span className="hidden sm:inline">Histórico</span>
              </TabsTrigger>
            )}
            {featureEnabled("notificacoes") && (
              <TabsTrigger value="notificacoes" className="text-xs relative flex-1">
                <Bell className="h-4 w-4 sm:mr-1" />
                <span className="hidden sm:inline">Avisos</span>
                {unreadNotifications > 0 && (
                  <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-destructive text-destructive-foreground text-[9px] flex items-center justify-center font-bold">
                    {unreadNotifications > 9 ? "9+" : unreadNotifications}
                  </span>
                )}
              </TabsTrigger>
            )}
            {featureEnabled("perfil_edicao") && (
              <TabsTrigger value="perfil" className="text-xs flex-1">
                <User className="h-4 w-4 sm:mr-1" />
                <span className="hidden sm:inline">Perfil</span>
              </TabsTrigger>
            )}
            <TabsTrigger value="seguranca" className="text-xs flex-1">
              <Shield className="h-4 w-4 sm:mr-1" />
              <span className="hidden sm:inline">Segurança</span>
            </TabsTrigger>
          </TabsList>

          {/* === ARMÁRIOS TAB === */}
          <TabsContent value="armarios" className="space-y-4 mt-4">
            {doors.length > 0 ? (
              doors.map((door, i) => (
                <motion.div
                  key={door.id}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.08 }}
                >
                  <Card className="shadow-card border-border/50 overflow-hidden">
                    <CardContent className="p-0">
                      {/* Locker identification banner */}
                      <div className={`px-4 py-2 flex items-center gap-2 border-b border-border/30 ${
                        isExpired(door.expires_at)
                          ? "bg-destructive/5"
                          : isExpiringSoon(door.expires_at)
                          ? "bg-accent/5"
                          : "bg-muted/40"
                      }`}>
                        <Building2 className="h-4 w-4 text-primary flex-shrink-0" />
                        <span className="font-semibold text-sm text-foreground">{door.locker.name}</span>
                        <span className="text-muted-foreground text-xs">•</span>
                        <MapPin className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                        <span className="text-xs text-muted-foreground truncate">{door.locker.location || "Sem localização"}</span>
                      </div>

                      {/* Door header */}
                      <div className={`p-4 flex items-center justify-between ${
                        isExpired(door.expires_at)
                          ? "bg-destructive/10"
                          : isExpiringSoon(door.expires_at)
                          ? "bg-accent/10"
                          : "gradient-primary"
                      }`}>
                        <div className="flex items-center gap-3">
                          <div className={`h-12 w-12 rounded-xl flex items-center justify-center ${
                            isExpired(door.expires_at)
                              ? "bg-destructive/20"
                              : isExpiringSoon(door.expires_at)
                              ? "bg-accent/20"
                              : "bg-white/20 backdrop-blur"
                          }`}>
                            <Archive className={`h-6 w-6 ${
                              isExpired(door.expires_at)
                                ? "text-destructive"
                                : isExpiringSoon(door.expires_at)
                                ? "text-accent"
                                : "text-primary-foreground"
                            }`} />
                          </div>
                          <div>
                            <p className={`font-bold text-lg ${
                              isExpired(door.expires_at) || isExpiringSoon(door.expires_at)
                                ? "text-foreground"
                                : "text-primary-foreground"
                            }`}>
                              Porta {door.label || door.door_number}
                            </p>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <Badge className={`border-0 text-xs ${
                            isExpired(door.expires_at) || isExpiringSoon(door.expires_at)
                              ? "bg-muted text-foreground"
                              : "bg-white/20 text-primary-foreground"
                          }`}>
                            {sizeLabels[door.size] || door.size}
                          </Badge>
                          <Badge variant="outline" className={`text-[10px] border-0 ${
                            isExpired(door.expires_at) || isExpiringSoon(door.expires_at)
                              ? "bg-muted/50 text-muted-foreground"
                              : "bg-white/10 text-primary-foreground/80"
                          }`}>
                            {usageLabels[door.usage_type] || door.usage_type}
                          </Badge>
                        </div>
                      </div>

                      {/* Door details */}
                      <div className="p-4 space-y-3">

                        {/* Open lock button - PROMINENT */}
                        {featureEnabled("abrir_fechadura") && (
                          <Button
                            className="w-full gap-2 h-12 text-base font-semibold shadow-md"
                            onClick={() => handleOpenLock(door)}
                            disabled={openingLockId === door.id || !door.lock_id || isExpired(door.expires_at)}
                          >
                            {openingLockId === door.id ? (
                              <Loader2 className="h-5 w-5 animate-spin" />
                            ) : (
                              <Unlock className="h-5 w-5" />
                            )}
                            {openingLockId === door.id
                              ? "Enviando..."
                              : !door.lock_id
                              ? "Sem fechadura vinculada"
                              : isExpired(door.expires_at)
                              ? "Prazo expirado"
                              : "Abrir Fechadura"}
                          </Button>
                        )}

                        {door.occupied_at && (
                          <div className="flex items-center gap-2.5 text-sm">
                            <Clock className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                            <span className="text-foreground">
                              Desde {format(new Date(door.occupied_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                              <span className="text-muted-foreground ml-1">
                                ({formatDistanceToNow(new Date(door.occupied_at), { locale: ptBR, addSuffix: false })})
                              </span>
                            </span>
                          </div>
                        )}

                        {door.expires_at && (
                          <div className={`flex items-center gap-2.5 text-sm rounded-lg p-2 -mx-2 ${
                            isExpired(door.expires_at)
                              ? "bg-destructive/5 text-destructive"
                              : isExpiringSoon(door.expires_at)
                              ? "bg-accent/5 text-accent"
                              : ""
                          }`}>
                            {isExpired(door.expires_at) ? (
                              <AlertCircle className="h-4 w-4 flex-shrink-0" />
                            ) : isExpiringSoon(door.expires_at) ? (
                              <AlertCircle className="h-4 w-4 flex-shrink-0" />
                            ) : (
                              <KeyRound className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                            )}
                            <span className="font-medium">
                              {isExpired(door.expires_at)
                                ? "Expirado em "
                                : isExpiringSoon(door.expires_at)
                                ? "Expira em breve: "
                                : "Válido até "}
                              {format(new Date(door.expires_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                            </span>
                          </div>
                        )}

                        <Separator />

                        {/* Action buttons row */}
                        <div className="grid grid-cols-3 gap-2">
                          {/* Renewal */}
                          {featureEnabled("renovacao") && door.expires_at && (
                            getPendingRenewal(door.id) ? (
                              <Button variant="outline" size="sm" className="text-xs gap-1 h-9 col-span-1" disabled>
                                <Hourglass className="h-3.5 w-3.5" />
                                <span className="hidden sm:inline">Pendente</span>
                              </Button>
                            ) : (
                              <Button
                                variant="outline"
                                size="sm"
                                className="text-xs gap-1 h-9"
                                onClick={() => {
                                  setRenewalDoor(door);
                                  setRenewalHours("1");
                                  setShowRenewalDialog(true);
                                }}
                              >
                                <RefreshCw className="h-3.5 w-3.5" />
                                <span className="hidden sm:inline">Renovar</span>
                              </Button>
                            )
                          )}

                          {/* History toggle */}
                          {featureEnabled("historico_comandos") && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-xs gap-1 h-9"
                              onClick={() => toggleDoorExpand(door)}
                            >
                              <History className="h-3.5 w-3.5" />
                              <span className="hidden sm:inline">Histórico</span>
                              {expandedDoor === door.id ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                            </Button>
                          )}

                          {/* Release door */}
                          {featureEnabled("liberar_porta") && door.usage_type === "temporary" && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-xs gap-1 h-9 text-destructive hover:text-destructive hover:bg-destructive/10"
                              onClick={() => {
                                setReleaseDoor(door);
                                setShowReleaseDialog(true);
                              }}
                            >
                              <DoorOpen className="h-3.5 w-3.5" />
                              <span className="hidden sm:inline">Liberar</span>
                            </Button>
                          )}
                        </div>

                        {/* Status indicator */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 text-sm">
                            {isExpired(door.expires_at) ? (
                              <>
                                <AlertCircle className="h-4 w-4 text-destructive flex-shrink-0" />
                                <span className="text-destructive font-medium">Expirado</span>
                              </>
                            ) : (
                              <>
                                <CheckCircle2 className="h-4 w-4 text-primary flex-shrink-0" />
                                <span className="text-primary font-medium">Ativo</span>
                              </>
                            )}
                          </div>
                          {door.lock_id && (
                            <Badge variant="outline" className="text-[10px] gap-1">
                              <Zap className="h-3 w-3" />
                              Fechadura #{door.lock_id}
                            </Badge>
                          )}
                        </div>

                        {/* Expandable history */}
                        <AnimatePresence>
                          {expandedDoor === door.id && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.2 }}
                              className="overflow-hidden"
                            >
                              <Separator className="mb-3" />
                              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                <History className="h-3 w-3" />
                                Últimos Comandos
                              </p>
                              {loadingHistory === door.id ? (
                                <div className="flex items-center justify-center py-4">
                                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                </div>
                              ) : (doorHistory[door.id] || []).length === 0 ? (
                                <p className="text-xs text-muted-foreground text-center py-3">Nenhum comando registrado</p>
                              ) : (
                                <div className="space-y-1.5">
                                  {(doorHistory[door.id] || []).map((cmd: any) => (
                                    <div key={cmd.id} className="flex items-center justify-between rounded-md bg-muted/30 px-3 py-2">
                                      <div className="flex items-center gap-2">
                                        <div className={`h-2 w-2 rounded-full ${
                                          cmd.status === "executado" ? "bg-primary" : cmd.status === "erro" ? "bg-destructive" : "bg-accent"
                                        }`} />
                                        <span className="text-xs text-foreground capitalize">{cmd.acao}</span>
                                        <span className="text-[10px] text-muted-foreground">
                                          via {cmd.origem || "—"}
                                        </span>
                                      </div>
                                      <span className="text-[10px] text-muted-foreground">
                                        {cmd.criado_em ? format(new Date(cmd.criado_em), "dd/MM HH:mm", { locale: ptBR }) : "—"}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              ))
            ) : (
              <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
                <Card className="shadow-card border-border/50">
                  <CardContent className="p-10 text-center">
                    <div className="h-16 w-16 rounded-2xl bg-muted/50 flex items-center justify-center mx-auto mb-4">
                      <Archive className="h-8 w-8 text-muted-foreground" />
                    </div>
                    <h3 className="font-semibold text-foreground mb-1">Nenhum armário atribuído</h3>
                    <p className="text-sm text-muted-foreground">
                      Quando um armário for atribuído a você, ele aparecerá aqui.
                    </p>
                  </CardContent>
                </Card>
              </motion.div>
            )}

            {/* Active reservations */}
            {reservations.length > 0 && (
              <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
                  <RefreshCw className="h-3.5 w-3.5" />
                  Reservas Ativas
                </h2>
                <Card className="shadow-card border-border/50">
                  <CardContent className="p-0 divide-y divide-border">
                    {reservations.map((res) => (
                      <div key={res.id} className="p-4 flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            {res.usage_type === "temporary" ? "Temporária" : "Permanente"}
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Desde {format(new Date(res.starts_at), "dd/MM/yyyy", { locale: ptBR })}
                            {res.expires_at && ` • Até ${format(new Date(res.expires_at), "dd/MM/yyyy", { locale: ptBR })}`}
                          </p>
                        </div>
                        {res.renewed_count > 0 && (
                          <Badge variant="outline" className="text-[10px]">
                            {res.renewed_count}x renovada
                          </Badge>
                        )}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </motion.div>
            )}

            {/* Renewal requests history */}
            {renewalRequests.length > 0 && (
              <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
                  <ClockArrowUp className="h-3.5 w-3.5" />
                  Solicitações de Renovação
                </h2>
                <Card className="shadow-card border-border/50">
                  <CardContent className="p-0 divide-y divide-border">
                    {renewalRequests.slice(0, 5).map((req) => (
                      <div key={req.id} className="p-4 flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            +{req.requested_hours}h de renovação
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {format(new Date(req.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                          </p>
                        </div>
                        <Badge
                          variant="outline"
                          className={`text-[10px] ${
                            req.status === "pending"
                              ? "bg-accent/10 text-accent border-accent/20"
                              : req.status === "approved"
                              ? "bg-green-500/10 text-green-600 border-green-500/20"
                              : "bg-destructive/10 text-destructive border-destructive/20"
                          }`}
                        >
                          {req.status === "pending" ? "Pendente" : req.status === "approved" ? "Aprovada" : "Recusada"}
                        </Badge>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </motion.div>
            )}
          </TabsContent>

          {/* === FILA DE ESPERA TAB === */}
          {featureEnabled("fila_espera") && (
            <TabsContent value="fila" className="space-y-4 mt-4">
              {person && (
                <FilaEsperaPortal
                  personId={person.id}
                  companyId={person.company_id}
                  userId={user!.id}
                />
              )}
            </TabsContent>
          )}

          {/* === HISTÓRICO TAB === */}
          <TabsContent value="historico" className="space-y-4 mt-4">
            {person && <HistoricoPortal personId={person.id} />}
          </TabsContent>

          {/* === NOTIFICAÇÕES TAB === */}
          <TabsContent value="notificacoes" className="space-y-4 mt-4">
            {user && (
              <NotificacoesPortal
                userId={user.id}
                onUnreadCountChange={setUnreadNotifications}
              />
            )}
          </TabsContent>

          {/* === PERFIL TAB === */}
          <TabsContent value="perfil" className="space-y-4 mt-4">
            {person && (
              <PerfilPortal
                person={person}
                userEmail={user?.email || null}
                companyName={companyName}
                initials={initials}
                onPersonUpdate={(updated) => setPerson(updated)}
              />
            )}
          </TabsContent>

          {/* === SEGURANÇA TAB === */}
          <TabsContent value="seguranca" className="space-y-4 mt-4">
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
              <Card className="shadow-card border-border/50">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Lock className="h-4 w-4 text-primary" />
                    Senha de Acesso
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground mb-4">
                    Altere sua senha para manter sua conta segura. Recomendamos usar uma senha forte com pelo menos 8 caracteres, incluindo letras, números e símbolos.
                  </p>
                  <Button onClick={() => setShowPasswordDialog(true)} className="w-full sm:w-auto">
                    <Lock className="h-4 w-4 mr-2" />
                    Alterar Senha
                  </Button>
                </CardContent>
              </Card>

              <Card className="shadow-card border-border/50">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Shield className="h-4 w-4 text-primary" />
                    Informações da Conta
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between py-2">
                    <div>
                      <p className="text-sm font-medium text-foreground">E-mail de login</p>
                      <p className="text-xs text-muted-foreground">{user?.email}</p>
                    </div>
                    <Badge variant="outline" className="text-xs">
                      <CheckCircle2 className="h-3 w-3 mr-1 text-green-500" />
                      Verificado
                    </Badge>
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between py-2">
                    <div>
                      <p className="text-sm font-medium text-foreground">Último acesso</p>
                      <p className="text-xs text-muted-foreground">
                        {user?.last_sign_in_at
                          ? format(new Date(user.last_sign_in_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })
                          : "—"}
                      </p>
                    </div>
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between py-2">
                    <div>
                      <p className="text-sm font-medium text-foreground">Conta criada em</p>
                      <p className="text-xs text-muted-foreground">
                        {user?.created_at
                          ? format(new Date(user.created_at), "dd/MM/yyyy", { locale: ptBR })
                          : "—"}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Logout */}
              <Card className="shadow-card border-destructive/20">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-foreground">Encerrar sessão</p>
                      <p className="text-xs text-muted-foreground">Sair da sua conta neste dispositivo</p>
                    </div>
                    <Button variant="destructive" size="sm" onClick={signOut}>
                      <LogOut className="h-4 w-4 mr-2" />
                      Sair
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Password Change Dialog */}
      <Dialog
        open={showPasswordDialog}
        onOpenChange={(open) => {
          if (!open && mustChangePassword) return; // prevent closing if mandatory
          setShowPasswordDialog(open);
        }}
      >
        <DialogContent
          className={`max-w-md ${mustChangePassword ? "[&>button]:hidden" : ""}`}
          onPointerDownOutside={mustChangePassword ? (e) => e.preventDefault() : undefined}
          onEscapeKeyDown={mustChangePassword ? (e) => e.preventDefault() : undefined}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lock className="h-5 w-5 text-primary" />
              {mustChangePassword ? "Troca de Senha Obrigatória" : "Alterar Senha"}
            </DialogTitle>
            <DialogDescription>
              {mustChangePassword
                ? "Por segurança, você precisa alterar sua senha provisória antes de continuar."
                : "Digite sua nova senha. Ela deve ter pelo menos 6 caracteres."}
            </DialogDescription>
          </DialogHeader>

          {mustChangePassword && (
            <div className="rounded-lg border border-accent/30 bg-accent/5 p-3 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-accent mt-0.5 flex-shrink-0" />
              <p className="text-xs text-accent">
                Esta é sua primeira vez no sistema. Crie uma senha pessoal e segura para proteger sua conta.
              </p>
            </div>
          )}

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="new-password">Nova senha</Label>
              <div className="relative">
                <Input
                  id="new-password"
                  type={showNewPw ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Mínimo 6 caracteres"
                  autoFocus
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-10 w-10"
                  onClick={() => setShowNewPw(!showNewPw)}
                >
                  {showNewPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              {newPassword.length > 0 && newPassword.length < 6 && (
                <p className="text-xs text-destructive">Mínimo de 6 caracteres</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirmar nova senha</Label>
              <Input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repita a nova senha"
              />
              {confirmPassword.length > 0 && confirmPassword !== newPassword && (
                <p className="text-xs text-destructive">As senhas não coincidem</p>
              )}
            </div>
          </div>

          <DialogFooter>
            {!mustChangePassword && (
              <Button variant="outline" onClick={() => setShowPasswordDialog(false)}>
                Cancelar
              </Button>
            )}
            <Button
              onClick={handleChangePassword}
              disabled={changingPassword || newPassword.length < 6 || newPassword !== confirmPassword}
            >
              {changingPassword ? "Salvando..." : mustChangePassword ? "Definir nova senha" : "Salvar nova senha"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Renewal Request Dialog */}
      <Dialog open={showRenewalDialog} onOpenChange={setShowRenewalDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5 text-primary" />
              Solicitar Renovação
            </DialogTitle>
            <DialogDescription>
              Solicite a renovação do prazo da porta <strong>{renewalDoor?.label || renewalDoor?.door_number}</strong> ({renewalDoor?.locker.name}). O administrador será notificado e avaliará sua solicitação.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {renewalDoor?.expires_at && (
              <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
                <p className="text-muted-foreground">Prazo atual:</p>
                <p className="font-medium text-foreground">
                  {format(new Date(renewalDoor.expires_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label>Por quantas horas deseja renovar?</Label>
              <Select value={renewalHours} onValueChange={setRenewalHours}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1 hora</SelectItem>
                  <SelectItem value="2">2 horas</SelectItem>
                  <SelectItem value="4">4 horas</SelectItem>
                  <SelectItem value="8">8 horas</SelectItem>
                  <SelectItem value="12">12 horas</SelectItem>
                  <SelectItem value="24">24 horas</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRenewalDialog(false)}>
              Cancelar
            </Button>
            <Button onClick={handleRequestRenewal} disabled={renewalLoading}>
              {renewalLoading ? "Enviando..." : "Enviar Solicitação"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Release Door Confirmation Dialog */}
      <Dialog open={showReleaseDialog} onOpenChange={setShowReleaseDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <DoorOpen className="h-5 w-5 text-destructive" />
              Liberar Porta
            </DialogTitle>
            <DialogDescription>
              Tem certeza que deseja liberar a porta <strong>{releaseDoor?.label || releaseDoor?.door_number}</strong> do armário <strong>{releaseDoor?.locker.name}</strong>? Esta ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
            <p className="text-xs text-destructive">
              Ao liberar, a porta ficará disponível para outros usuários e você perderá o acesso à fechadura vinculada.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReleaseDialog(false)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleReleaseDoor}
              disabled={releasingDoor === releaseDoor?.id}
            >
              {releasingDoor === releaseDoor?.id ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <DoorOpen className="h-4 w-4 mr-2" />
              )}
              {releasingDoor === releaseDoor?.id ? "Liberando..." : "Confirmar Liberação"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
