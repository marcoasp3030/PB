import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Smartphone, Save, Loader2, Copy, CheckCircle2, Shield,
  Unlock, History, Bell, RefreshCw, User, DoorOpen, Settings2,
  BookOpen, Code, ExternalLink, ChevronDown, ChevronRight
} from "lucide-react";
import { supabase } from "@/lib/supabase-compat";
import { useCompany } from "@/contexts/ContextoEmpresa";
import { toast } from "sonner";

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

/** URL pública da rota mobile (respeita VITE_API_URL ou o host atual). */
function obterUrlBaseMobile(): string {
  const envApi = String(import.meta.env.VITE_API_URL || "").trim().replace(/\/+$/, "");
  if (envApi) return `${envApi}/mobile`;
  if (typeof window !== "undefined") {
    return `${window.location.origin.replace(/\/+$/, "")}/api/mobile`;
  }
  return "/api/mobile";
}

const DEFAULT_FEATURES: AppFeatures = {
  abrir_fechadura: true,
  historico_comandos: true,
  notificacoes: true,
  renovacao: true,
  liberar_porta: true,
  perfil_edicao: true,
  fila_espera: true,
  branding_personalizado: false,
};

const FEATURE_INFO: Record<keyof AppFeatures, { label: string; description: string; icon: any }> = {
  abrir_fechadura: { label: "Abrir Fechadura", description: "Permite o usuário abrir sua fechadura pelo app", icon: Unlock },
  historico_comandos: { label: "Histórico de Comandos", description: "Visualizar histórico de aberturas e comandos", icon: History },
  notificacoes: { label: "Notificações", description: "Receber notificações de expiração e renovação", icon: Bell },
  renovacao: { label: "Solicitar Renovação", description: "Solicitar renovação de prazo pelo app", icon: RefreshCw },
  liberar_porta: { label: "Liberar Porta", description: "Devolver porta temporária pelo app", icon: DoorOpen },
  perfil_edicao: { label: "Editar Perfil", description: "Alterar telefone e preferências de notificação", icon: User },
  fila_espera: { label: "Fila de Espera", description: "Permitir entrada na fila de espera por uma porta", icon: History },
  branding_personalizado: { label: "Branding Personalizado", description: "Usar logo e cores da empresa no app", icon: Settings2 },
};

const API_ENDPOINTS = [
  { method: "GET", path: "/api/mobile/version", description: "Versão da API e flag de atualização obrigatória", body: null, response: '{ "success": true, "data": { "api_version": "1.0.0", "min_app_version": "1.0.0", "force_update": false } }', auth: false },
  { method: "POST", path: "/api/auth/login", description: "Autenticação do usuário", body: '{ "email": "user@email.com", "password": "senha123" }', response: '{ "token": "jwt...", "user": { "id": "uuid", "email": "..." } }', auth: false },
  { method: "GET", path: "/api/mobile/me", description: "Perfil completo do usuário + features habilitadas", body: null, response: '{ "success": true, "data": { "person": {...}, "app_features": {...} } }', auth: true },
  { method: "GET", path: "/api/mobile/portas", description: "Portas vinculadas ao usuário", body: null, response: '{ "success": true, "data": [{ "id": "...", "lock_id": 1, "locker_name": "..." }] }', auth: true },
  { method: "POST", path: "/api/mobile/abrir", description: "Enviar comando de abertura da fechadura", body: '{ "lock_id": 1 }', response: '{ "success": true, "id": 42, "message": "Comando enviado" }', auth: true },
  { method: "GET", path: "/api/mobile/comando/:id", description: "Consultar status de um comando", body: null, response: '{ "success": true, "data": { "id": 42, "status": "executado", "resposta": "board=0x0E lock=2" } }', auth: true },
  { method: "GET", path: "/api/mobile/historico", description: "Histórico de comandos com paginação", body: null, response: '{ "success": true, "data": [...], "total": 150 }', auth: true },
  { method: "GET", path: "/api/mobile/reservas", description: "Histórico completo de reservas do usuário", body: null, response: '{ "success": true, "data": [{ "id": "...", "status": "active", "locker_name": "..." }] }', auth: true },
  { method: "GET", path: "/api/mobile/notificacoes", description: "Notificações do usuário", body: null, response: '{ "success": true, "data": [...], "unread_count": 3 }', auth: true },
  { method: "PUT", path: "/api/mobile/notificacoes/:id/lida", description: "Marcar notificação como lida", body: null, response: '{ "success": true }', auth: true },
  { method: "PUT", path: "/api/mobile/notificacoes/ler-todas", description: "Marcar todas notificações como lidas", body: null, response: '{ "success": true }', auth: true },
  { method: "POST", path: "/api/mobile/renovacao", description: "Solicitar renovação de prazo", body: '{ "door_id": "uuid", "requested_hours": 24 }', response: '{ "success": true, "id": "uuid" }', auth: true },
  { method: "GET", path: "/api/mobile/renovacoes", description: "Listar solicitações de renovação", body: null, response: '{ "success": true, "data": [...] }', auth: true },
  { method: "POST", path: "/api/mobile/liberar", description: "Devolver/liberar porta temporária", body: '{ "door_id": "uuid" }', response: '{ "success": true, "message": "Porta liberada" }', auth: true },
  { method: "PUT", path: "/api/mobile/perfil", description: "Atualizar dados do perfil", body: '{ "telefone": "(11) 99999-0000", "notification_whatsapp": true }', response: '{ "success": true }', auth: true },
  { method: "GET", path: "/api/mobile/config", description: "Configurações e branding do app", body: null, response: '{ "success": true, "data": { "features": {...}, "branding": {...} } }', auth: true },
  { method: "GET", path: "/api/mobile/fila", description: "Entradas na fila de espera + armários disponíveis", body: null, response: '{ "success": true, "data": { "entries": [...], "lockers": [...] } }', auth: true },
  { method: "POST", path: "/api/mobile/fila", description: "Entrar na fila de espera de um armário", body: '{ "locker_id": "uuid", "preferred_size": "medium" }', response: '{ "success": true, "id": "uuid" }', auth: true },
  { method: "PUT", path: "/api/mobile/fila/:id/cancelar", description: "Cancelar/sair da fila de espera", body: null, response: '{ "success": true }', auth: true },
];

export default function ConfigAppMobile() {
  const { companies, selectedCompany, isSuperAdmin } = useCompany();
  const [selectedCompanyId, setSelectedCompanyId] = useState(selectedCompany?.id || "");
  const [features, setFeatures] = useState<AppFeatures>(DEFAULT_FEATURES);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expandedEndpoint, setExpandedEndpoint] = useState<number | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (selectedCompanyId) loadFeatures(selectedCompanyId);
  }, [selectedCompanyId]);

  useEffect(() => {
    if (selectedCompany?.id && !selectedCompanyId) {
      setSelectedCompanyId(selectedCompany.id);
    }
  }, [selectedCompany]);

  const loadFeatures = async (companyId: string) => {
    setLoading(true);
    try {
      const { data } = await supabase
        .from("platform_settings")
        .select("value")
        .eq("key", `app_features_${companyId}`)
        .single();

      if (data?.value && typeof data.value === "object") {
        setFeatures({ ...DEFAULT_FEATURES, ...(data.value as Partial<AppFeatures>) });
      } else {
        setFeatures(DEFAULT_FEATURES);
      }
    } catch {
      setFeatures(DEFAULT_FEATURES);
    } finally {
      setLoading(false);
    }
  };

  const saveFeatures = async () => {
    if (!selectedCompanyId) {
      toast.error("Selecione uma empresa");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from("platform_settings")
        .upsert({
          key: `app_features_${selectedCompanyId}`,
          value: features,
        }, { onConflict: "key" });

      if (error) throw error;
      toast.success("Configurações do app salvas!");
    } catch (err: any) {
      toast.error(err.message || "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  };

  const toggleFeature = (key: keyof AppFeatures) => {
    setFeatures(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  const getMethodColor = (method: string) => {
    switch (method) {
      case "GET": return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30";
      case "POST": return "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30";
      case "PUT": return "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30";
      case "DELETE": return "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30";
      default: return "bg-muted text-muted-foreground";
    }
  };

  const enabledCount = Object.values(features).filter(Boolean).length;
  const totalCount = Object.keys(features).length;

  return (
    <div className="space-y-6">
      <Tabs defaultValue="permissoes">
        <TabsList className="bg-muted/50 p-1 rounded-xl">
          <TabsTrigger value="permissoes" className="rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm gap-2">
            <Shield className="h-4 w-4" />
            Permissões por Empresa
          </TabsTrigger>
          <TabsTrigger value="documentacao" className="rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm gap-2">
            <BookOpen className="h-4 w-4" />
            Documentação da API
          </TabsTrigger>
        </TabsList>

        {/* =========== ABA: PERMISSÕES =========== */}
        <TabsContent value="permissoes" className="space-y-6 mt-6">
          {/* Header */}
          <Card className="border-primary/20 bg-gradient-to-r from-primary/5 to-transparent">
            <CardContent className="p-5 flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center">
                <Smartphone className="h-6 w-6 text-primary" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-foreground">Configurações do App Mobile</h3>
                <p className="text-sm text-muted-foreground">
                  Controle quais funcionalidades estarão disponíveis no app para cada empresa
                </p>
              </div>
              <Badge variant="outline" className="text-xs">
                {enabledCount}/{totalCount} ativas
              </Badge>
            </CardContent>
          </Card>

          {/* Seletor de empresa */}
          {isSuperAdmin && companies.length > 1 && (
            <div className="space-y-2">
              <Label>Empresa</Label>
              <Select value={selectedCompanyId} onValueChange={setSelectedCompanyId}>
                <SelectTrigger className="max-w-md">
                  <SelectValue placeholder="Selecione uma empresa" />
                </SelectTrigger>
                <SelectContent>
                  {companies.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {/* Feature toggles */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Funcionalidades do App</CardTitle>
                  <CardDescription>
                    Ative ou desative cada módulo individualmente para esta empresa
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-1">
                  {(Object.keys(FEATURE_INFO) as (keyof AppFeatures)[]).map((key, i) => {
                    const info = FEATURE_INFO[key];
                    const Icon = info.icon;
                    return (
                      <div key={key}>
                        {i > 0 && <Separator className="my-1" />}
                        <div className="flex items-center justify-between py-3 px-2 rounded-lg hover:bg-muted/30 transition-colors">
                          <div className="flex items-center gap-3">
                            <div className={`h-9 w-9 rounded-lg flex items-center justify-center ${features[key] ? "bg-primary/10" : "bg-muted"}`}>
                              <Icon className={`h-4 w-4 ${features[key] ? "text-primary" : "text-muted-foreground"}`} />
                            </div>
                            <div>
                              <Label className="text-sm font-medium cursor-pointer" htmlFor={key}>
                                {info.label}
                              </Label>
                              <p className="text-xs text-muted-foreground">{info.description}</p>
                            </div>
                          </div>
                          <Switch
                            id={key}
                            checked={features[key]}
                            onCheckedChange={() => toggleFeature(key)}
                          />
                        </div>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>

              <div className="flex justify-end">
                <Button onClick={saveFeatures} disabled={saving} className="gap-2">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Salvar Configurações
                </Button>
              </div>
            </>
          )}
        </TabsContent>

        {/* =========== ABA: DOCUMENTAÇÃO =========== */}
        <TabsContent value="documentacao" className="space-y-6 mt-6">
          {/* Header */}
          <Card className="border-blue-500/20 bg-gradient-to-r from-blue-500/5 to-transparent">
            <CardContent className="p-5 flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-blue-500/10 flex items-center justify-center">
                <Code className="h-6 w-6 text-blue-600 dark:text-blue-400" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-foreground">API de Integração — App Mobile</h3>
                <p className="text-sm text-muted-foreground">
                  Documentação completa dos endpoints para integração com o aplicativo mobile
                </p>
              </div>
              <Badge variant="outline" className="text-xs font-mono">
                v1.0
              </Badge>
            </CardContent>
          </Card>

          {/* URL Base */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">URL Base</CardTitle>
              <CardDescription>Configure esta URL no app mobile</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2 bg-muted/50 rounded-lg p-3 font-mono text-sm">
                <span className="flex-1 text-foreground break-all">{obterUrlBaseMobile()}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => copyToClipboard(obterUrlBaseMobile(), "url")}
                >
                  {copied === "url" ? <CheckCircle2 className="h-4 w-4 text-primary" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Autenticação */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Shield className="h-4 w-4" />
                Autenticação
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="text-muted-foreground">
                Todas as rotas (exceto login) exigem o header <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">Authorization: Bearer &lt;token&gt;</code>
              </p>
              <div className="bg-muted/30 rounded-lg p-3 font-mono text-xs">
                <p className="text-muted-foreground">// Exemplo de header</p>
                <p className="text-foreground">Authorization: Bearer eyJhbGciOiJIUzI1NiIs...</p>
              </div>
              <p className="text-muted-foreground">
                O token JWT é obtido via <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">POST /api/auth/login</code> e tem validade de 7 dias.
              </p>
            </CardContent>
          </Card>

          {/* Fluxo de abertura */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Unlock className="h-4 w-4" />
                Fluxo de Abertura de Fechadura
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <div className="flex items-start gap-3 p-2">
                <Badge className="shrink-0 mt-0.5">1</Badge>
                <p>App chama <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">GET /api/mobile/portas</code> para listar portas vinculadas</p>
              </div>
              <div className="flex items-start gap-3 p-2">
                <Badge className="shrink-0 mt-0.5">2</Badge>
                <p>Usuário seleciona porta e app envia <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">POST /api/mobile/abrir</code> com o <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">lock_id</code></p>
              </div>
              <div className="flex items-start gap-3 p-2">
                <Badge className="shrink-0 mt-0.5">3</Badge>
                <p>Comando é enfileirado e o agente RPA (desktop) faz polling em <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">GET /api/fechaduras/comandos</code></p>
              </div>
              <div className="flex items-start gap-3 p-2">
                <Badge className="shrink-0 mt-0.5">4</Badge>
                <p>App pode verificar o status com <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">GET /api/mobile/comando/:id</code> (polling)</p>
              </div>
              <div className="flex items-start gap-3 p-2">
                <Badge className="shrink-0 mt-0.5">5</Badge>
                <p>Status final: <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">executado</code> (sucesso) ou <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">erro</code> (falha)</p>
              </div>
            </CardContent>
          </Card>

          {/* Endpoints */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Endpoints Disponíveis</CardTitle>
              <CardDescription>{API_ENDPOINTS.length} endpoints documentados</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {API_ENDPOINTS.map((ep, idx) => (
                <div key={idx} className="border rounded-lg overflow-hidden">
                  <button
                    className="w-full flex items-center gap-3 p-3 hover:bg-muted/30 transition-colors text-left"
                    onClick={() => setExpandedEndpoint(expandedEndpoint === idx ? null : idx)}
                  >
                    <Badge variant="outline" className={`text-[10px] font-mono px-2 py-0.5 border ${getMethodColor(ep.method)}`}>
                      {ep.method}
                    </Badge>
                    <code className="text-xs font-mono text-foreground flex-1">{ep.path}</code>
                    {ep.auth && (
                      <Shield className="h-3.5 w-3.5 text-amber-500" />
                    )}
                    {expandedEndpoint === idx ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    )}
                  </button>
                  {expandedEndpoint === idx && (
                    <div className="border-t bg-muted/10 p-3 space-y-3 text-sm">
                      <p className="text-muted-foreground">{ep.description}</p>
                      {ep.auth && (
                        <Badge variant="outline" className="text-[10px] border-amber-500/30 text-amber-600 dark:text-amber-400 bg-amber-500/10">
                          🔒 Requer Autenticação
                        </Badge>
                      )}
                      {ep.body && (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-1">Body (JSON):</p>
                          <div className="bg-muted/50 rounded-md p-2 font-mono text-xs relative group">
                            <pre className="whitespace-pre-wrap text-foreground">{ep.body}</pre>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={() => copyToClipboard(ep.body!, `body-${idx}`)}
                            >
                              {copied === `body-${idx}` ? <CheckCircle2 className="h-3 w-3 text-primary" /> : <Copy className="h-3 w-3" />}
                            </Button>
                          </div>
                        </div>
                      )}
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-1">Resposta:</p>
                        <div className="bg-muted/50 rounded-md p-2 font-mono text-xs relative group">
                          <pre className="whitespace-pre-wrap text-foreground">{ep.response}</pre>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => copyToClipboard(ep.response, `resp-${idx}`)}
                          >
                            {copied === `resp-${idx}` ? <CheckCircle2 className="h-3 w-3 text-primary" /> : <Copy className="h-3 w-3" />}
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Códigos de erro */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Códigos de Resposta HTTP</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm">
                {[
                  { code: "200", desc: "Sucesso", color: "text-emerald-600 dark:text-emerald-400" },
                  { code: "201", desc: "Criado com sucesso (comando enfileirado, renovação solicitada)", color: "text-emerald-600 dark:text-emerald-400" },
                  { code: "400", desc: "Dados inválidos (validação Zod)", color: "text-amber-600 dark:text-amber-400" },
                  { code: "401", desc: "Token não fornecido ou expirado", color: "text-red-600 dark:text-red-400" },
                  { code: "403", desc: "Sem permissão (porta não vinculada ao usuário)", color: "text-red-600 dark:text-red-400" },
                  { code: "404", desc: "Recurso não encontrado", color: "text-muted-foreground" },
                  { code: "409", desc: "Conflito (solicitação duplicada)", color: "text-amber-600 dark:text-amber-400" },
                  { code: "500", desc: "Erro interno do servidor", color: "text-red-600 dark:text-red-400" },
                ].map(item => (
                  <div key={item.code} className="flex items-center gap-3 py-1.5">
                    <code className={`font-mono text-xs font-semibold ${item.color}`}>{item.code}</code>
                    <span className="text-muted-foreground">{item.desc}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
