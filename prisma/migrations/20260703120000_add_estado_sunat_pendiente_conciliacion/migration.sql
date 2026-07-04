DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_enum
        WHERE enumlabel = 'PENDIENTE_CONCILIACION'
          AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'EstadoSunat')
    ) THEN
        ALTER TYPE "EstadoSunat" ADD VALUE 'PENDIENTE_CONCILIACION';
    END IF;
END $$;
