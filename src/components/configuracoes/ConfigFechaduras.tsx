import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/hooks/use-toast";
import { Lock, Send, RefreshCw, CheckCircle, Copy, Key, Eye, EyeOff, ShieldCheck, ShieldAlert, Wifi, WifiOff } from "lucide-react";
import api from "@/lib/api";

interface Comando {
  id: number;
  acao: string;
  lock_id: number;
  status: string;
  resposta?: string | null;
  origem?: string | null;
  criado_em: string;
  executado_em?: string | null;
}

type UltimoComandoResumo = {
  id: number;
  status: string;
  resposta?: string | null;
  executado_em?: string | null;
};

const statusMap: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pendente: { label: "Pendente", variant: "secondary" },
  executando: { label: "Executando", variant: "default" },
  executado: { label: "Executado", variant: "outline" },
  erro: { label: "Erro", variant: "destructive" },
};

const endpoints = [
  {
    method: "POST",
    path: "/api/fechaduras/abrir",
    desc: "Cria um comando para abrir uma fechadura",
    body: '{ "lock_id": 1, "origem": "web" }',
  },
  {
    method: "GET",
    path: "/api/fechaduras/comandos",
    desc: "Busca próximo comando pendente (atômico)",
    body: null,
  },
  {
    method: "POST",
    path: "/api/fechaduras/concluir",
    desc: "Finaliza um comando com status e resposta",
    body: '{ "id": 1, "status": "executado", "resposta": "ok" }',
  },
  {
    method: "GET",
    path: "/api/fechaduras/historico",
    desc: "Lista últimos 50 comandos",
    body: null,
  },
];

function generateApiKey(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const prefix = "plk_";
  let key = prefix;
  for (let i = 0; i < 40; i++) {
    key += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return key;
}

export default function ConfigFechaduras() {
  const [lockId, setLockId] = useState("1");
  const [origem, setOrigem] = useState("web");
  const [loading, setLoading] = useState(false);
  const [historico, setHistorico] = useState<Comando[]>([]);
  const [loadingHistorico, setLoadingHistorico] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [ultimoComando, setUltimoComando] = useState<UltimoComandoResumo | null>(null);

  const [apiKey, setApiKey] = useState("");
  const [newApiKey, setNewApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [savingKey, setSavingKey] = useState(false);
  const [loadingKey, setLoadingKey] = useState(true);
  const [keyEnabled, setKeyEnabled] = useState(false);

  const [agentStatus, setAgentStatus] = useState<{
    online: boolean;
    last_seen: string | null;
    seconds_ago: number;
    message: string;
  } | null>(null);

  const baseUrl = String(import.meta.env.VITE_API_URL || window.location.origin).replace(/\/+$/, "");
  const ultimoComandoStatus = ultimoComando
    ? statusMap[ultimoComando.status] || { label: ultimoComando.status, variant: "secondary" as const }
    : null;

  useEffect(() => {
    loadApiKey();
    fetchAgentStatus();
    const interval = setInterval(fetchAgentStatus, 10000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!ultimoComando || !["pendente", "executando"].includes(ultimoComando.status)) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void atualizarStatusComando(ultimoComando.id, true);
    }, 3000);

    return () => window.clearInterval(intervalId);
  }, [ultimoComando?.id, ultimoComando?.status]);

  const fetchAgentStatus = async () => {
    try {
      const { data } = await api.get("/fechaduras/agent-status");
      setAgentStatus(data);
    } catch {
      setAgentStatus({ online: false, last_seen: null, seconds_ago: 0, message: "Erro ao consultar status do agente." });
    }
  };

  const loadApiKey = async () => {
    setLoadingKey(true);
    try {
      const { data } = await api.get("/settings", { params: { key: "fechaduras_api_key" } });
      const rows = Array.isArray(data) ? data : data?.data || [];
      const setting = rows.find?.((s: any) => s.key === "fechaduras_api_key");
      if (setting?.value) {
        const val = typeof setting.value === "string" ? setting.value : setting.value?.key || "";
        if (val && val !== "{}" && val !== '""') {
          setApiKey(val);
          setKeyEnabled(true);
        }
      }
    } catch {
      // Sem chave configurada = modo aberto
    } finally {
      setLoadingKey(false);
    }
  };

  const salvarApiKey = async (key: string) => {
    setSavingKey(true);
    try {
      await api.put("/settings/fechaduras_api_key", { value: { key } });
      setApiKey(key);
      setNewApiKey("");
      setKeyEnabled(!!key);
      toast({
        title: key ? "API Key salva!" : "API Key removida",
        description: key ? "Os endpoints agora exigem autenticação." : "Os endpoints estão em modo aberto.",
      });
    } catch (err: any) {
      toast({ title: "Erro ao salvar", description: err.message || "Falha ao salvar API Key", variant: "destructive" });
    } finally {
      setSavingKey(false);
    }
  };

  const gerarNovaChave = () => {
    const key = generateApiKey();
    setNewApiKey(key);
    setShowKey(true);
  };

  const atualizarStatusComando = async (commandId: number, silent = false): Promise<UltimoComandoResumo | null> => {
    if (!silent) {
      setLoadingStatus(true);
    }

    try {
      const res = await api.get(`/fechaduras/status/${commandId}`);
      const payload = res.data?.data || res.data;

      if (!payload?.id) {
        return null;
      }

      const nextCommand: UltimoComandoResumo = {
        id: Number(payload.id),
        status: String(payload.status || "pendente"),
        resposta: payload.resposta || null,
        executado_em: payload.executado_em || null,
      };

      setUltimoComando(nextCommand);
      return nextCommand;
    } catch (err: any) {
      if (!silent) {
        toast({ title: "Erro ao consultar status", description: err.message || "Falha ao consultar comando", variant: "destructive" });
      }
      return null;
    } finally {
      if (!silent) {
        setLoadingStatus(false);
      }
    }
  };

  const enviarComando = async () => {
    const id = parseInt(lockId);
    if (isNaN(id) || id <= 0) {
      toast({ title: "Lock ID inválido", description: "Informe um número inteiro positivo.", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      const res = await api.post("/fechaduras/abrir-admin", { lock_id: id, origem: origem || "web" });
      const commandId = Number(res.data.id);
      setUltimoComando({ id: commandId, status: "pendente", resposta: null, executado_em: null });
      toast({ title: "Comando enviado!", description: `ID: ${commandId} — Lock: ${id}` });
      void atualizarStatusComando(commandId, true);
    } catch (err: any) {
      toast({ title: "Erro ao enviar", description: err.message || "Falha na requisição", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const buscarHistorico = async () => {
    setLoadingHistorico(true);
    try {
      const { data } = await api.get("/fechaduras/historico-admin");
      setHistorico(Array.isArray(data) ? data : []);
    } catch (err: any) {
      toast({ title: "Erro ao carregar histórico", description: err.message, variant: "destructive" });
    } finally {
      setLoadingHistorico(false);
    }
  };

  const verificarUltimoComando = async () => {
    if (!ultimoComando) {
      toast({ title: "Nenhum comando enviado", description: "Envie um comando de teste primeiro." });
      return;
    }

    const statusAtual = await atualizarStatusComando(ultimoComando.id);
    if (statusAtual) {
      const statusInfo = statusMap[statusAtual.status] || { label: statusAtual.status, variant: "secondary" as const };
      toast({
        title: `Comando #${statusAtual.id}`,
        description: statusAtual.resposta
          ? `Status: ${statusInfo.label} — ${statusAtual.resposta}`
          : `Status atual: ${statusInfo.label}`,
      });
    }
  };

  const copiarTexto = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copiado!", description: "Texto copiado para a área de transferência." });
  };

  const maskedKey = apiKey ? `${apiKey.slice(0, 8)}${"•".repeat(20)}${apiKey.slice(-4)}` : "";

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Lock className="h-6 w-6 text-primary" />
            </div>
            <div>
              <CardTitle>Integração — Fechaduras Inteligentes</CardTitle>
              <CardDescription>
                API de fila de comandos para controle de fechaduras via agente Python local
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="p-4 rounded-lg bg-muted/50">
              <p className="text-xs text-muted-foreground font-medium">Base URL</p>
              <p className="text-sm font-mono mt-1 break-all">{baseUrl}/api</p>
            </div>
            <div className="p-4 rounded-lg bg-muted/50">
              <p className="text-xs text-muted-foreground font-medium">Autenticação</p>
              <div className="flex items-center gap-2 mt-1">
                {keyEnabled ? (
                  <>
                    <ShieldCheck className="h-4 w-4 text-green-500" />
                    <span className="text-sm text-green-600 font-medium">API Key ativa</span>
                  </>
                ) : (
                  <>
                    <ShieldAlert className="h-4 w-4 text-amber-500" />
                    <span className="text-sm text-amber-600 font-medium">Modo aberto</span>
                  </>
                )}
              </div>
            </div>
            <div className="p-4 rounded-lg bg-muted/50">
              <p className="text-xs text-muted-foreground font-medium">Polling recomendado</p>
              <p className="text-sm mt-1">GET /comandos a cada 2s</p>
            </div>
            <div className={`p-4 rounded-lg border ${agentStatus?.online ? "border-green-500/30 bg-green-500/5" : "border-destructive/30 bg-destructive/5"}`}>
              <p className="text-xs text-muted-foreground font-medium">Status do Agente</p>
              <div className="flex items-center gap-2 mt-1">
                {agentStatus?.online ? (
                  <>
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
                    </span>
                    <span className="text-sm text-green-600 font-medium">Online</span>
                  </>
                ) : (
                  <>
                    <WifiOff className="h-4 w-4 text-destructive" />
                    <span className="text-sm text-destructive font-medium">Offline</span>
                  </>
                )}
              </div>
              {agentStatus?.last_seen && (
                <p className="text-[10px] text-muted-foreground mt-1">
                  Último sinal: {new Date(agentStatus.last_seen).toLocaleString("pt-BR")}
                </p>
              )}
              {!agentStatus?.last_seen && agentStatus && (
                <p className="text-[10px] text-muted-foreground mt-1">Nunca conectou</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Key className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Autenticação por API Key</CardTitle>
          </div>
          <CardDescription>
            Configure uma chave de acesso para proteger os endpoints do agente Python. Sem chave, o acesso é livre.
            Ao gerar e ativar uma nova chave, atualize imediatamente o agente com o header{" "}
            <code className="text-xs">X-API-Key</code> — senão as aberturas param de funcionar.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loadingKey ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <RefreshCw className="h-4 w-4 animate-spin" />
              Carregando configuração...
            </div>
          ) : (
            <>
              {apiKey && (
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Chave atual</Label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 p-2.5 rounded-md bg-muted font-mono text-sm break-all">
                      {showKey ? apiKey : maskedKey}
                    </code>
                    <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => setShowKey(!showKey)}>
                      {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                    <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => copiarTexto(apiKey)}>
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}

              {apiKey && (
                <div className="p-3 rounded-lg bg-muted/50 space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">Como usar no agente Python:</p>
                  <pre className="text-xs font-mono overflow-x-auto whitespace-pre-wrap">
{`headers = { "X-API-Key": "${showKey ? apiKey : "sua_api_key_aqui"}" }
requests.get(url, headers=headers)`}
                  </pre>
                  <p className="text-xs text-muted-foreground mt-1">
                    Também aceita: <code className="bg-muted px-1 rounded">Authorization: Bearer &lt;key&gt;</code> ou <code className="bg-muted px-1 rounded">?api_key=&lt;key&gt;</code>
                  </p>
                </div>
              )}

              <Separator />

              <div className="space-y-3">
                <div className="flex items-center gap-3 flex-wrap">
                  <Button variant="outline" onClick={gerarNovaChave} className="gap-2">
                    <Key className="h-4 w-4" />
                    Gerar Nova Chave
                  </Button>
                  {apiKey && (
                    <Button
                      variant="ghost"
                      className="text-destructive hover:text-destructive gap-2"
                      onClick={() => salvarApiKey("")}
                      disabled={savingKey}
                    >
                      <ShieldAlert className="h-4 w-4" />
                      Remover Proteção
                    </Button>
                  )}
                </div>

                {newApiKey && (
                  <div className="space-y-3 p-4 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30">
                    <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                      ⚠️ Copie esta chave antes de salvar — ela não será exibida novamente por completo.
                    </p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 p-2.5 rounded-md bg-white dark:bg-background font-mono text-sm break-all border">
                        {newApiKey}
                      </code>
                      <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={() => copiarTexto(newApiKey)}>
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                    <Button onClick={() => salvarApiKey(newApiKey)} disabled={savingKey} className="gap-2">
                      <ShieldCheck className="h-4 w-4" />
                      {savingKey ? "Salvando..." : "Ativar Esta Chave"}
                    </Button>
                  </div>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Endpoints da API</CardTitle>
          <CardDescription>Referência rápida dos endpoints disponíveis</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {endpoints.map((ep, i) => (
            <div key={i} className="p-4 rounded-lg border bg-card hover:bg-muted/30 transition-colors">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <Badge variant={ep.method === "GET" ? "secondary" : "default"} className="font-mono text-xs">
                    {ep.method}
                  </Badge>
                  <code className="text-sm font-mono text-foreground">{ep.path}</code>
                </div>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => copiarTexto(`${baseUrl}${ep.path}`)}>
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
              <p className="text-sm text-muted-foreground mt-2">{ep.desc}</p>
              {ep.body && (
                <pre className="mt-2 p-2 rounded bg-muted text-xs font-mono overflow-x-auto">{ep.body}</pre>
              )}
            </div>
          ))}

          {keyEnabled && (
            <div className="p-3 rounded-lg bg-primary/5 border border-primary/20 text-sm">
              <p className="font-medium text-primary">🔒 Autenticação obrigatória</p>
              <p className="text-muted-foreground mt-1">
                Todos os endpoints acima exigem o header <code className="bg-muted px-1 rounded text-xs">X-API-Key: sua_chave</code>
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Painel de Teste</CardTitle>
          <CardDescription>Envie comandos de teste e acompanhe o status real sem consumir a fila do agente</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <h4 className="font-medium text-sm">Enviar Comando — Abrir Fechadura</h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="lock_id">Lock ID</Label>
                <Input id="lock_id" type="number" min={1} value={lockId} onChange={(e) => setLockId(e.target.value)} placeholder="Ex: 1" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="origem">Origem</Label>
                <Input id="origem" value={origem} onChange={(e) => setOrigem(e.target.value)} placeholder="web, app, api..." />
              </div>
              <div className="flex items-end">
                <Button onClick={enviarComando} disabled={loading} className="w-full gap-2">
                  <Send className="h-4 w-4" />
                  {loading ? "Enviando..." : "Enviar Comando"}
                </Button>
              </div>
            </div>

            {ultimoComando && ultimoComandoStatus && (
              <div className="p-3 rounded-lg bg-muted/50 flex items-start justify-between gap-3 flex-wrap">
                <div className="flex items-start gap-3">
                  <CheckCircle className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <span className="text-sm">
                      Último comando: <strong>#{ultimoComando.id}</strong> — Status: {ultimoComandoStatus.label}
                    </span>
                    {ultimoComando.resposta && (
                      <p className="text-xs text-muted-foreground">Resposta: {ultimoComando.resposta}</p>
                    )}
                    {ultimoComando.status === "pendente" && (
                      <p className="text-xs text-muted-foreground">
                        Se continuar pendente, o agente Python/worker em produção não está consumindo a fila.
                      </p>
                    )}
                  </div>
                </div>
                <Badge variant={ultimoComandoStatus.variant} className="text-xs">
                  {ultimoComandoStatus.label}
                </Badge>
              </div>
            )}
          </div>

          <Separator />

          <div className="flex flex-wrap gap-3">
            <Button variant="outline" onClick={verificarUltimoComando} disabled={!ultimoComando || loadingStatus} className="gap-2">
              <RefreshCw className={`h-4 w-4 ${loadingStatus ? "animate-spin" : ""}`} />
              Verificar Último Status
            </Button>
            <Button variant="outline" onClick={buscarHistorico} disabled={loadingHistorico} className="gap-2">
              <RefreshCw className={`h-4 w-4 ${loadingHistorico ? "animate-spin" : ""}`} />
              Carregar Histórico
            </Button>
          </div>
        </CardContent>
      </Card>

      {historico.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Histórico de Comandos</CardTitle>
            <CardDescription>Últimos {historico.length} comandos registrados</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-2 pr-4 font-medium text-muted-foreground">ID</th>
                    <th className="pb-2 pr-4 font-medium text-muted-foreground">Ação</th>
                    <th className="pb-2 pr-4 font-medium text-muted-foreground">Lock</th>
                    <th className="pb-2 pr-4 font-medium text-muted-foreground">Status</th>
                    <th className="pb-2 pr-4 font-medium text-muted-foreground">Origem</th>
                    <th className="pb-2 pr-4 font-medium text-muted-foreground">Resposta</th>
                    <th className="pb-2 font-medium text-muted-foreground">Criado em</th>
                  </tr>
                </thead>
                <tbody>
                  {historico.map((cmd) => {
                    const st = statusMap[cmd.status] || { label: cmd.status, variant: "secondary" as const };
                    return (
                      <tr key={cmd.id} className="border-b last:border-0">
                        <td className="py-2 pr-4 font-mono">#{cmd.id}</td>
                        <td className="py-2 pr-4">{cmd.acao}</td>
                        <td className="py-2 pr-4 font-mono">{cmd.lock_id}</td>
                        <td className="py-2 pr-4">
                          <Badge variant={st.variant} className="text-xs">{st.label}</Badge>
                        </td>
                        <td className="py-2 pr-4 text-muted-foreground">{cmd.origem || "—"}</td>
                        <td className="py-2 pr-4 text-muted-foreground max-w-[200px] truncate">{cmd.resposta || "—"}</td>
                        <td className="py-2 text-muted-foreground text-xs">
                          {new Date(cmd.criado_em).toLocaleString("pt-BR")}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
