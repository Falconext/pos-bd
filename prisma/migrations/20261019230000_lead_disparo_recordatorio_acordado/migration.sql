-- Aviso nuevo que pidió Hierba Sana (19-10): el cliente dijo una fecha
-- ("en una semana", "a fin de mes") y se le escribe ese día.
ALTER TYPE "TipoDisparoLead" ADD VALUE IF NOT EXISTS 'RECORDATORIO_ACORDADO';
