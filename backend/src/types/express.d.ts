declare namespace Express {
  interface Request {
    user?: {
      id: string;
      user_id: string;
      email: string;
      role: string;
      company_id: string | null;
      full_name: string | null;
    };
    /** Agente IoT autenticado por API Key (fechaduras) */
    agente?: {
      id: string | null;
      company_id: string | null;
      global: boolean;
    };
  }
}
