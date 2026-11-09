import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { Building2, Copy, KeyRound, Plus, RefreshCw, Trash2 } from "lucide-react";
import api from "@/lib/api";
import { useCompany } from "@/contexts/ContextoEmpresa";

interface Agente {
  id: string;
  company_id: string;
  company_name: string;
  nome: string;
  key_prefix: string;
  ativo: boolean;
  last_seen_at: string | null;
  created_at: string;
  revoked_at: string | null;
}

/**
 * Chaves de API do agente de fechaduras POR EMPRESA.
 * Cada empresa roda seu próprio agente, que só enxerga e abre as fechaduras dela.
 */
export default function ChavesAgenteEmpresa() {
  const { isSuperAdmin, selectedCompany } = useCompany();
  const companyId = isSuperAdmin ? selectedCompany?.id : undefined; // admin: backend usa a empresa do usuário
  const semEmpresa = isSuperAdmin && !selectedCompany;

  const [agentes, setAgentes] = useState<Agente[]>([]);
  const [loading, setLoading] = useState(false);
  const [nome, setNome] = useState("Agente principal");
  const [criando, setCriando] = useState(false);
  const [novaChave, setNovaChave] = useState<string | null>(null);

  const carregar = async () => {
    if (semEmpresa) return setAgentes([]);
    setLoading(true);
    try {
      const { data } = await api.get("/fechaduras/agentes", { params: companyId ? { company_id: companyId } : {} });
      setAgentes(Array.isArray(data) ? data : []);
    } catch (err: any) {
      toast({ title: "Erro ao carregar chaves", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setNovaChave(null);
    void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, semEmpresa]);

  const criar = async () => {
    setCriando(true);
    try {
      const { data } = await api.post("/fechaduras/agentes", { nome, ...(companyId ? { company_id: companyId } : {}) });
      setNovaChave(data.api_key);
      toast({ title: "Chave criada", description: "Copie agora — ela não será exibida novamente." });
      await carregar();
    } catch (err: any) {
      toast({ title: "Erro ao criar chave", description: err.message, variant: "destructive" });
    } finally {
      setCriando(false);
    }
  };

  const revogar = async (agente: Agente) => {
    if (!window.confirm(`Revogar a chave "${agente.nome}"? O agente que usa essa chave para de funcionar imediatamente.`)) return;
    try {
      await api.delete(`/fechaduras/agentes/${agente.id}`);
      toast({ title: "Chave revogada" });
      await carregar();
    } catch (err: any) {
      toast({ title: "Erro ao revogar", description: err.message, variant: "destructive" });
    }
  };

  const copiar = async (texto: string) => {
    try {
      await navigator.clipboard.writeText(texto);
      toast({ title: "Copiado!" });
    } catch {
      toast({ title: "Não foi possível copiar", variant: "destructive" });
    }
  };

  const online = (a: Agente) => !!a.last_seen_at && Date.now() - new Date(a.last_seen_at).getTime() < 30_000;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">Chaves do agente da empresa</CardTitle>
        </div>
        <CardDescription>
          Cada empresa tem a própria chave. O agente instalado com ela só recebe comandos das fechaduras desta empresa.
          Envie a chave no header <code className="text-xs">X-API-Key</code>.
          {isSuperAdmin && selectedCompany && (
            <span className="flex items-center gap-1 mt-1">
              <Building2 className="h-3.5 w-3.5" /> Empresa selecionada: <strong>{selectedCompany.name}</strong>
            </span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {semEmpresa ? (
          <p className="text-sm text-muted-foreground">Selecione uma empresa para gerenciar as chaves dela.</p>
        ) : (
          <>
            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Nome do agente (ex.: Sede, Filial 2)"
                maxLength={100}
                className="sm:max-w-xs"
              />
              <Button onClick={criar} disabled={criando || !nome.trim()} className="gap-2">
                {criando ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Gerar chave
              </Button>
            </div>

            {novaChave && (
              <div className="space-y-2 p-4 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30">
                <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                  ⚠️ Copie esta chave agora — por segurança ela não será exibida novamente.
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 p-2.5 rounded-md bg-white dark:bg-background font-mono text-sm break-all border">
                    {novaChave}
                  </code>
                  <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={() => copiar(novaChave)}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}

            {loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <RefreshCw className="h-4 w-4 animate-spin" /> Carregando...
              </div>
            ) : agentes.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhuma chave criada. Enquanto não houver chave da empresa, os comandos são atendidos pelo agente global da plataforma.
              </p>
            ) : (
              <div className="space-y-2">
                {agentes.map((a) => (
                  <div key={a.id} className="flex flex-wrap items-center gap-3 p-3 rounded-lg border">
                    <div className="flex-1 min-w-[180px]">
                      <p className="text-sm font-medium">{a.nome}</p>
                      <p className="text-xs text-muted-foreground font-mono">{a.key_prefix}…</p>
                    </div>
                    {!a.ativo ? (
                      <Badge variant="outline">Revogada</Badge>
                    ) : online(a) ? (
                      <Badge className="bg-green-600 hover:bg-green-600">Online</Badge>
                    ) : (
                      <Badge variant="secondary">
                        {a.last_seen_at ? `Visto ${new Date(a.last_seen_at).toLocaleString("pt-BR")}` : "Nunca conectou"}
                      </Badge>
                    )}
                    {a.ativo && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive gap-1"
                        onClick={() => revogar(a)}
                      >
                        <Trash2 className="h-4 w-4" /> Revogar
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
