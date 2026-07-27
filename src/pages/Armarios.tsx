import { useState, useEffect, useCallback, useMemo } from "react";
import { motion } from "framer-motion";
import { Plus, Lock, Unlock, Wrench, Package, Search, Trash2, LayoutGrid, List, Filter, ArrowUpDown, MapPin, ChevronDown, ChevronLeft, ChevronRight, FileBarChart, CalendarClock, Droplets } from "lucide-react";
import { supabase } from "@/lib/supabase-compat";
import api from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/ContextoAutenticacao";
import { useCompany } from "@/contexts/ContextoEmpresa";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import UnidadeArmario, { LockerData } from "@/components/armario/UnidadeArmario";
import { LockerDoorData } from "@/components/armario/PortaArmario";
import DetalhePortaPainel, { LockerDoorDataExtended } from "@/components/armario/DetalhePortaPainel";
import RelatorioOcupacao from "@/components/armario/RelatorioOcupacao";
import FeedbackSucessoOverlay, { useFeedbackSucesso } from "@/components/armario/FeedbackSucesso";
import { useFeedbackSonoro } from "@/hooks/useFeedbackSonoro";
import { AgentStatusBadge } from "@/components/armario/AgentStatusBadge";
import { BotaoEmergencia } from "@/components/armario/BotaoEmergencia";

interface LockerWithDoors extends LockerData {
  doors: LockerDoorData[];
  created_at: string;
}

export default function LockersPage() {
  const { user } = useAuth();
  const { selectedCompany, isSuperAdmin, userRole } = useCompany();
  const { toast } = useToast();
  const [lockers, setLockers] = useState<LockerWithDoors[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [locationFilter, setLocationFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("name");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 9;
  const [selectedDoor, setSelectedDoor] = useState<LockerDoorDataExtended | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const { active: feedbackActive, trigger: triggerFeedback } = useFeedbackSucesso();
  const { play: playSound } = useFeedbackSonoro();

  // New locker form
  const [newName, setNewName] = useState("");
  const [newLocation, setNewLocation] = useState("");
  const [newOrientation, setNewOrientation] = useState<"vertical" | "horizontal">("vertical");
  const [newCols, setNewCols] = useState(2);
  const [newRows, setNewRows] = useState(4);
  const [newDoorSize, setNewDoorSize] = useState<"small" | "medium" | "large">("medium");
  const [newBoardAddress, setNewBoardAddress] = useState("");
  const [newBoardPort, setNewBoardPort] = useState(4370);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editLocker, setEditLocker] = useState<LockerData | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editLocation, setEditLocation] = useState("");
  const [editBoardAddress, setEditBoardAddress] = useState("");
  const [editBoardPort, setEditBoardPort] = useState(4370);
  const [deleteLocker, setDeleteLocker] = useState<LockerData | null>(null);

  const fetchLockers = useCallback(async () => {
    setLoading(true);
    let lockersQuery = supabase.from("lockers").select("*").order("created_at");
    if (selectedCompany) {
      lockersQuery = lockersQuery.eq("company_id", selectedCompany.id);
    }
    const [{ data: lockersData }, { data: doorsData }, { data: scheduledData }] = await Promise.all([
      lockersQuery,
      supabase.from("locker_doors").select("*"),
      supabase.from("locker_reservations").select("id, door_id, person_id, starts_at, expires_at").eq("status", "scheduled"),
    ]);

    // Fetch person names for scheduled reservations
    let personMap: Record<string, string> = {};
    if (scheduledData && scheduledData.length > 0) {
      const personIds = [...new Set(scheduledData.map((r: any) => r.person_id).filter(Boolean))];
      if (personIds.length > 0) {
        const { data: persons } = await supabase.from("funcionarios_clientes").select("id, nome").in("id", personIds);
        if (persons) {
          personMap = Object.fromEntries(persons.map((p: any) => [p.id, p.nome]));
        }
      }
    }

    // Map scheduled reservations by door_id
    const scheduledByDoor: Record<string, any> = {};
    if (scheduledData) {
      for (const r of scheduledData as any[]) {
        // Keep only the nearest future reservation per door
        if (!scheduledByDoor[r.door_id] || new Date(r.starts_at) < new Date(scheduledByDoor[r.door_id].starts_at)) {
          scheduledByDoor[r.door_id] = {
            id: r.id,
            door_id: r.door_id,
            person_name: r.person_id ? personMap[r.person_id] : undefined,
            starts_at: r.starts_at,
            expires_at: r.expires_at,
          };
        }
      }
    }

    // Fetch person names for occupied doors
    let occupiedPersonMap: Record<string, string> = {};
    if (doorsData) {
      const occupiedPersonIds = [...new Set(doorsData.map((d: any) => d.occupied_by_person).filter(Boolean))];
      if (occupiedPersonIds.length > 0) {
        const { data: occupiedPersons } = await supabase.from("funcionarios_clientes").select("id, nome").in("id", occupiedPersonIds);
        if (occupiedPersons) {
          occupiedPersonMap = Object.fromEntries(occupiedPersons.map((p: any) => [p.id, p.nome]));
        }
      }
    }

    if (lockersData && doorsData) {
      const merged: LockerWithDoors[] = lockersData.map((l: any) => ({
        ...l,
        doors: doorsData
          .filter((d: any) => d.locker_id === l.id)
          .map((d: any) => ({
            ...d,
            person_name: d.occupied_by_person ? occupiedPersonMap[d.occupied_by_person] || null : null,
            scheduledReservation: scheduledByDoor[d.id] || null,
          })),
      }));
      setLockers(merged);
    }
    setLoading(false);
  }, [selectedCompany]);

  useEffect(() => {
    fetchLockers();
    if (user) {
      supabase.from("profiles").select("role").eq("user_id", user.id).single()
        .then(({ data }) => {
          if (data?.role === "admin" || data?.role === "superadmin") setIsAdmin(true);
        });
    }
  }, [user, fetchLockers, selectedCompany]);

  // Agent heartbeat polling
  // Agent heartbeat polling agora é feito pelo componente AgentStatusBadge

  const handleCreateLocker = async () => {
    if (!newName.trim()) return;
    setActionLoading(true);

    const { data: locker, error } = await supabase
      .from("lockers")
      .insert({ name: newName, location: newLocation, orientation: newOrientation, columns: newCols, rows: newRows, company_id: selectedCompany?.id || null, board_address: newBoardAddress || null, board_port: newBoardPort })
      .select()
      .single();

    if (error || !locker) {
      toast({ title: "Erro ao criar armário", description: error?.message, variant: "destructive" });
      setActionLoading(false);
      return;
    }

    const totalDoors = newCols * newRows;
    const doors = Array.from({ length: totalDoors }, (_, i) => ({
      locker_id: locker.id,
      door_number: i + 1,
      size: newDoorSize,
      status: "available" as const,
    }));

    const { error: doorsError } = await supabase.from("locker_doors").insert(doors);
    if (doorsError) {
      toast({ title: "Erro ao criar portas", description: doorsError.message, variant: "destructive" });
    } else {
      toast({ title: "Armário criado!", description: `${newName} com ${totalDoors} portas.` });
      setCreateDialogOpen(false);
      setNewName("");
      setNewLocation("");
      setNewBoardAddress("");
      setNewBoardPort(4370);
      fetchLockers();
    }
    setActionLoading(false);
  };

  // Helper to send WhatsApp notification (non-blocking)
  const sendWhatsAppNotify = useCallback(async (payload: Record<string, unknown>) => {
    try {
      await supabase.functions.invoke("whatsapp-locker-notify", { body: payload });
    } catch {
      // Non-blocking, don't show errors to user
    }
  }, []);

  // Helper to notify waitlist when a door is released (non-blocking)
  const notifyWaitlist = useCallback(async (lockerId: string, companyId: string, doorLabel: string | null, doorNumber: number, lockerName: string) => {
    try {
      await supabase.functions.invoke("waitlist-notify", {
        body: { lockerId, companyId, doorLabel, doorNumber, lockerName },
      });
    } catch {
      // Non-blocking
    }
  }, []);

  const handleReserve = async (door: LockerDoorData | LockerDoorDataExtended, personId?: string, usageType?: string, expiresAt?: string | null) => {
    if (!user) return;
    setActionLoading(true);
    const updateData: any = {
      status: "occupied",
      occupied_by: user.id,
      occupied_at: new Date().toISOString(),
      occupied_by_person: personId || null,
      usage_type: usageType || "temporary",
      expires_at: expiresAt || null,
    };
    const { error } = await supabase
      .from("locker_doors")
      .update(updateData)
      .eq("id", door.id);

    if (error) {
      toast({ title: "Erro ao reservar", description: error.message, variant: "destructive" });
    } else {
      const extDoor = door as LockerDoorDataExtended;
      await supabase.from("locker_reservations").insert({
        door_id: door.id,
        locker_id: extDoor.locker_id || "",
        person_id: personId || null,
        reserved_by: user.id,
        usage_type: usageType || "temporary",
        status: "active",
        expires_at: expiresAt || null,
      });
      toast({ title: "Reservado!", description: `Porta ${door.label || '#' + door.door_number} reservada com sucesso.` });
      triggerFeedback("reserve");
      playSound("reserve");

      // WhatsApp notification (non-blocking)
      if (personId && selectedCompany) {
        const locker = lockers.find(l => l.doors.some(d => d.id === door.id));
        sendWhatsAppNotify({
          type: "reservation_confirmed",
          companyId: selectedCompany?.id,
          personId,
          doorLabel: door.label,
          doorNumber: door.door_number,
          lockerName: locker?.name,
          expiresAt,
        });
      }

      setSheetOpen(false);
      fetchLockers();
    }
    setActionLoading(false);
  };

  const handleRelease = async (door: LockerDoorData | LockerDoorDataExtended) => {
    setActionLoading(true);

    // Check if company has hygienization enabled
    let useHygienization = false;
    let hygienizationMinutes = 15;

    if (selectedCompany && door.status === "occupied") {
      const { data: hygPerm } = await supabase
        .from("company_permissions")
        .select("enabled")
        .eq("company_id", selectedCompany.id)
        .eq("permission", "hygienization_enabled")
        .maybeSingle();

      if (hygPerm?.enabled) {
        useHygienization = true;
        const { data: minutesData } = await supabase
          .from("platform_settings")
          .select("value")
          .eq("key", `hygienization_minutes_${selectedCompany.id}`)
          .maybeSingle();
        if (minutesData?.value) {
          hygienizationMinutes = parseInt(String(minutesData.value)) || 15;
        }
      }
    }

    // For hygienizing doors being manually released by admin, skip hygienization
    const isHygienizingDoor = door.status === "hygienizing";

    if (useHygienization && !isHygienizingDoor) {
      // Set to hygienizing with expiry
      const hygienizationExpiry = new Date(Date.now() + hygienizationMinutes * 60 * 1000).toISOString();
      const { error } = await supabase
        .from("locker_doors")
        .update({
          status: "hygienizing",
          occupied_by: null,
          occupied_at: null,
          occupied_by_person: null,
          usage_type: "temporary",
          expires_at: hygienizationExpiry,
          scheduled_reservation_id: null,
        })
        .eq("id", door.id);

      if (!error) {
        await supabase
          .from("locker_reservations")
          .update({ status: "released", released_at: new Date().toISOString() })
          .eq("door_id", door.id)
          .eq("status", "active");
      }

      if (error) {
        toast({ title: "Erro ao liberar", description: error.message, variant: "destructive" });
      } else {
        toast({ title: "Em higienização!", description: `Porta ${door.label || '#' + door.door_number} em higienização por ${hygienizationMinutes} minutos.` });
        triggerFeedback("release");
        playSound("release");
        setSheetOpen(false);
        fetchLockers();
      }
    } else {
      // Normal release (or manual release of hygienizing door)
      const { error } = await supabase
        .from("locker_doors")
        .update({ status: "available", occupied_by: null, occupied_at: null, occupied_by_person: null, usage_type: "temporary", expires_at: null, scheduled_reservation_id: null })
        .eq("id", door.id);

      if (!error) {
        await supabase
          .from("locker_reservations")
          .update({ status: "released", released_at: new Date().toISOString() })
          .eq("door_id", door.id)
          .in("status", ["active"]);
      }

      if (error) {
        toast({ title: "Erro ao liberar", description: error.message, variant: "destructive" });
      } else {
        toast({ title: "Liberado!", description: `Porta ${door.label || '#' + door.door_number} liberada.` });
        triggerFeedback("release");
        playSound("release");

        // WhatsApp notification (non-blocking)
        if (door.occupied_by && selectedCompany) {
          const locker = lockers.find(l => l.doors.some(d => d.id === door.id));
          const extDoor = door as LockerDoorDataExtended;
          sendWhatsAppNotify({
            type: "reservation_released",
            companyId: selectedCompany?.id,
            personId: extDoor.occupied_by_person || undefined,
            doorLabel: door.label,
            doorNumber: door.door_number,
            lockerName: locker?.name,
          });

          // Notify waitlist (non-blocking)
          if (locker) {
            notifyWaitlist(locker.id, selectedCompany.id, door.label, door.door_number, locker.name);
          }
        }

        setSheetOpen(false);
        fetchLockers();
      }
    }
    setActionLoading(false);
  };

  const handleSetMaintenance = async (door: LockerDoorData | LockerDoorDataExtended) => {
    setActionLoading(true);
    const { error } = await supabase
      .from("locker_doors")
      .update({ status: "maintenance", occupied_by: null, occupied_at: null, occupied_by_person: null, usage_type: "temporary", expires_at: null })
      .eq("id", door.id);
    if (error) {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Manutenção", description: `Porta ${door.label || '#' + door.door_number} em manutenção.` });
      triggerFeedback("maintenance");
      playSound("maintenance");
      setSheetOpen(false);
      fetchLockers();
    }
    setActionLoading(false);
  };

  const openEditDialog = (locker: LockerData) => {
    setEditLocker(locker);
    setEditName(locker.name);
    setEditLocation(locker.location);
    setEditBoardAddress(locker.board_address || "");
    setEditBoardPort(locker.board_port || 4370);
    setEditDialogOpen(true);
  };

  const handleEditLocker = async () => {
    if (!editLocker || !editName.trim()) return;
    setActionLoading(true);
    const { error } = await supabase
      .from("lockers")
      .update({ name: editName, location: editLocation, board_address: editBoardAddress, board_port: editBoardPort })
      .eq("id", editLocker.id);

    if (error) {
      toast({ title: "Erro ao editar", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Atualizado!", description: `${editName} atualizado com sucesso.` });
      setEditDialogOpen(false);
      fetchLockers();
    }
    setActionLoading(false);
  };

  const handleDeleteLocker = async () => {
    if (!deleteLocker) return;
    setActionLoading(true);
    try {
      await api.delete(`/lockers/${deleteLocker.id}`);
      toast({ title: "Excluído!", description: `${deleteLocker.name} removido.` });
      setDeleteLocker(null);
      fetchLockers();
    } catch (err: any) {
      const msg = err.response?.data?.error || err.message || "Erro ao excluir armário";
      toast({ title: "Erro ao excluir", description: msg, variant: "destructive" });
    }
    setActionLoading(false);
  };

  // Emergência agora é gerenciada pelo componente BotaoEmergencia

  // Unique locations for filter
  const uniqueLocations = [...new Set(lockers.map((l) => l.location).filter(Boolean))];

  // Door counts for filter badges
  const allDoors = lockers.flatMap((l) => l.doors);
  const doorCounts = {
    all: allDoors.length,
    available: allDoors.filter((d) => d.status === "available").length,
    occupied: allDoors.filter((d) => d.status === "occupied").length,
    maintenance: allDoors.filter((d) => d.status === "maintenance").length,
    scheduled: allDoors.filter((d) => !!d.scheduledReservation).length,
    hygienizing: allDoors.filter((d) => d.status === "hygienizing").length,
  };

  const filteredLockers = lockers
    .map((l) => {
      if (statusFilter === "all") return l;
      if (statusFilter === "scheduled") return { ...l, doors: l.doors.filter((d) => !!d.scheduledReservation) };
      if (statusFilter === "hygienizing") return { ...l, doors: l.doors.filter((d) => d.status === "hygienizing") };
      return { ...l, doors: l.doors.filter((d) => d.status === statusFilter) };
    })
    .filter((l) => {
      if (l.doors.length === 0 && statusFilter !== "all") return false;
      const matchSearch = l.name.toLowerCase().includes(search.toLowerCase()) || l.location.toLowerCase().includes(search.toLowerCase());
      const matchLocation = locationFilter === "all" || l.location === locationFilter;
      return matchSearch && matchLocation;
    })
    .sort((a, b) => {
      switch (sortBy) {
        case "name": return a.name.localeCompare(b.name);
        case "location": return a.location.localeCompare(b.location);
        case "doors": return b.doors.length - a.doors.length;
        case "occupation": {
          const occA = a.doors.length ? a.doors.filter((d) => d.status === "occupied").length / a.doors.length : 0;
          const occB = b.doors.length ? b.doors.filter((d) => d.status === "occupied").length / b.doors.length : 0;
          return occB - occA;
        }
        case "created": return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        default: return 0;
      }
    });

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredLockers.length / ITEMS_PER_PAGE));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedLockers = filteredLockers.slice((safePage - 1) * ITEMS_PER_PAGE, safePage * ITEMS_PER_PAGE);

  // Stats
  const stats = [
    { label: "Total de Portas", value: allDoors.length, icon: Package, accent: "" },
    { label: "Disponíveis", value: doorCounts.available, icon: Unlock, accent: "success" },
    { label: "Ocupados", value: doorCounts.occupied, icon: Lock, accent: "primary" },
    { label: "Manutenção", value: doorCounts.maintenance, icon: Wrench, accent: "accent" },
    { label: "Higienização", value: doorCounts.hygienizing, icon: Droplets, accent: "cyan" },
    { label: "Agendados", value: doorCounts.scheduled, icon: CalendarClock, accent: "violet" },
  ];

  const emergencyLockIds = useMemo(
    () => [
      ...new Set(
        lockers
          .flatMap((locker) => locker.doors)
          .map((door) => door.lock_id)
          .filter((lockId): lockId is number => Number.isInteger(lockId) && lockId > 0)
      ),
    ],
    [lockers]
  );

  return (
    <>
    <FeedbackSucessoOverlay active={feedbackActive} />
    <div className="space-y-5 md:space-y-8">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl md:text-2xl font-bold text-foreground">Armários</h1>
              {isAdmin && <AgentStatusBadge />}
            </div>
            <p className="text-xs md:text-sm text-muted-foreground mt-0.5">Visualize e gerencie os armários inteligentes.</p>
          </div>
          {isAdmin && (
            <div className="flex items-center gap-2">
              {isSuperAdmin && (
                <BotaoEmergencia companyId={selectedCompany?.id} lockIds={emergencyLockIds} />
              )}
              <Button size="sm" variant="outline" className="gap-1.5 rounded-xl text-xs md:text-sm" onClick={() => setReportOpen(true)}>
                <FileBarChart className="h-4 w-4" />
                <span className="hidden sm:inline">Relatório</span>
              </Button>
            <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-1.5 gradient-primary border-0 text-primary-foreground hover:opacity-90 rounded-xl shadow-md shadow-primary/20 text-xs md:text-sm">
                  <Plus className="h-4 w-4" />
                  <span className="hidden sm:inline">Novo Armário</span>
                  <span className="sm:hidden">Novo</span>
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md rounded-2xl mx-4">
                <DialogHeader>
                  <DialogTitle>Criar Novo Armário</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label>Nome</Label>
                    <Input placeholder="Ex: Armário A" value={newName} onChange={(e) => setNewName(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Localização</Label>
                    <Input placeholder="Ex: Lobby Principal" value={newLocation} onChange={(e) => setNewLocation(e.target.value)} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Orientação</Label>
                      <Select value={newOrientation} onValueChange={(v) => setNewOrientation(v as any)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="vertical">Vertical</SelectItem>
                          <SelectItem value="horizontal">Horizontal</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Tamanho das Portas</Label>
                      <Select value={newDoorSize} onValueChange={(v) => setNewDoorSize(v as any)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="small">Pequeno</SelectItem>
                          <SelectItem value="medium">Médio</SelectItem>
                          <SelectItem value="large">Grande</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Colunas</Label>
                      <Input type="number" min={1} max={10} value={newCols} onChange={(e) => setNewCols(Number(e.target.value))} />
                    </div>
                    <div className="space-y-2">
                      <Label>Linhas</Label>
                      <Input type="number" min={1} max={10} value={newRows} onChange={(e) => setNewRows(Number(e.target.value))} />
                    </div>
                  </div>

                  <div className="border-t border-border/40 pt-4">
                    <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider mb-3">Placa Controladora</p>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Endereço IP</Label>
                        <Input placeholder="Ex: 192.168.1.100" value={newBoardAddress} onChange={(e) => setNewBoardAddress(e.target.value)} />
                      </div>
                      <div className="space-y-2">
                        <Label>Porta TCP</Label>
                        <Input type="number" min={1} max={65535} value={newBoardPort} onChange={(e) => setNewBoardPort(Number(e.target.value))} />
                      </div>
                    </div>
                  </div>

                  {/* Preview */}
                  <div className="p-4 rounded-xl bg-muted/30 border border-border/40">
                    <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider mb-3">Prévia</p>
                    <div
                      className="grid gap-1.5"
                      style={{ gridTemplateColumns: `repeat(${newOrientation === "horizontal" ? newRows : newCols}, minmax(0, 1fr))` }}
                    >
                      {Array.from({ length: newCols * newRows }).map((_, i) => (
                        <div
                          key={i}
                          className={`rounded-lg border-2 border-dashed border-success/30 bg-success/5 flex items-center justify-center ${
                            newDoorSize === "small" ? "h-8" : newDoorSize === "medium" ? "h-12" : "h-16"
                          }`}
                        >
                          <span className="text-[9px] font-mono text-muted-foreground">{i + 1}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="outline" className="rounded-xl">Cancelar</Button>
                  </DialogClose>
                  <Button onClick={handleCreateLocker} disabled={actionLoading || !newName.trim()} className="gradient-primary border-0 rounded-xl hover:opacity-90">
                    {actionLoading ? "Criando..." : "Criar Armário"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            </div>
          )}
        </div>

        {/* Search + Filters row */}
        <div className="flex flex-col gap-2">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <div className="relative flex-1 sm:flex-none">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Buscar armário..." className="pl-9 h-9 w-full sm:w-52 bg-muted/50 border-transparent" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {/* Status filter with counters */}
              <div className="flex items-center bg-muted/50 rounded-lg p-0.5 gap-0.5 overflow-x-auto flex-1 sm:flex-none">
                {[
                  { value: "all", label: "Todos", count: doorCounts.all },
                  { value: "available", label: "Livres", count: doorCounts.available },
                  { value: "occupied", label: "Ocupados", count: doorCounts.occupied },
                  { value: "maintenance", label: "Manut.", count: doorCounts.maintenance },
                  { value: "scheduled", label: "Agendados", count: doorCounts.scheduled },
                  { value: "hygienizing", label: "Higieniz.", count: doorCounts.hygienizing },
                ].map((f) => (
                  <button
                    key={f.value}
                    onClick={() => { setStatusFilter(f.value); setCurrentPage(1); }}
                    className={`px-2.5 py-1.5 rounded-md text-[11px] font-medium transition-all whitespace-nowrap flex items-center gap-1.5 ${
                      statusFilter === f.value
                        ? f.value === "scheduled"
                          ? "bg-violet-500/15 text-violet-700 dark:text-violet-300 shadow-sm ring-1 ring-violet-500/20"
                          : f.value === "hygienizing"
                            ? "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 shadow-sm ring-1 ring-cyan-500/20"
                            : "bg-background text-foreground shadow-sm"
                        : f.value === "scheduled"
                          ? "text-violet-500/70 hover:text-violet-600 dark:hover:text-violet-400"
                          : f.value === "hygienizing"
                            ? "text-cyan-500/70 hover:text-cyan-600 dark:hover:text-cyan-400"
                            : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {f.label}
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                      statusFilter === f.value
                        ? f.value === "scheduled"
                          ? "bg-violet-500/20 text-violet-700 dark:text-violet-300"
                          : f.value === "hygienizing"
                            ? "bg-cyan-500/20 text-cyan-700 dark:text-cyan-300"
                            : "bg-primary/10 text-primary"
                        : f.value === "scheduled"
                          ? "bg-violet-500/10 text-violet-500"
                          : f.value === "hygienizing"
                            ? "bg-cyan-500/10 text-cyan-500"
                            : "bg-muted-foreground/10"
                    }`}>
                      {f.count}
                    </span>
                  </button>
                ))}
              </div>

              {/* Location filter */}
              {uniqueLocations.length > 0 && (
                <Select value={locationFilter} onValueChange={setLocationFilter}>
                  <SelectTrigger className="h-9 w-auto min-w-[140px] bg-muted/50 border-transparent text-xs">
                    <MapPin className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
                    <SelectValue placeholder="Localização" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-xs">Todas localizações</SelectItem>
                    {uniqueLocations.map((loc) => (
                      <SelectItem key={loc} value={loc} className="text-xs">{loc}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {/* Sort */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-9 px-2.5 bg-muted/50 text-xs gap-1.5">
                    <ArrowUpDown className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Ordenar</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  {[
                    { value: "name", label: "Nome" },
                    { value: "location", label: "Localização" },
                    { value: "doors", label: "Nº de Portas" },
                    { value: "occupation", label: "% Ocupação" },
                    { value: "created", label: "Data de criação" },
                  ].map((s) => (
                    <DropdownMenuItem
                      key={s.value}
                      onClick={() => setSortBy(s.value)}
                      className={`text-xs ${sortBy === s.value ? "bg-primary/10 text-primary" : ""}`}
                    >
                      {s.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              {/* View mode */}
              <div className="flex items-center bg-muted/50 rounded-lg p-0.5 gap-0.5 flex-shrink-0">
                <button onClick={() => setViewMode("grid")} className={`p-1.5 rounded-md transition-all ${viewMode === "grid" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                  <LayoutGrid className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => setViewMode("list")} className={`p-1.5 rounded-md transition-all ${viewMode === "list" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                  <List className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 md:gap-4">
        {stats.map((stat, i) => (
          <motion.div key={stat.label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}>
            <Card className="shadow-card hover:shadow-elevated transition-shadow border-border/50">
              <CardContent className="p-3 md:p-5">
                <div className={`rounded-lg p-1.5 md:p-2 w-fit mb-2 md:mb-3 ${
                  stat.accent === "success" ? "bg-success/10" :
                  stat.accent === "primary" ? "bg-primary/10" :
                  stat.accent === "accent" ? "bg-accent/10" :
                  stat.accent === "cyan" ? "bg-cyan-500/10" :
                  stat.accent === "violet" ? "bg-violet-500/10" : "bg-muted"
                }`}>
                  <stat.icon className={`h-3.5 w-3.5 md:h-4 md:w-4 ${
                    stat.accent === "success" ? "text-success" :
                    stat.accent === "primary" ? "text-primary" :
                    stat.accent === "accent" ? "text-accent" :
                    stat.accent === "cyan" ? "text-cyan-600" :
                    stat.accent === "violet" ? "text-violet-600" : "text-muted-foreground"
                  }`} />
                </div>
                <p className="text-2xl md:text-3xl font-extrabold text-foreground tracking-tight">{stat.value}</p>
                <p className="text-xs md:text-sm text-muted-foreground mt-0.5">{stat.label}</p>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Status Legend + Distribution Summary */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-4">
        {/* Legend bar */}
        <Card className="shadow-card border-border/50">
          <CardContent className="p-3 md:p-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Legenda de Status</p>
            <div className="flex flex-wrap gap-3">
              {[
                { label: "Livre", color: "bg-emerald-500", textColor: "text-emerald-700 dark:text-emerald-300", icon: Unlock },
                { label: "Ocupado", color: "bg-rose-500", textColor: "text-rose-700 dark:text-rose-300", icon: Lock },
                { label: "Manutenção", color: "bg-amber-500", textColor: "text-amber-700 dark:text-amber-300", icon: Wrench },
                { label: "Higienização", color: "bg-cyan-500", textColor: "text-cyan-700 dark:text-cyan-300", icon: Droplets },
                { label: "Agendado", color: "bg-violet-500", textColor: "text-violet-700 dark:text-violet-300", icon: CalendarClock },
              ].map((item) => (
                <div key={item.label} className="flex items-center gap-2 bg-muted/40 rounded-lg px-3 py-1.5">
                  <div className={cn("h-2.5 w-2.5 rounded-full", item.color)} />
                  <item.icon className={cn("h-3.5 w-3.5", item.textColor)} />
                  <span className={cn("text-xs font-medium", item.textColor)}>{item.label}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Mini distribution chart */}
        {allDoors.length > 0 && (
          <Card className="shadow-card border-border/50 min-w-[220px]">
            <CardContent className="p-3 md:p-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Distribuição</p>
              <div className="space-y-2">
                {[
                  { label: "Livre", count: doorCounts.available, color: "bg-emerald-500", pct: Math.round((doorCounts.available / allDoors.length) * 100) },
                  { label: "Ocupado", count: doorCounts.occupied, color: "bg-rose-500", pct: Math.round((doorCounts.occupied / allDoors.length) * 100) },
                  { label: "Manutenção", count: doorCounts.maintenance, color: "bg-amber-500", pct: Math.round((doorCounts.maintenance / allDoors.length) * 100) },
                  { label: "Higienização", count: doorCounts.hygienizing, color: "bg-cyan-500", pct: Math.round((doorCounts.hygienizing / allDoors.length) * 100) },
                ].filter(s => s.count > 0).map((s) => (
                  <div key={s.label} className="flex items-center gap-2">
                    <span className="text-[10px] font-medium text-muted-foreground w-16 truncate">{s.label}</span>
                    <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${s.pct}%` }}
                        transition={{ duration: 0.8, ease: "easeOut" }}
                        className={cn("h-full rounded-full", s.color)}
                      />
                    </div>
                    <span className="text-[10px] font-bold text-foreground/70 w-8 text-right">{s.pct}%</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </motion.div>

      {/* Lockers Grid */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      ) : filteredLockers.length === 0 ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-16">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-muted/50 flex items-center justify-center mb-4">
            <Package className="h-7 w-7 text-muted-foreground/50" />
          </div>
          <p className="text-muted-foreground font-medium">Nenhum armário encontrado.</p>
          <p className="text-sm text-muted-foreground/60 mt-1">
            {isAdmin ? "Crie um novo armário para começar." : "Aguarde um administrador cadastrar armários."}
          </p>
        </motion.div>
      ) : viewMode === "grid" ? (
        <div className="grid gap-4 md:gap-6 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
          {paginatedLockers.map((locker, i) => (
            <UnidadeArmario
              key={locker.id}
              locker={locker}
              doors={locker.doors}
              index={i}
              currentUserId={user?.id}
              isAdmin={isAdmin}
              onEdit={openEditDialog}
              onDelete={(l) => setDeleteLocker(l)}
              onSelectDoor={(door) => {
                setSelectedDoor({ ...door, locker_id: locker.id } as LockerDoorDataExtended);
                setSheetOpen(true);
              }}
              onQuickReserve={handleReserve}
              onQuickRelease={handleRelease}
            />
          ))}
        </div>
      ) : (
        /* Detailed List/Table View */
        <Card className="shadow-card border-border/50 overflow-hidden">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-xs uppercase tracking-wider font-semibold">Armário</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider font-semibold">Localização</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider font-semibold text-center">Portas</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider font-semibold">Ocupação</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider font-semibold text-center">Livres</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider font-semibold text-center">Ocupados</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider font-semibold text-center">Manut.</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider font-semibold text-center">Agendados</TableHead>
                  {isAdmin && <TableHead className="text-xs uppercase tracking-wider font-semibold text-right">Ações</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedLockers.map((locker) => {
                  const totalOriginalDoors = lockers.find(l => l.id === locker.id)?.doors.length || 0;
                  const available = locker.doors.filter((d) => d.status === "available").length;
                  const occupied = locker.doors.filter((d) => d.status === "occupied").length;
                  const maintenance = locker.doors.filter((d) => d.status === "maintenance").length;
                  const scheduled = locker.doors.filter((d) => !!(d as any).scheduledReservation).length;
                  const occupationPct = totalOriginalDoors > 0 ? Math.round((occupied / totalOriginalDoors) * 100) : 0;

                  return (
                    <TableRow key={locker.id} className="cursor-pointer hover:bg-muted/30">
                      <TableCell className="font-semibold text-sm">{locker.name}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                          <MapPin className="h-3.5 w-3.5" />
                          {locker.location || "—"}
                        </div>
                      </TableCell>
                      <TableCell className="text-center text-sm font-medium">{locker.doors.length}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2 min-w-[120px]">
                          <Progress value={occupationPct} className="h-2 flex-1" />
                          <span className="text-xs text-muted-foreground font-mono w-10 text-right">{occupationPct}%</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline" className="bg-success/10 text-success border-success/20 text-[11px]">{available}</Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 text-[11px]">{occupied}</Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline" className="bg-accent/10 text-accent border-accent/20 text-[11px]">{maintenance}</Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        {scheduled > 0 ? (
                          <Badge variant="outline" className="bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20 text-[11px] gap-1">
                            <CalendarClock className="h-3 w-3" />
                            {scheduled}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground/40 text-xs">—</span>
                        )}
                      </TableCell>
                      {isAdmin && (
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditDialog(locker)}>
                              <Filter className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setDeleteLocker(locker)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Pagination */}
      {!loading && filteredLockers.length > ITEMS_PER_PAGE && (
        <div className="flex items-center justify-between pt-2">
          <p className="text-xs text-muted-foreground">
            Mostrando {((safePage - 1) * ITEMS_PER_PAGE) + 1}–{Math.min(safePage * ITEMS_PER_PAGE, filteredLockers.length)} de {filteredLockers.length} armários
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              disabled={safePage <= 1}
              onClick={() => setCurrentPage(safePage - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
              <Button
                key={page}
                variant={page === safePage ? "default" : "outline"}
                size="icon"
                className={`h-8 w-8 text-xs ${page === safePage ? "gradient-primary border-0" : ""}`}
                onClick={() => setCurrentPage(page)}
              >
                {page}
              </Button>
            ))}
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              disabled={safePage >= totalPages}
              onClick={() => setCurrentPage(safePage + 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Door detail sheet */}
      <DetalhePortaPainel
        door={selectedDoor}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onReserve={(door, personId, usageType, expiresAt) => handleReserve(door, personId, usageType, expiresAt)}
        onRelease={handleRelease}
        isCurrentUser={selectedDoor?.occupied_by === user?.id}
        loading={actionLoading}
        isAdmin={isAdmin}
        onSetMaintenance={handleSetMaintenance}
        onRefresh={fetchLockers}
      />

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle>Editar Armário</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Localização</Label>
              <Input value={editLocation} onChange={(e) => setEditLocation(e.target.value)} />
            </div>
            <div className="border-t pt-4 mt-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Placa Controladora</p>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2 space-y-2">
                  <Label>IP / Endereço</Label>
                  <Input value={editBoardAddress} onChange={(e) => setEditBoardAddress(e.target.value)} placeholder="192.168.1.100" />
                </div>
                <div className="space-y-2">
                  <Label>Porta TCP</Label>
                  <Input type="number" value={editBoardPort} onChange={(e) => setEditBoardPort(parseInt(e.target.value) || 4370)} placeholder="4370" />
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">Endereço da placa que controla as fechaduras deste armário</p>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" className="rounded-xl">Cancelar</Button>
            </DialogClose>
            <Button onClick={handleEditLocker} disabled={actionLoading || !editName.trim()} className="gradient-primary border-0 rounded-xl hover:opacity-90">
              {actionLoading ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteLocker} onOpenChange={(open) => !open && setDeleteLocker(null)}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir armário?</AlertDialogTitle>
            <AlertDialogDescription>
              O armário <strong>{deleteLocker?.name}</strong> e todas as suas portas serão removidos permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteLocker} className="bg-destructive text-destructive-foreground hover:bg-destructive/90 rounded-xl">
              {actionLoading ? "Excluindo..." : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Occupation Report */}
      <RelatorioOcupacao open={reportOpen} onOpenChange={setReportOpen} />
    </div>
    </>
  );
}
