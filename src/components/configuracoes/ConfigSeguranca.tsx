import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/contexts/ContextoAutenticacao";
import { useToast } from "@/hooks/use-toast";
import { Lock, Loader2, ShieldCheck, Clock, Monitor } from "lucide-react";

export default function ConfigSeguranca() {
  const { user, session, changePassword } = useAuth();
  const { toast } = useToast();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleChangePassword = async () => {
    if (!currentPassword) {
      toast({ title: "Informe a senha atual", variant: "destructive" });
      return;
    }
    if (newPassword.length < 6) {
      toast({ title: "A senha deve ter pelo menos 6 caracteres", variant: "destructive" });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: "As senhas não coincidem", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      const { error } = await changePassword(currentPassword, newPassword);
      if (error) throw new Error(error);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast({ title: "Senha alterada com sucesso!" });
    } catch (err: any) {
      toast({ title: "Erro ao alterar senha", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const lastSignIn = user?.last_sign_in_at
    ? new Date(user.last_sign_in_at).toLocaleString("pt-BR")
    : "Desconhecido";

  const createdAt = user?.created_at
    ? new Date(user.created_at).toLocaleString("pt-BR")
    : "Desconhecido";

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5" />
            Alterar Senha
          </CardTitle>
          <CardDescription>Escolha uma senha forte com pelo menos 6 caracteres</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2 sm:max-w-[calc(50%-0.5rem)]">
            <Label htmlFor="currentPassword">Senha atual</Label>
            <Input
              id="currentPassword"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="newPassword">Nova senha</Label>
              <Input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirmar nova senha</Label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={handleChangePassword} disabled={loading || !newPassword || !currentPassword} className="gap-2">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
              Alterar senha
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" />
            Informações de Segurança
          </CardTitle>
          <CardDescription>Detalhes sobre sua conta e sessão atual</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
              <Clock className="h-5 w-5 text-muted-foreground mt-0.5" />
              <div>
                <p className="text-sm font-medium">Último login</p>
                <p className="text-xs text-muted-foreground">{lastSignIn}</p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
              <Monitor className="h-5 w-5 text-muted-foreground mt-0.5" />
              <div>
                <p className="text-sm font-medium">Conta criada em</p>
                <p className="text-xs text-muted-foreground">{createdAt}</p>
              </div>
            </div>
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Sessão atual</p>
              <p className="text-xs text-muted-foreground">
                Expira em {session?.expires_at ? new Date(session.expires_at * 1000).toLocaleString("pt-BR") : "—"}
              </p>
            </div>
            <Badge variant="outline" className="text-green-600 border-green-300 bg-green-50">
              Ativa
            </Badge>
          </div>

          <div className="p-3 rounded-lg border border-border bg-muted/30">
            <p className="text-xs font-medium text-muted-foreground mb-1">Proteção contra força bruta</p>
            <p className="text-xs text-muted-foreground">
              Após 5 tentativas de login com senha incorreta, sua conta será bloqueada por 60 segundos.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
