# Manual do Usuário — PB One / Sistema de Gestão de Armários

Este guia explica, em linguagem simples, **como usar todas as funções** do sistema. Não é necessário saber programação: basta seguir os passos na ordem.

**Endereço típico do sistema:** o link que a sua empresa usou (ex.: `https://pblocker.sistembr.com.br` ou `https://pbonelocker.com.br`).

---

## Sumário

1. [Antes de começar](#1-antes-de-começar)
2. [Tipos de acesso (papéis)](#2-tipos-de-acesso-papéis)
3. [Entrar, sair e recuperar senha](#3-entrar-sair-e-recuperar-senha)
4. [Como se locar no painel](#4-como-se-locar-no-painel)
5. [Ordem recomendada para configurar o sistema do zero](#5-ordem-recomendada-para-configurar-o-sistema-do-zero)
6. [Empresas](#6-empresas-somente-superadministrador)
7. [Departamentos e setores](#7-departamentos-e-setores)
8. [Pessoas (funcionários ou clientes)](#8-pessoas-funcionários-ou-clientes)
9. [Armários e portas](#9-armários-e-portas)
10. [Dashboard (Painel de Controle)](#10-dashboard-painel-de-controle)
11. [Histórico](#11-histórico)
12. [Renovações](#12-renovações)
13. [Auditoria](#13-auditoria)
14. [Configurações](#14-configurações)
15. [Portal do usuário final](#15-portal-do-usuário-final)
16. [App mobile (visão do administrador)](#16-app-mobile-visão-do-administrador)
17. [Personalização visual](#17-personalização-visual)
18. [Gerenciar usuários](#18-gerenciar-usuários)
19. [Logs de fechaduras e status da conexão](#19-logs-de-fechaduras-e-status-da-conexão)
20. [Problemas comuns](#20-problemas-comuns)

---

## 1. Antes de começar

### O que o sistema faz
O PB One serve para **gerenciar armários inteligentes**: cadastrar pessoas, atribuir portas, abrir fechaduras, controlar prazos, enviar avisos por e-mail/WhatsApp e acompanhar o histórico de uso.

### O que você precisa
- Um computador ou celular com internet
- O **endereço (link)** do sistema
- Um **e-mail** e uma **senha** fornecidos pelo administrador
- Em alguns casos, o **WhatsApp** ou e-mail da pessoa para receber avisos

### Dica de navegação
- **Menu à esquerda:** lista de telas disponíveis
- **Topo da tela:** nome da empresa, tema claro/escuro e sino de notificações
- **Rodapé do menu:** seu nome → opções de perfil e **Sair**

> **Importante:** nem todo mundo vê as mesmas telas. O que aparece depende do seu tipo de usuário e das permissões da empresa.

---

## 2. Tipos de acesso (papéis)

| Tipo | Para quem é | O que consegue fazer |
|------|-------------|----------------------|
| **Usuário comum** | Funcionário ou cliente que usa o armário | Só o **Portal**: abrir a própria porta, pedir renovação, fila, perfil e avisos |
| **Administrador** | Responsável da empresa | Painel completo da empresa: armários, pessoas, reservas, configurações de e-mail/WhatsApp, etc. |
| **Superadministrador** | Quem cuida de várias empresas / da plataforma | Tudo do administrador **mais** Empresas, usuários globais, personalização do sistema, app mobile, logs e status |

### Tipos de empresa
- **Funcionários:** as pessoas são tratadas como funcionários da empresa
- **Aluguel:** as pessoas são tratadas como clientes (ex.: locação de armários)

---

## 3. Entrar, sair e recuperar senha

### 3.1 Entrar no sistema
1. Abra o link do sistema no navegador.
2. Digite seu **e-mail** e sua **senha**.
3. Clique em **Entrar** (ou botão equivalente).
4. Se tudo estiver certo:
   - **Administrador / superadministrador** → vão para o painel (Dashboard)
   - **Usuário comum** → vai direto para o **Portal**

### 3.2 Se a senha for provisória (primeira vez)
1. Ao entrar, o sistema pode **obrigar** a criação de uma nova senha.
2. Digite a senha atual (a provisória).
3. Digite a **nova senha** (mínimo 6 caracteres) e confirme.
4. Salve. Depois disso você usa o sistema normalmente.

### 3.3 Esqueci minha senha
1. Na tela de login, clique em **Esqueci minha senha**.
2. Informe o e-mail cadastrado.
3. Confira a caixa de entrada (e o spam).
4. Abra o link recebido e defina uma **nova senha**.

### 3.4 Sair com segurança
1. No canto inferior do menu, clique no seu **nome/avatar**.
2. Clique em **Sair**.

> Se errar a senha várias vezes seguidas, o login pode ficar **bloqueado por alguns segundos**. Aguarde e tente de novo.

---

## 4. Como se locar no painel

(Para administradores e superadministradores.)

### Menu Principal (exemplos)
| Item do menu | Para que serve |
|--------------|----------------|
| **Dashboard** | Visão geral: quantas portas estão livres, ocupadas, etc. |
| **Armários** | Criar armários, reservar portas, abrir fechaduras, emergência |
| **Histórico** | Ver o passado de uso das portas |
| **Renovações** | Aprovar ou recusar pedidos de mais tempo no armário |
| **Auditoria** | Consultar registros de segurança e ações importantes |
| **Departamentos** | Organizar áreas da empresa |
| **Setores** | Subdivisões dos departamentos |
| **Pessoas** | Cadastrar quem usa os armários e criar acesso ao Portal |
| **Configurações** | Perfil, senha, e-mail, WhatsApp, regras do sistema |

### Menu Administração (só superadministrador)
| Item | Para que serve |
|------|----------------|
| **Empresas** | Criar e gerenciar empresas e suas permissões |
| **Gerenciar Usuários** | Ver papéis e criar superadministradores |
| **Personalização** | Cores, logos e textos da plataforma |
| **Logs Fechaduras** | Histórico técnico de aberturas |
| **Status Conexão** | Se o sistema e o banco estão saudáveis |

### Seletor de empresa (superadministrador)
No topo do menu lateral, escolha **qual empresa** você está administrando. Ou escolha **Todas as empresas**.

---

## 5. Ordem recomendada para configurar o sistema do zero

Siga esta ordem se for montar tudo pela primeira vez (papel de **superadministrador** e depois **administrador**):

1. **Criar a empresa** (menu Empresas)
2. **Definir permissões** da empresa (quais módulos ela usa)
3. **Criar um administrador** dessa empresa
4. Em Configurações (como admin):
   - Configurar **E-mail** (se for enviar avisos)
   - Configurar **WhatsApp** (se for enviar avisos)
   - Ajustar **Sistema** (fila de espera, higienização, tempo de sessão)
   - Revisar **Templates** de mensagens
5. Cadastrar **Departamentos**
6. Cadastrar **Setores**
7. Cadastrar **Pessoas**
8. Criar **Armários** e portas
9. **Vincular fechaduras** (Lock ID) nas portas, se usar hardware
10. **Reservar** portas para as pessoas (ou deixar o uso pelo Portal)
11. **Criar acesso** (senha) para quem deve usar o Portal / app
12. Testar: login no Portal → abrir porta → pedir renovação → aprovar em Renovações

---

## 6. Empresas (somente superadministrador)

### 6.1 Cadastrar uma empresa
1. Menu **Empresas**.
2. Clique em **Nova empresa** (ou botão semelhante).
3. Preencha, no mínimo:
   - Nome
   - Tipo (**Funcionários** ou **Aluguel**)
   - Contato (e-mail, telefone, responsável) conforme o formulário
4. Salve.

### 6.2 Editar, desativar ou reativar
1. Na lista, abra a empresa desejada.
2. **Editar** os dados e salvar.
3. Para **desativar:** use a opção de desativar (os dados ficam salvos, mas a empresa deixa de operar normalmente).
4. Para **reativar:** use a opção correspondente.

### 6.3 Criar o primeiro usuário da empresa
1. Na empresa, use **Criar usuário**.
2. Informe nome, e-mail, senha e perfil (**admin** ou **usuário**).
3. Entregue o e-mail e a senha à pessoa (ou peça que use “Esqueci minha senha” depois).

### 6.4 Definir o que a empresa pode usar (permissões)
1. Abra as **permissões** da empresa.
2. Ligue ou desligue módulos, por exemplo:
   - Dashboard, Armários, Pessoas, Departamentos, Setores
   - Histórico, Renovações, Auditoria
   - Fila de espera, Higienização, Portal do usuário
   - WhatsApp, E-mail, White Label (marca própria)
3. Se preferir, aplique um **pacote pronto** (Básico / Padrão / Premium), se disponível.
4. Salve.

---

## 7. Departamentos e setores

Departamentos e setores organizam as pessoas (ex.: RH → Recepção).

### 7.1 Criar um departamento
1. Menu **Departamentos**.
2. Clique em **Novo** / **Adicionar**.
3. Informe **nome** e, se quiser, **descrição**.
4. Salve.

### 7.2 Editar, ativar ou desativar um departamento
1. Na lista, use o menu de ações (⋯) ou os botões do card.
2. **Editar** → altere e salve.
3. **Desativar** / **Ativar** conforme a necessidade.
4. **Excluir** só se realmente não for mais usar (cuidado).

### 7.3 Criar um setor
1. Menu **Setores**.
2. Clique em **Novo**.
3. Informe **nome**, escolha o **departamento** e, se quiser, a descrição.
4. Salve.

### 7.4 Filtrar setores
Use a busca e o filtro por departamento para achar o setor desejado.

---

## 8. Pessoas (funcionários ou clientes)

O nome da tela muda conforme a empresa: **Pessoas**, **Funcionários** ou **Clientes**.

### 8.1 Cadastrar uma pessoa
1. Menu **Pessoas**.
2. Clique em **Novo**.
3. Preencha:
   - Nome (obrigatório)
   - Tipo (funcionário / cliente, se existir a opção)
   - E-mail, telefone, cargo, matrícula
   - Departamento e setor (se já tiver cadastrado)
4. Salve.

### 8.2 Ver, editar, ativar ou excluir
1. Use a **busca** (nome, e-mail ou matrícula).
2. Filtre por **ativos/inativos** e tipo, se precisar.
3. Menu de ações:
   - **Ver detalhes**
   - **Editar**
   - **Ativar** / **Desativar**
   - **Excluir** (confirmação)

### 8.3 Criar acesso ao Portal (definir senha)
Isso permite que a pessoa entre no **Portal** / app.

1. Na pessoa **ativa** que ainda **não tem acesso**, clique em **Criar Acesso**.
2. Confirme o **e-mail** e digite uma **senha provisória** (mínimo 6 caracteres).
3. Marque, se quiser:
   - Enviar por **WhatsApp**
   - Enviar por **E-mail**
4. Confirme.
5. A pessoa deve entrar com esse e-mail/senha e **trocar a senha** no primeiro uso, se o sistema exigir.

> Se aparecer mensagem de e-mail já cadastrado, o sistema tenta **reaproveitar** o usuário existente. Se o e-mail estiver com **outra pessoa**, use outro e-mail ou ajuste o cadastro.

### 8.4 Importar várias pessoas de uma vez
1. Na tela Pessoas, abra a opção de **importação**.
2. Baixe o **modelo** (Excel/CSV).
3. Preencha o arquivo.
4. Envie o arquivo, revise a pré-visualização e confirme a importação.

---

## 9. Armários e portas

### 9.1 Criar um armário
1. Menu **Armários**.
2. Clique em **Novo armário**.
3. Preencha:
   - **Nome** (ex.: “Bloco A – Térreo”)
   - **Localização** (ex.: “Recepção”)
   - **Orientação** (vertical ou horizontal)
   - **Quantidade de colunas e linhas** (isso define quantas portas existem)
   - Tamanho padrão das portas (P / M / G), se solicitado
   - **Endereço da placa** (IP) e **porta** da placa, se usar controle eletrônico
4. Confira a prévia das portas.
5. Salve.

### 9.2 Editar um armário
1. Abra as opções do armário.
2. Altere nome, local, IP da placa, etc.
3. Salve.

### 9.3 Excluir um armário
1. Escolha o armário → **Excluir**.
2. Confirme.  
   Isso remove o armário, as portas e as reservas ligadas a ele.

> Só exclua se tiver certeza. O histórico de auditoria pode manter registros antigos, mas o armário some da operação.

### 9.4 Abrir o detalhe de uma porta
1. Clique em um **armário**.
2. Clique na **porta** desejada.
3. Abra o painel lateral com opções da porta.

### 9.5 Vincular a fechadura física (Lock ID)
1. No detalhe da porta, informe o **Lock ID** (número da fechadura).
2. Salve.

Sem esse vínculo, o comando de “abrir fechadura” pode não funcionar no hardware.

### 9.6 Reservar uma porta para uma pessoa (agora)
1. No detalhe da porta disponível, escolha **Reservar**.
2. Selecione a **pessoa**.
3. Escolha o tipo de uso:
   - **Permanente** — sem prazo (ou conforme a regra da empresa)
   - **Temporário** — com prazo (1h, 2h, … ou data/hora)
4. Confirme.

### 9.7 Agendar uma reserva
1. No detalhe da porta, escolha **Agendar**.
2. Informe início e duração (ou fim).
3. Confirme.

### 9.8 Abrir a fechadura de uma porta
1. No detalhe da porta (com Lock ID), clique em **Abrir**.
2. Aguarde a confirmação na tela.

### 9.9 Renovar o prazo (pelo administrador)
1. Na porta com uso temporário, escolha **Renovar**.
2. Selecione +1h, +2h, … conforme as opções.
3. Confirme.

### 9.10 Liberar a porta
1. No detalhe da porta ocupada, clique em **Liberar**.
2. Confirme.
3. Se a **higienização** estiver ligada, a porta pode ficar um tempo em status “higienização” antes de voltar a “disponível”.

### 9.11 Manutenção
1. Na porta, escolha **Colocar em manutenção**.
2. Quando terminar o serviço, **retirar de manutenção**.

### 9.12 Fila de espera (pelo administrador)
Só funciona se a fila estiver **ligada** nas Configurações / permissões.
1. No armário/porta, abra a **fila**.
2. Adicione uma pessoa e o tamanho preferido (se pedido).
3. Remova da fila quando necessário.

### 9.13 Emergência — abrir todas as fechaduras
1. Na tela **Armários**, localize o botão **Emergência**.
2. Leia o aviso e confirme.
3. O sistema tenta abrir **todas** as fechaduras da operação.  
   **Use só em situações reais de emergência** — a ação fica registrada.

### 9.14 Relatório de ocupação
1. Em Armários, abra **Relatório**.
2. Filtre o que precisar.
3. Se disponível, **exporte CSV** (abre no Excel).

### 9.15 Alternar grade / lista e filtros
- Use a busca por nome.
- Filtre por localização e status.
- Ordene por nome, ocupação, etc.
- Alterne visualização em **grade** ou **lista**.

---

## 10. Dashboard (Painel de Controle)

1. Abra **Dashboard** no menu.
2. Veja os números: total de portas, disponíveis, ocupadas, manutenção, higienização.
3. Use filtros de **período**, **armário** e **status**.
4. Use a busca para achar portas ou ocupantes.
5. Acompanhe gráficos e a lista de portas.
6. Se houver portas em higienização, observe o tempo restante.

---

## 11. Histórico

1. Menu **Histórico**.
2. Busque por nome, porta ou matrícula.
3. Filtre por status e armário.
4. Percorra as páginas da lista.
5. Se precisar, **exporte CSV**.

---

## 12. Renovações

Quando um usuário do Portal pede mais tempo no armário, o pedido aparece aqui.

### 12.1 Aprovar
1. Menu **Renovações**.
2. Filtre por **Pendente**, se precisar.
3. Abra o pedido.
4. Clique em **Aprovar**.
5. Se quiser, escreva uma **nota** e confirme.

### 12.2 Recusar
1. Mesmo fluxo, mas clique em **Recusar**.
2. Informe o motivo na nota, se existir o campo.
3. Confirme.

O usuário recebe o resultado pelos **avisos** do Portal (e e-mail/WhatsApp, se configurados).

---

## 13. Auditoria

Use para **rastrear o que aconteceu** no sistema (segurança e conformidade).

1. Menu **Auditoria**.
2. Aba **Logs**:
   - Busque e filtre por categoria / período
   - Abra o detalhe de um registro
   - Exporte CSV, se necessário
3. Aba **Dashboard** (se existir):
   - Veja resumos (ações mais comuns, atividade, etc.)

Exemplos do que fica registrado: atribuição/liberação de porta, renovações, logins, falhas de login, criação de pessoas, abertura de emergência, etc.

---

## 14. Configurações

Menu **Configurações** (também acessível pelo seu nome no rodapé do menu: **Meu Perfil** / **Preferências**).

### 14.1 Perfil (todos)
1. Aba **Perfil**.
2. Altere o **nome completo**.
3. O e-mail geralmente é só visualização.
4. Salve.

### 14.2 Segurança (todos)
1. Aba **Segurança**.
2. Informe senha atual e a nova senha.
3. Confirme e salve.
4. Veja informações como último login (se mostradas).

### 14.3 Notificações (todos)
1. Aba **Notificações**.
2. Ligue/desligue:
   - Feedback sonoro
   - Avisos de armários, segurança, usuários, atualizações
3. Salve, se houver botão de salvar.

### 14.4 E-mail (administrador)
1. Aba **E-mail**.
2. Ative o envio por SMTP e preencha servidor, porta, usuário, senha e remetente.
3. Ajuste o visual do e-mail (cores, logo, textos), se disponível.
4. Clique em **Enviar teste**.
5. Só depois de funcionar, salve e conte com os avisos automáticos.

### 14.5 WhatsApp (administrador)
1. Aba **WhatsApp**.
2. Informe os dados do servidor/token conforme o fornecedor.
3. Conecte a instância (em geral com **QR Code** no celular).
4. Envie uma **mensagem de teste**.
5. Depois de conectado, os avisos (reserva, acesso criado, fila, etc.) podem usar o WhatsApp.

### 14.6 Templates (administrador)
1. Aba **Templates**.
2. Escolha o tipo de mensagem (reserva confirmada, porta liberada, expirando, boas-vindas, fila, etc.).
3. Edite o texto (há “variáveis” como nome da pessoa — não apague se não souber o significado).
4. Ative/desative e salve.
5. Use **restaurar padrão** se estragar o texto.

### 14.7 Fechaduras (administrador)
1. Aba **Fechaduras**.
2. Veja/gere a **chave de API** (para o agente/hardware).
3. Use o painel de **teste** para enviar um comando e ver o status, se precisar.

### 14.8 Sistema (administrador)
1. Aba **Sistema**.
2. Ajuste fuso, formato de data e tempo de sessão.
3. Ligue/desligue **fila de espera**.
4. Ligue/desligue **higienização** e defina o tempo em minutos.
5. Salve.

### 14.9 App Mobile (superadministrador)
Ver [seção 16](#16-app-mobile-visão-do-administrador).

### 14.10 Atualizações (superadministrador)
1. Aba **Atualizações**.
2. Veja a versão instalada.
3. Verifique e execute atualizações **somente** se a equipe técnica orientou — mudanças podem reiniciar o sistema.

---

## 15. Portal do usuário final

Para quem tem papel **usuário** (pessoa com acesso criado em Pessoas).

### 15.1 Entrar
1. Abra o link do sistema.
2. Faça login com o e-mail e a senha.
3. Você cai no **Portal** (não no Dashboard administrativo).

### 15.2 Meus armários
1. Aba **Armários**.
2. Veja as portas atribuídas a você (local, tamanho, prazo).
3. **Abrir** — manda o comando de abertura para a fechadura.
4. **Renovar** — peça mais horas; o administrador precisa **aprovar**.
5. **Liberar** — se o uso for temporário e a opção existir, devolva a porta.
6. **Histórico** — veja aberturas daquela porta (se habilitado).

### 15.3 Fila de espera
(Se a empresa tiver essa função ligada.)
1. Aba **Fila**.
2. Entre na fila de um armário e escolha o tamanho preferido.
3. Acompanhe se está na fila, notificado ou atendido.
4. Cancele/saia da fila se não precisar mais.

### 15.4 Histórico geral e avisos
1. Aba **Histórico** — se existir, veja seus comandos/aberturas.
2. Aba **Avisos** — notificações (atribuição, expiração, renovação aprovada/recusada…).
3. Marque avisos como lidos (um a um ou todos).

### 15.5 Perfil no Portal
1. Aba **Perfil**.
2. Atualize telefone e preferências (e-mail, WhatsApp, aviso de expiração, renovação).
3. Troque a foto, se a opção existir (respeite o tamanho máximo indicado).

### 15.6 Segurança no Portal
1. Aba **Segurança**.
2. Troque a senha.
3. Encerre a sessão ao terminar, principalmente em computadores compartilhados.

---

## 16. App mobile (visão do administrador)

O app usa as mesmas regras do Portal. O **superadministrador** liga/desliga funções por empresa:

1. Configurações → aba **App Mobile**.
2. Escolha a empresa.
3. Ative o que for permitido no app, por exemplo:
   - Abrir fechadura
   - Histórico
   - Notificações
   - Pedir renovação
   - Liberar porta
   - Editar perfil
   - Fila de espera
   - Branding personalizado
4. Salve.
5. Oriente os usuários a baixar/usar o app com o mesmo login do Portal.

---

## 17. Personalização visual

### 17.1 Plataforma inteira (superadministrador)
1. Menu **Personalização**.
2. Use as abas (Cores, Textos, Imagens, Preview, Contraste, Histórico).
3. Defina nome da plataforma, textos do login, logos e fundo.
4. Pré-visualize e salve.
5. Se precisar, restaure o padrão ou importe/exporte a configuração.

### 17.2 Marca da empresa (White Label)
Se a empresa tiver a permissão **White Label**, as cores/logos da empresa podem aparecer no login e na interface. Configure conforme o painel de marca da empresa (quando disponível) ou peça suporte à equipe.

### 17.3 Tema claro / escuro
No topo do painel, use o botão de **sol/lua** (ou equivalente) para alternar a aparência.

---

## 18. Gerenciar usuários

(Só **superadministrador**.)

1. Menu **Gerenciar Usuários**.
2. Veja a lista e o papel de cada um (**user**, **admin**, **superadmin**).
3. Altere o papel e salve, quando necessário.
4. Use **Criar Superadmin** para um novo administrador global (e-mail, senha, nome).

> Não transforme contas comuns em superadministrador sem necessidade — esse papel tem acesso a **todas** as empresas.

---

## 19. Logs de fechaduras e status da conexão

### 19.1 Logs Fechaduras (superadministrador)
1. Menu **Logs Fechaduras**.
2. Atualize a lista.
3. Busque por pessoa, armário ou Lock ID.
4. Filtre por status, origem e datas.
5. Exporte CSV, se precisar investigar problemas de abertura.

### 19.2 Status Conexão (superadministrador)
1. Menu **Status Conexão**.
2. Veja se banco e autenticação estão **ok**.
3. Atualize as checagens.
4. Ajuste alertas de latência/som, se disponível.

Use isso quando o sistema estiver lento, com erro 502 ou “fora do ar”.

---

## 20. Problemas comuns

| Situação | O que fazer |
|----------|-------------|
| Esqueci a senha | Use **Esqueci minha senha** na tela de login |
| “E-mail ou senha incorretos” | Confira o e-mail; peça nova senha ao admin |
| Usuário comum cai no Portal e não vê Armários | Isso é normal — o menu administrativo é só para admin |
| Não consigo abrir a fechadura | Confira se a porta tem **Lock ID**, se a placa está ligada e se o Status/agente está ok |
| Pedido de renovação não muda o prazo | Admin ainda precisa **aprovar** em Renovações |
| Não recebo WhatsApp | Admin precisa conectar o WhatsApp (QR) e a pessoa precisa ter telefone correto |
| Não recebo e-mail | Conferir spam; admin testa SMTP; e-mail da pessoa precisa estar certo |
| Erro ao excluir armário | Atualize a página e tente de novo; se persistir, avise o suporte |
| Erro 502 no login | O sistema pode estar fora do ar — avise o superadministrador / suporte técnico |
| Não vejo um item no menu | Sua empresa pode não ter a permissão daquele módulo |

---

## Glossário rápido

| Termo | Significado |
|-------|-------------|
| **Porta** | Cada compartimento do armário |
| **Lock ID** | Número da fechadura eletrônica ligada à porta |
| **Reserva** | Atribuir uma porta a uma pessoa |
| **Uso temporário** | Porta com prazo de validade |
| **Renovação** | Pedido (ou ação) para estender o prazo |
| **Fila** | Lista de espera quando não há porta livre |
| **Higienização** | Tempo em que a porta fica indisponível após liberar |
| **Portal** | Área do usuário final (sem menu de administração) |
| **Emergência** | Abrir todas as fechaduras de uma vez |
| **White Label** | Visual com a marca da sua empresa |

---

## Fluxos resumidos (mapa mental)

### Fluxo do administrador no dia a dia
`Cadastrar pessoa` → `Criar acesso` → `Reservar porta` → `Acompanhar no Dashboard` → `Aprovar renovações` → `Consultar histórico/auditoria`

### Fluxo do usuário final
`Login no Portal` → `Ver meu armário` → `Abrir` → (opcional) `Pedir renovação` → (opcional) `Entrar na fila` → `Ver avisos`

### Fluxo de primeira implantação
`Empresa` → `Permissões` → `Admin da empresa` → `E-mail/WhatsApp` → `Departamentos/Setores` → `Pessoas` → `Armários` → `Lock ID` → `Reservas` → `Teste no Portal`

---

*Documento gerado a partir da análise das telas e funções do sistema PB One / Locker System. Em caso de dúvida sobre um botão específico da sua instalação, pequa orientação ao administrador da sua empresa.*
