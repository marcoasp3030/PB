import { useState, useEffect } from "react";
import { Lock, Unlock, Wrench, User, Hash, Maximize2, Calendar, Clock, UserCheck, RefreshCw, CalendarClock, Droplets, Zap, Loader2 } from "lucide-react";
import FilaEspera from "@/components/armario/FilaEspera";
import api from "@/lib/api";
import { motion } from "framer-motion";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { supabase } from "@/lib/supabase-compat";
import { useCompany } from "@/contexts/ContextoEmpresa";
import { useToast } from "@/hooks/use-toast";

export interface LockerDoorDataExtended {
  id: string;
  door_number: number;
  label: string | null;
  size: "small" | "medium" | "large";
  status: "available" | "occupied" | "maintenance" | "reserved" | "hygienizing";
  occupied_by: string | null;
  occupied_by_person: string | null;
  usage_type: string;
  expires_at: string | null;
  locker_id?: string;
  lock_id?: number | null;
}

const statusLabels: Record<string, { label: string; color: string; bg: string }> = {
  available: { label: "Disponível", color: "text-emerald-600", bg: "bg-emerald-500" },
  occupied: { label: "Ocupado", color: "text-rose-600", bg: "bg-rose-500" },
  maintenance: { label: "Manutenção", color: "text-amber-600", bg: "bg-amber-500" },
  reserved: { label: "Reservado", color: "text-blue-600", bg: "bg-blue-500" },
  hygienizing: { label: "Higienização", color: "text-cyan-600", bg: "bg-cyan-500" },
};

const sizeLabels: Record<string, string> = { small: "Pequeno", medium: "Médio", large: "Grande" };

// Quick duration presets (hours)
const DURATION_PRESETS = [
  { label: "1h", hours: 1 },
  { label: "2h", hours: 2 },
  { label: "4h", hours: 4 },
  { label: "6h", hours: 6 },
  { label: "8h", hours: 8 },
  { label: "12h", hours: 12 },
];

interface Pessoa {
  id: string;
  nome: string;
  tipo: string;
  matricula: string | null;
}

interface DoorDetailSheetProps {
  door: LockerDoorDataExtended | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReserve?: (door: LockerDoorDataExtended, personId: string, usageType: string, expiresAt: string | null, startsAt?: string | null) => void;
  onRelease?: (door: LockerDoorDataExtended) => void;
  isCurrentUser?: boolean;
  loading?: boolean;
  isAdmin?: boolean;
  onSetMaintenance?: (door: LockerDoorDataExtended) => void;
  onRefresh?: () => void;
}

type ConfirmAction = "reserve" | "release" | "maintenance" | "unmaintenance" | "renew" | "schedule" | null;

const confirmConfig: Record<string, { title: string; description: string; actionLabel: string; variant: "default" | "destructive" }> = {
  reserve: {
    title: "Confirmar reserva",
    description: "Tem certeza que deseja reservar esta porta para a pessoa selecionada?",
    actionLabel: "Reservar",
    variant: "default",
  },
  release: {
    title: "Confirmar liberação",
    description: "Tem certeza que deseja liberar esta porta? Ela ficará disponível para outros usuários.",
    actionLabel: "Liberar",
    variant: "destructive",
  },
  maintenance: {
    title: "Colocar em manutenção",
    description: "Tem certeza que deseja colocar esta porta em manutenção? Ela ficará indisponível para uso.",
    actionLabel: "Confirmar manutenção",
    variant: "destructive",
  },
  unmaintenance: {
    title: "Retirar da manutenção",
    description: "Tem certeza que deseja retirar esta porta da manutenção? Ela voltará a ficar disponível.",
    actionLabel: "Retirar manutenção",
    variant: "default",
  },
  renew: {
    title: "Renovar reserva",
    description: "Deseja estender o prazo desta reserva temporária?",
    actionLabel: "Renovar",
    variant: "default",
  },
  schedule: {
    title: "Confirmar agendamento",
    description: "Tem certeza que deseja agendar esta porta para uso futuro?",
    actionLabel: "Agendar",
    variant: "default",
  },
};

export default function DetalhePortaPainel({ door, open, onOpenChange, onReserve, onRelease, isCurrentUser, loading, isAdmin, onSetMaintenance, onRefresh }: DoorDetailSheetProps) {
  const { selectedCompany } = useCompany();
  const { toast } = useToast();
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [selectedPersonId, setSelectedPersonId] = useState<string>("");
  const [usageType, setUsageType] = useState<string>("temporary");
  const [expiresAt, setExpiresAt] = useState<string>("");
  const [personName, setPersonName] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>("now");

  // Scheduling fields
  const [schedStartsAt, setSchedStartsAt] = useState<string>("");
  const [schedDurationPreset, setSchedDurationPreset] = useState<number | null>(null);
  const [schedExpiresAt, setSchedExpiresAt] = useState<string>("");

  // Renewal fields
  const [renewHours, setRenewHours] = useState<number>(2);
  const [actionLoading, setActionLoading] = useState(false);

  // Lock binding fields
  const [lockIdInput, setLockIdInput] = useState<string>("");
  const [savingLockId, setSavingLockId] = useState(false);
  const [openingLock, setOpeningLock] = useState(false);

  // Fetch people
  useEffect(() => {
    if (!open || !selectedCompany) return;
    const fetchPessoas = async () => {
      const { data } = await supabase
        .from("funcionarios_clientes")
        .select("id, nome, tipo, matricula")
        .eq("company_id", selectedCompany.id)
        .eq("ativo", true)
        .order("nome");
      if (data) setPessoas(data);
    };
    fetchPessoas();
  }, [open, selectedCompany]);

  // Load person name for occupied doors
  useEffect(() => {
    if (!door?.occupied_by_person) {
      setPersonName(null);
      return;
    }
    const fetchName = async () => {
      const { data } = await supabase
        .from("funcionarios_clientes")
        .select("nome")
        .eq("id", door.occupied_by_person!)
        .single();
      setPersonName(data?.nome || null);
    };
    fetchName();
  }, [door?.occupied_by_person]);

  // Reset form when door changes
  useEffect(() => {
    setSelectedPersonId("");
    setUsageType("temporary");
    setExpiresAt("");
    setActiveTab("now");
    setSchedStartsAt("");
    setSchedDurationPreset(null);
    setSchedExpiresAt("");
    setRenewHours(2);
    setLockIdInput(door?.lock_id != null ? String(door.lock_id) : "");
    setOpeningLock(false);
  }, [door?.id, door?.lock_id]);

  const status = door ? statusLabels[door.status] : statusLabels.available;
  const StatusIcon = !door ? Unlock : door.status === "available" ? Unlock : door.status === "occupied" ? Lock : door.status === "maintenance" ? Wrench : door.status === "hygienizing" ? Droplets : User;

  if (!door) return null;

  const handleSaveLockId = async () => {
    if (!door) return;
    setSavingLockId(true);
    const newLockId = lockIdInput.trim() === "" ? null : parseInt(lockIdInput);
    if (lockIdInput.trim() !== "" && (isNaN(newLockId!) || newLockId! <= 0)) {
      toast({ title: "ID inválido", description: "Informe um número inteiro positivo ou deixe vazio para desvincular.", variant: "destructive" });
      setSavingLockId(false);
      return;
    }
    const { error } = await supabase
      .from("locker_doors")
      .update({ lock_id: newLockId })
      .eq("id", door.id);
    if (error) {
      toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
    } else {
      toast({ title: newLockId ? "Fechadura vinculada!" : "Fechadura desvinculada", description: newLockId ? `Lock ID ${newLockId} vinculado à porta ${door.label || '#' + door.door_number}.` : "Porta sem fechadura vinculada." });
      onRefresh?.();
    }
    setSavingLockId(false);
  };

  const handleOpenLock = async () => {
    if (!door?.lock_id) return;
    setOpeningLock(true);
    try {
      const res = await api.post("/fechaduras/abrir-admin", { door_id: door.id, origem: "painel" });
      toast({ title: "🔓 Comando enviado!", description: `Abrindo fechadura #${door.lock_id} — Comando #${res.data.id}` });
    } catch (err: any) {
      toast({ title: "Erro ao abrir fechadura", description: err.message || "Falha na comunicação com a API", variant: "destructive" });
    } finally {
      setOpeningLock(false);
    }
  };
  const applyDurationPreset = (hours: number, target: "now" | "schedule") => {
    const date = new Date();
    if (target === "schedule" && schedStartsAt) {
      date.setTime(new Date(schedStartsAt).getTime());
    }
    date.setHours(date.getHours() + hours);
    const formatted = date.toISOString().slice(0, 16);
    if (target === "now") {
      setExpiresAt(formatted);
    } else {
      setSchedExpiresAt(formatted);
      setSchedDurationPreset(hours);
    }
  };

  const handleConfirm = async () => {
    if (!door) return;
    switch (confirmAction) {
      case "reserve":
        onReserve?.(door, selectedPersonId, usageType, usageType === "temporary" && expiresAt ? new Date(expiresAt).toISOString() : null);
        break;
      case "release":
        onRelease?.(door);
        break;
      case "maintenance":
        onSetMaintenance?.(door);
        break;
      case "unmaintenance":
        onRelease?.(door);
        break;
      case "renew":
        await handleRenew();
        break;
      case "schedule":
        await handleSchedule();
        break;
    }
    setConfirmAction(null);
  };

  const handleRenew = async () => {
    if (!door) return;
    setActionLoading(true);
    const currentExpiry = door.expires_at ? new Date(door.expires_at) : new Date();
    const newExpiry = new Date(currentExpiry.getTime() + renewHours * 60 * 60 * 1000);

    const { error } = await supabase
      .from("locker_doors")
      .update({ expires_at: newExpiry.toISOString() })
      .eq("id", door.id);

    if (!error) {
      // Update reservation record
      await supabase
        .from("locker_reservations")
        .update({ 
          expires_at: newExpiry.toISOString(), 
          renewed_count: (await supabase.from("locker_reservations").select("renewed_count").eq("door_id", door.id).eq("status", "active").single()).data?.renewed_count + 1 || 1,
          expiry_notified: false
        })
        .eq("door_id", door.id)
        .eq("status", "active");

      toast({ title: "Renovado!", description: `Reserva estendida por ${renewHours}h até ${newExpiry.toLocaleString("pt-BR")}.` });
      onOpenChange(false);
      onRefresh?.();
    } else {
      toast({ title: "Erro ao renovar", description: error.message, variant: "destructive" });
    }
    setActionLoading(false);
  };

  const handleSchedule = async () => {
    if (!door || !selectedPersonId || !schedStartsAt) return;
    setActionLoading(true);

    const startsAt = new Date(schedStartsAt).toISOString();
    const expiresAtVal = usageType === "temporary" && schedExpiresAt ? new Date(schedExpiresAt).toISOString() : null;

    // Create reservation record with "scheduled" status
    const { data: reservation, error: resError } = await supabase
      .from("locker_reservations")
      .insert({
        door_id: door.id,
        locker_id: door.locker_id || "",
        person_id: selectedPersonId,
        reserved_by: (await supabase.auth.getUser()).data.user?.id,
        usage_type: usageType,
        status: "scheduled",
        starts_at: startsAt,
        expires_at: expiresAtVal,
      })
      .select()
      .single();

    if (resError || !reservation) {
      toast({ title: "Erro ao agendar", description: resError?.message, variant: "destructive" });
      setActionLoading(false);
      return;
    }

    // Mark the door as having a scheduled reservation
    await supabase
      .from("locker_doors")
      .update({ scheduled_reservation_id: reservation.id })
      .eq("id", door.id);

    toast({ 
      title: "Agendado!", 
      description: `Reserva agendada para ${new Date(startsAt).toLocaleString("pt-BR")}.` 
    });
    onOpenChange(false);
    onRefresh?.();
    setActionLoading(false);
  };

  const canReserve = selectedPersonId && (usageType === "permanent" || (usageType === "temporary" && expiresAt));
  const canSchedule = selectedPersonId && schedStartsAt && (usageType === "permanent" || (usageType === "temporary" && schedExpiresAt));

  const config = confirmAction ? confirmConfig[confirmAction] : null;
  const isTemporaryOccupied = door.status === "occupied" && door.usage_type === "temporary" && door.expires_at;

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-full sm:w-[420px] md:w-[460px] rounded-l-2xl p-0 overflow-hidden">
          {/* Door illustration header */}
          <div className="relative bg-gradient-to-b from-slate-200 to-slate-300 dark:from-slate-700 dark:to-slate-800 px-6 pt-8 pb-6">
            <div className="mx-auto w-28 h-40 rounded-lg bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-600 dark:to-slate-700 border-2 border-slate-300 dark:border-slate-500 shadow-lg relative overflow-hidden">
              <div className="absolute inset-0 shadow-[inset_0_2px_8px_rgba(0,0,0,0.1)] dark:shadow-[inset_0_2px_8px_rgba(0,0,0,0.3)] rounded-lg" />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 flex flex-col items-center gap-1">
                <div className="w-4 h-4 rounded-full border-2 border-slate-300 dark:border-slate-400 bg-slate-200 dark:bg-slate-500" />
                <div className="w-[3px] h-4 rounded-full bg-slate-300 dark:bg-slate-500" />
              </div>
              <div className="absolute top-3 left-3">
                <motion.div
                  animate={door.status === "available" ? { opacity: [1, 0.4, 1] } : {}}
                  transition={{ repeat: Infinity, duration: 2 }}
                  className={`h-3 w-3 rounded-full ${status.bg} shadow-[0_0_8px_2px] ${
                    door.status === "available" ? "shadow-emerald-500/50" :
                    door.status === "occupied" ? "shadow-rose-500/50" :
                    door.status === "maintenance" ? "shadow-amber-500/50" : "shadow-blue-500/50"
                  }`}
                />
              </div>
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2">
                <span className="text-lg font-extrabold font-mono text-slate-500 dark:text-slate-300">{door.door_number}</span>
              </div>
              <div className="absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col gap-[2px]">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="w-8 h-[2px] rounded-full bg-slate-300/60 dark:bg-slate-500/40" />
                ))}
              </div>
            </div>

            <div className="absolute top-4 right-6">
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-background/80 backdrop-blur-sm border border-border/50 shadow-sm">
                <div className={`h-2 w-2 rounded-full ${status.bg}`} />
                <span className={`text-xs font-semibold ${status.color}`}>{status.label}</span>
              </div>
            </div>
          </div>

          <div className="px-6 pt-5 pb-8 space-y-5 overflow-y-auto max-h-[calc(100vh-280px)]">
            <SheetHeader className="p-0">
              <SheetTitle className="text-xl font-extrabold">
                {door.label || `Porta #${door.door_number}`}
              </SheetTitle>
            </SheetHeader>

            {/* Info cards */}
            <div className="grid grid-cols-3 gap-2.5">
              <div className="p-2.5 rounded-xl bg-muted/50 border border-border/40 text-center">
                <Hash className="h-3.5 w-3.5 mx-auto text-muted-foreground mb-0.5" />
                <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Número</p>
                <p className="text-sm font-bold text-foreground font-mono mt-0.5">#{door.door_number}</p>
              </div>
              <div className="p-2.5 rounded-xl bg-muted/50 border border-border/40 text-center">
                <Maximize2 className="h-3.5 w-3.5 mx-auto text-muted-foreground mb-0.5" />
                <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Tamanho</p>
                <p className="text-sm font-bold text-foreground mt-0.5">{sizeLabels[door.size]}</p>
              </div>
              <div className="p-2.5 rounded-xl bg-muted/50 border border-border/40 text-center">
                <StatusIcon className={`h-3.5 w-3.5 mx-auto mb-0.5 ${status.color}`} />
                <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Status</p>
                <p className={`text-sm font-bold mt-0.5 ${status.color}`}>{status.label}</p>
              </div>
            </div>

            {/* Smart Lock binding (admin) */}
            {isAdmin && (
              <div className="p-3.5 rounded-xl bg-muted/30 border border-border/40 space-y-2.5">
                <div className="flex items-center gap-2">
                  <Zap className="h-4 w-4 text-primary" />
                  <p className="text-xs font-semibold uppercase tracking-wider text-primary">Fechadura Inteligente</p>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={1}
                    value={lockIdInput}
                    onChange={(e) => setLockIdInput(e.target.value)}
                    placeholder="Lock ID (ex: 1)"
                    className="h-8 text-sm font-mono flex-1"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleSaveLockId}
                    disabled={savingLockId}
                    className="h-8 text-xs shrink-0"
                  >
                    {savingLockId ? <Loader2 className="h-3 w-3 animate-spin" /> : "Salvar"}
                  </Button>
                </div>
                {door.lock_id && (
                  <p className="text-[10px] text-muted-foreground">
                    Fechadura <strong className="font-mono">#{door.lock_id}</strong> vinculada
                  </p>
                )}
              </div>
            )}

            {/* Open lock button - admin/superadmin can always open; user only when occupied */}
            {door.lock_id && (isAdmin || (door.status === "occupied" && isCurrentUser)) && (
              <Button
                onClick={handleOpenLock}
                disabled={openingLock}
                className="w-full h-11 rounded-xl font-semibold gap-2 bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-600/20"
              >
                {openingLock ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Zap className="h-4 w-4" />
                )}
                {openingLock ? "Enviando comando..." : "🔓 Abrir Fechadura"}
              </Button>
            )}

            {door.status === "occupied" && (personName || door.usage_type || door.expires_at) && (
              <div className="p-3.5 rounded-xl bg-muted/30 border border-border/40 space-y-2">
                {personName && (
                  <div className="flex items-center gap-2">
                    <UserCheck className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">{personName}</span>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">
                    {door.usage_type === "permanent" ? "Uso permanente" : "Uso temporário"}
                  </span>
                  {door.usage_type === "temporary" && (
                    <Badge variant="outline" className="text-[9px] bg-amber-500/10 text-amber-600 border-amber-500/20 ml-auto">
                      Temporário
                    </Badge>
                  )}
                </div>
                {door.expires_at && (
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">
                      Expira: {new Date(door.expires_at).toLocaleDateString("pt-BR")} às {new Date(door.expires_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                    {new Date(door.expires_at) < new Date() && (
                      <Badge variant="destructive" className="text-[9px] ml-auto">Expirado</Badge>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Renewal for occupied temporary doors */}
            {isTemporaryOccupied && isAdmin && (
              <div className="p-3.5 rounded-xl bg-primary/5 border border-primary/20 space-y-3">
                <div className="flex items-center gap-2">
                  <RefreshCw className="h-4 w-4 text-primary" />
                  <p className="text-xs font-semibold text-primary uppercase tracking-wider">Renovar reserva</p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {[1, 2, 4, 6, 8, 12].map((h) => (
                    <button
                      key={h}
                      onClick={() => setRenewHours(h)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                        renewHours === h
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "bg-muted/50 text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      +{h}h
                    </button>
                  ))}
                </div>
                <Button
                  onClick={() => setConfirmAction("renew")}
                  disabled={loading || actionLoading}
                  size="sm"
                  className="w-full rounded-xl gradient-primary border-0 text-primary-foreground"
                >
                  <RefreshCw className="mr-2 h-3.5 w-3.5" />
                  Renovar por {renewHours}h
                </Button>
              </div>
            )}

            {/* Reservation form (available doors) */}
            {door.status === "available" && isAdmin && (
              <div className="space-y-4">
                <Tabs value={activeTab} onValueChange={setActiveTab}>
                  <TabsList className="w-full grid grid-cols-2">
                    <TabsTrigger value="now" className="text-xs gap-1.5">
                      <Lock className="h-3.5 w-3.5" />
                      Reservar agora
                    </TabsTrigger>
                    <TabsTrigger value="schedule" className="text-xs gap-1.5">
                      <CalendarClock className="h-3.5 w-3.5" />
                      Agendar
                    </TabsTrigger>
                  </TabsList>

                  {/* Common fields */}
                  <div className="space-y-3 pt-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Pessoa</Label>
                      <Select value={selectedPersonId} onValueChange={setSelectedPersonId}>
                        <SelectTrigger className="h-9 text-sm">
                          <SelectValue placeholder="Selecione uma pessoa..." />
                        </SelectTrigger>
                        <SelectContent>
                          {pessoas.map((p) => (
                            <SelectItem key={p.id} value={p.id} className="text-sm">
                              {p.nome}
                              <span className="text-muted-foreground ml-2 text-xs">
                                ({p.tipo === "funcionario" ? "Func." : "Cliente"}{p.matricula ? ` • ${p.matricula}` : ""})
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs">Tipo de uso</Label>
                      <Select value={usageType} onValueChange={setUsageType}>
                        <SelectTrigger className="h-9 text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="permanent">Permanente</SelectItem>
                          <SelectItem value="temporary">Temporário</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <TabsContent value="now" className="space-y-3 mt-3">
                    {usageType === "temporary" && (
                      <div className="space-y-2">
                        <Label className="text-xs">Duração rápida</Label>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {DURATION_PRESETS.map((p) => (
                            <button
                              key={p.hours}
                              onClick={() => applyDurationPreset(p.hours, "now")}
                              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground transition-all"
                            >
                              {p.label}
                            </button>
                          ))}
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs">Ou escolha data/hora</Label>
                          <Input
                            type="datetime-local"
                            value={expiresAt}
                            onChange={(e) => setExpiresAt(e.target.value)}
                            min={new Date().toISOString().slice(0, 16)}
                            className="h-9 text-sm"
                          />
                        </div>
                      </div>
                    )}
                    <Button
                      onClick={() => setConfirmAction("reserve")}
                      disabled={loading || !canReserve}
                      className="w-full h-11 gradient-primary border-0 text-primary-foreground font-semibold rounded-xl shadow-lg shadow-primary/20 hover:opacity-90"
                    >
                      <Lock className="mr-2 h-4 w-4" />
                      Reservar agora
                    </Button>
                  </TabsContent>

                  <TabsContent value="schedule" className="space-y-3 mt-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Início do agendamento</Label>
                      <Input
                        type="datetime-local"
                        value={schedStartsAt}
                        onChange={(e) => setSchedStartsAt(e.target.value)}
                        min={new Date().toISOString().slice(0, 16)}
                        className="h-9 text-sm"
                      />
                    </div>
                    {usageType === "temporary" && (
                      <div className="space-y-2">
                        <Label className="text-xs">Duração</Label>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {DURATION_PRESETS.map((p) => (
                            <button
                              key={p.hours}
                              onClick={() => applyDurationPreset(p.hours, "schedule")}
                              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                                schedDurationPreset === p.hours
                                  ? "bg-primary text-primary-foreground"
                                  : "bg-muted/50 text-muted-foreground hover:bg-muted"
                              }`}
                            >
                              {p.label}
                            </button>
                          ))}
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs">Ou escolha fim</Label>
                          <Input
                            type="datetime-local"
                            value={schedExpiresAt}
                            onChange={(e) => { setSchedExpiresAt(e.target.value); setSchedDurationPreset(null); }}
                            min={schedStartsAt || new Date().toISOString().slice(0, 16)}
                            className="h-9 text-sm"
                          />
                        </div>
                      </div>
                    )}
                    <Button
                      onClick={() => setConfirmAction("schedule")}
                      disabled={loading || actionLoading || !canSchedule}
                      className="w-full h-11 gradient-primary border-0 text-primary-foreground font-semibold rounded-xl shadow-lg shadow-primary/20 hover:opacity-90"
                    >
                      <CalendarClock className="mr-2 h-4 w-4" />
                      Agendar reserva
                    </Button>
                  </TabsContent>
                </Tabs>
              </div>
            )}

            {/* Hygienizing info */}
            {door.status === "hygienizing" && (
              <div className="p-3.5 rounded-xl bg-cyan-500/10 border border-cyan-500/20 space-y-2">
                <div className="flex items-center gap-2">
                  <Droplets className="h-4 w-4 text-cyan-600" />
                  <p className="text-xs font-semibold text-cyan-700 dark:text-cyan-400 uppercase tracking-wider">Em higienização</p>
                </div>
                {door.expires_at && (
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">
                      Disponível em: {new Date(door.expires_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Actions for occupied/maintenance/hygienizing */}
            <div className="space-y-2.5">
              {(isCurrentUser || isAdmin) && door.status === "occupied" && (
                <Button
                  onClick={() => setConfirmAction("release")}
                  disabled={loading}
                  variant="outline"
                  className="w-full h-11 rounded-xl font-semibold border-destructive/30 text-destructive hover:bg-destructive/10"
                >
                  <Unlock className="mr-2 h-4 w-4" />
                  Liberar armário
                </Button>
              )}

              {isAdmin && door.status === "hygienizing" && (
                <Button
                  onClick={() => setConfirmAction("unmaintenance")}
                  disabled={loading}
                  variant="outline"
                  className="w-full h-11 rounded-xl font-semibold border-cyan-300/50 text-cyan-600 hover:bg-cyan-50 dark:hover:bg-cyan-950/30"
                >
                  <Unlock className="mr-2 h-4 w-4" />
                  Liberar manualmente (pular higienização)
                </Button>
              )}

              {isAdmin && door.status !== "maintenance" && door.status !== "hygienizing" && (
                <Button
                  onClick={() => setConfirmAction("maintenance")}
                  disabled={loading}
                  variant="outline"
                  className="w-full h-10 rounded-xl text-sm font-medium border-amber-300/50 text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/30"
                >
                  <Wrench className="mr-2 h-3.5 w-3.5" />
                  Colocar em manutenção
                </Button>
              )}

              {isAdmin && door.status === "maintenance" && (
                <Button
                  onClick={() => setConfirmAction("unmaintenance")}
                  disabled={loading}
                  variant="outline"
                  className="w-full h-10 rounded-xl text-sm font-medium border-emerald-300/50 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
                >
                  <Unlock className="mr-2 h-3.5 w-3.5" />
                  Retirar da manutenção
                </Button>
              )}
            </div>

            {/* Waitlist section */}
            {isAdmin && door.locker_id && (
              <FilaEspera lockerId={door.locker_id} lockerName={`Armário`} onRefresh={onRefresh} />
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Confirmation dialog */}
      <AlertDialog open={!!confirmAction} onOpenChange={(open) => !open && setConfirmAction(null)}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>{config?.title}</AlertDialogTitle>
            <AlertDialogDescription>{config?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl" disabled={loading || actionLoading}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirm}
              disabled={loading || actionLoading}
              className={`rounded-xl ${config?.variant === "destructive" ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : "gradient-primary border-0 text-primary-foreground hover:opacity-90"}`}
            >
              {loading || actionLoading ? "Processando..." : config?.actionLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
