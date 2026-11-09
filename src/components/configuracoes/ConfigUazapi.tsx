import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/lib/supabase-compat";
import api from "@/lib/api";
import { useAuth } from "@/contexts/ContextoAutenticacao";
import { useCompany } from "@/contexts/ContextoEmpresa";
import { useToast } from "@/hooks/use-toast";
import { MessageSquare, Server, Key, QrCode, Wifi, WifiOff, Loader2, RefreshCw, Unplug, Send } from "lucide-react";

// Helper to extract error message from supabase.functions.invoke response
async function extractError(res: { data: any; error: any }): Promise<string | null> {
  if (res.error) {
    // Try to parse error body from FunctionsHttpError
    try {
      if (res.error.context && typeof res.error.context.json === 'function') {
        const body = await res.error.context.json();
        return body?.error || body?.details?.error || body?.message || String(res.error.message);
      }
    } catch {}
    return res.error.message || String(res.error);
  }
  if (res.data?.error) {
    return typeof res.data.error === 'string' ? res.data.error : JSON.stringify(res.data.error);
  }
  return null;
}

export default function ConfigUazapi() {
  const { user } = useAuth();
  const { isSuperAdmin, selectedCompany, userRole } = useCompany();
  const isAdmin = userRole === "admin" || isSuperAdmin;
  const { toast } = useToast();

  // SuperAdmin fields
  const [serverUrl, setServerUrl] = useState("");
  const [adminToken, setAdminToken] = useState("");
  const [savingConfig, setSavingConfig] = useState(false);
  const [loadingConfig, setLoadingConfig] = useState(true);

  // Company fields
  const [instanceStatus, setInstanceStatus] = useState<string>("not_created");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [loadingQr, setLoadingQr] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [creatingInstance, setCreatingInstance] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  // Webhook seguro (URL com segredo)
  const [globalWebhookUrl, setGlobalWebhookUrl] = useState("");
  const [companyWebhookUrl, setCompanyWebhookUrl] = useState("");
  const [configuringWebhook, setConfiguringWebhook] = useState(false);

  // Test message
  const [testPhone, setTestPhone] = useState("");
  const [testMessage, setTestMessage] = useState("");
  const [sendingTest, setSendingTest] = useState(false);

  // Load superadmin config
  useEffect(() => {
    if (!isSuperAdmin) {
      setLoadingConfig(false);
      return;
    }
    const load = async () => {
      setLoadingConfig(true);
      const { data } = await supabase
        .from("platform_settings")
        .select("key, value")
        .in("key", ["uazapi_server_url", "uazapi_admin_token"]);

      if (data) {
        data.forEach((row: any) => {
          if (row.key === "uazapi_server_url") setServerUrl((row.value as string) || "");
          if (row.key === "uazapi_admin_token") setAdminToken((row.value as string) || "");
        });
      }
      try {
        const { data: wh } = await api.get("/admin/whatsapp-webhook-global");
        setGlobalWebhookUrl(wh?.webhook_url || "");
      } catch {
        setGlobalWebhookUrl("");
      }
      setLoadingConfig(false);
    };
    load();
  }, [isSuperAdmin]);

  const handleSaveConfig = async () => {
    setSavingConfig(true);
    try {
      // Upsert both settings
      for (const item of [
        { key: "uazapi_server_url", value: serverUrl.trim() },
        { key: "uazapi_admin_token", value: adminToken.trim() },
      ]) {
        // value column is jsonb — must wrap strings as valid JSON
        const jsonValue = JSON.stringify(item.value);
        
        const { data: existing } = await supabase
          .from("platform_settings")
          .select("id")
          .eq("key", item.key)
          .maybeSingle();

        if (existing) {
          const { error } = await supabase.from("platform_settings").update({ value: jsonValue }).eq("key", item.key);
          if (error) throw new Error(error.message);
        } else {
          const { error } = await supabase.from("platform_settings").insert({ key: item.key, value: jsonValue });
          if (error) throw new Error(error.message);
        }
      }
      toast({ title: "Configuração UAZAPI salva com sucesso!" });
    } catch (err: any) {
      toast({ title: "Erro ao salvar", description: err.message, variant: "destructive" });
    } finally {
      setSavingConfig(false);
    }
  };

  // Company: check status
  const checkStatus = useCallback(async () => {
    if (!selectedCompany) return;
    setLoadingStatus(true);
    try {
      const res = await supabase.functions.invoke("uazapi-proxy", {
        body: { action: "get_status", companyId: selectedCompany.id },
      });
      if (res.error || res.data?.error) {
        setInstanceStatus("not_created");
      } else if (res.data?.status) {
        setInstanceStatus(res.data.status);
        setPhoneNumber(res.data.phone_number || "");
        setCompanyWebhookUrl(res.data.webhook_url || "");
      }
    } catch {
      // silent
    } finally {
      setLoadingStatus(false);
    }
  }, [selectedCompany]);

  useEffect(() => {
    if (selectedCompany && isAdmin) {
      checkStatus();
    }
  }, [selectedCompany, isAdmin, checkStatus]);

  const handleCreateInstance = async () => {
    if (!selectedCompany) return;
    setCreatingInstance(true);
    try {
      const res = await supabase.functions.invoke("uazapi-proxy", {
        body: { action: "create_instance", companyId: selectedCompany.id },
      });
      const errorMsg = await extractError(res);
      if (errorMsg) {
        toast({ title: "Erro ao criar instância", description: errorMsg, variant: "destructive" });
      } else if (res.data?.success) {
        toast({ title: "Instância criada com sucesso!" });
        await checkStatus();
      }
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally {
      setCreatingInstance(false);
    }
  };

  const handleGetQrCode = async () => {
    if (!selectedCompany) return;
    setLoadingQr(true);
    setQrCode(null);
    try {
      const res = await supabase.functions.invoke("uazapi-proxy", {
        body: { action: "get_qrcode", companyId: selectedCompany.id },
      });
      const errorMsg = await extractError(res);
      if (errorMsg) {
        toast({ title: "Erro ao obter QR Code", description: errorMsg, variant: "destructive" });
      } else {
        const d = res.data?.data;
        // UAZAPI /instance/connect returns QR in various fields
        const qr = d?.qrcode || d?.qr || d?.base64 || d?.pairingCode || d?.paircode ||
                   d?.instance?.qrcode || d?.instance?.paircode ||
                   d?.data?.qrcode || d?.data?.qr || d?.data?.base64 ||
                   (typeof d === 'string' ? d : null);
        
        if (qr) {
          // If it's a base64 without prefix, add it
          const qrValue = qr.startsWith("data:") ? qr : 
                          qr.startsWith("/9j") || qr.startsWith("iVBOR") ? `data:image/png;base64,${qr}` : qr;
          setQrCode(qrValue);
        } else {
          console.log("QR response data:", JSON.stringify(res.data));
          toast({ title: "QR Code não disponível", description: "Resposta: " + JSON.stringify(d).substring(0, 150), variant: "destructive" });
        }
      }
    } catch (err: any) {
      toast({ title: "Erro ao obter QR Code", description: err.message, variant: "destructive" });
    } finally {
      setLoadingQr(false);
    }
  };

  const handleDisconnect = async () => {
    if (!selectedCompany) return;
    setDisconnecting(true);
    try {
      const res = await supabase.functions.invoke("uazapi-proxy", {
        body: { action: "disconnect", companyId: selectedCompany.id },
      });
      const errorMsg = await extractError(res);
      if (errorMsg) {
        toast({ title: "Erro ao desconectar", description: errorMsg, variant: "destructive" });
      } else if (res.data?.success) {
        toast({ title: "WhatsApp desconectado!" });
        setInstanceStatus("disconnected");
        setPhoneNumber("");
        setQrCode(null);
      }
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally {
      setDisconnecting(false);
    }
  };

  const handleSendTest = async () => {
    if (!selectedCompany || !testPhone || !testMessage) return;
    setSendingTest(true);
    try {
      const res = await supabase.functions.invoke("uazapi-proxy", {
        body: {
          action: "send_message",
          companyId: selectedCompany.id,
          phone: testPhone.replace(/\D/g, ""),
          message: testMessage,
        },
      });
      const errorMsg = await extractError(res);
      if (errorMsg) {
        toast({ title: "Erro ao enviar", description: errorMsg, variant: "destructive" });
      } else if (res.data?.success) {
        toast({ title: "Mensagem enviada com sucesso!" });
        setTestPhone("");
        setTestMessage("");
      }
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally {
      setSendingTest(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* SuperAdmin: Server config */}
      {isSuperAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Server className="h-5 w-5" />
              Configuração do Servidor UAZAPI
            </CardTitle>
            <CardDescription>
              Configure a URL do servidor e o token de administrador para integração com WhatsApp
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {loadingConfig ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Carregando...
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="server-url">Server URL</Label>
                  <Input
                    id="server-url"
                    placeholder="https://seu-servidor-uazapi.com"
                    value={serverUrl}
                    onChange={(e) => setServerUrl(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    URL base do seu servidor UAZAPI
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="admin-token">Admin Token</Label>
                  <Input
                    id="admin-token"
                    type="password"
                    placeholder="Seu token de administrador"
                    value={adminToken}
                    onChange={(e) => setAdminToken(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Token de autenticação do painel admin UAZAPI
                  </p>
                </div>

                {/* Webhook URL */}
                <div className="space-y-2">
                  <Label>Webhook URL (para configurar na UAZAPI)</Label>
                  <div className="flex gap-2">
                    <Input
                      readOnly
                      value={globalWebhookUrl || "Carregando..."}
                      className="font-mono text-xs bg-muted"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        navigator.clipboard.writeText(globalWebhookUrl);
                        toast({ title: "URL copiada!" });
                      }}
                    >
                      Copiar
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    URL do webhook global (contém um segredo — não compartilhe). A empresa é identificada pela instância.
                    Prefira a URL própria de cada empresa, exibida na conexão do WhatsApp da empresa.
                  </p>
                </div>

                <Button onClick={handleSaveConfig} disabled={savingConfig || !serverUrl || !adminToken}>
                  {savingConfig ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Key className="h-4 w-4 mr-2" />}
                  Salvar Configuração
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Company: WhatsApp connection */}
      {isAdmin && selectedCompany && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="h-5 w-5" />
                WhatsApp da Empresa
                {instanceStatus === "connected" && (
                  <Badge className="bg-primary/10 text-primary border-primary/30">
                    <Wifi className="h-3 w-3 mr-1" /> Conectado
                  </Badge>
                )}
                {instanceStatus === "disconnected" && (
                  <Badge variant="outline" className="text-destructive border-destructive/30">
                    <WifiOff className="h-3 w-3 mr-1" /> Desconectado
                  </Badge>
                )}
                {instanceStatus === "not_created" && (
                  <Badge variant="outline" className="text-muted-foreground">
                    Não configurado
                  </Badge>
                )}
              </CardTitle>
              <CardDescription>
                Conecte o WhatsApp para enviar notificações automáticas
                {selectedCompany && ` — ${selectedCompany.name}`}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {phoneNumber && instanceStatus === "connected" && (
                <div className="p-3 rounded-lg bg-primary/5 border border-primary/20 text-sm">
                  <span className="font-medium">Número conectado:</span> {phoneNumber}
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                {instanceStatus === "not_created" && (
                  <Button onClick={handleCreateInstance} disabled={creatingInstance}>
                    {creatingInstance ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <MessageSquare className="h-4 w-4 mr-2" />}
                    Criar Instância
                  </Button>
                )}

                {instanceStatus !== "not_created" && instanceStatus !== "connected" && (
                  <Button onClick={handleGetQrCode} disabled={loadingQr}>
                    {loadingQr ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <QrCode className="h-4 w-4 mr-2" />}
                    Gerar QR Code
                  </Button>
                )}

                <Button variant="outline" onClick={checkStatus} disabled={loadingStatus}>
                  {loadingStatus ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                  Atualizar Status
                </Button>

                {instanceStatus === "connected" && (
                  <Button variant="destructive" onClick={handleDisconnect} disabled={disconnecting}>
                    {disconnecting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Unplug className="h-4 w-4 mr-2" />}
                    Desconectar
                  </Button>
                )}
              </div>

              {/* QR Code display */}
              {qrCode && instanceStatus !== "connected" && (
                <div className="mt-4 flex flex-col items-center gap-3 p-6 rounded-xl border border-border bg-background">
                  <p className="text-sm font-medium text-foreground">Escaneie o QR Code com seu WhatsApp</p>
                  <div className="p-4 bg-white rounded-lg shadow-sm">
                    <img
                      src={qrCode.startsWith("data:") ? qrCode : `data:image/png;base64,${qrCode}`}
                      alt="QR Code WhatsApp"
                      className="w-64 h-64 object-contain"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground text-center max-w-sm">
                    Abra o WhatsApp no seu celular → Dispositivos conectados → Conectar dispositivo → Aponte para o QR Code
                  </p>
                  <Button variant="outline" size="sm" onClick={handleGetQrCode} disabled={loadingQr}>
                    <RefreshCw className="h-3 w-3 mr-1" /> Atualizar QR Code
                  </Button>
                </div>
              )}

              {companyWebhookUrl && (
                <div className="space-y-2 pt-2">
                  <Separator />
                  <Label>Webhook desta empresa</Label>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <Input readOnly value={companyWebhookUrl} className="font-mono text-xs bg-muted" />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        navigator.clipboard.writeText(companyWebhookUrl);
                        toast({ title: "URL copiada!" });
                      }}
                    >
                      Copiar
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={configuringWebhook}
                      onClick={async () => {
                        if (!selectedCompany) return;
                        setConfiguringWebhook(true);
                        const res = await supabase.functions.invoke("uazapi-proxy", {
                          body: { action: "configure_webhook", companyId: selectedCompany.id },
                        });
                        setConfiguringWebhook(false);
                        toast(
                          res.error || !res.data?.success
                            ? { title: "Não foi possível configurar automaticamente", description: "Copie a URL e configure na UAZAPI.", variant: "destructive" }
                            : { title: "Webhook configurado na UAZAPI" }
                        );
                      }}
                    >
                      {configuringWebhook ? <Loader2 className="h-3 w-3 animate-spin" /> : "Configurar na UAZAPI"}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Contém um segredo exclusivo desta empresa — só mensagens recebidas por esta URL são processadas para ela.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Test message */}
          {instanceStatus === "connected" && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Send className="h-5 w-5" />
                  Enviar Mensagem de Teste
                </CardTitle>
                <CardDescription>Teste o envio de mensagens pelo WhatsApp conectado</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Telefone (com DDD)</Label>
                    <Input
                      placeholder="5511999999999"
                      value={testPhone}
                      onChange={(e) => setTestPhone(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Mensagem</Label>
                    <Input
                      placeholder="Mensagem de teste..."
                      value={testMessage}
                      onChange={(e) => setTestMessage(e.target.value)}
                    />
                  </div>
                </div>
                <Button onClick={handleSendTest} disabled={sendingTest || !testPhone || !testMessage}>
                  {sendingTest ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
                  Enviar Teste
                </Button>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
