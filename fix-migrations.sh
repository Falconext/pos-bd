#!/bin/bash
set -e

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
nvm use 22

cd "$(dirname "$0")"

# DB connection parts (from .env)
PGHOST="localhost"
PGPORT="5432"
PGUSER="postgres"
PGPASSWORD="developer"
PGMAINDB="sistema_mype"
PGSHADOWDB="sistema_mype_shadow"

SHADOW_DB_URL="postgresql://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${PGSHADOWDB}?schema=public"

echo ""
echo "=== Paso 1: Recalculando checksums y actualizando en la DB ==="
CHECKSUM1=$(cat prisma/migrations/20260421120000_add_submodulos/migration.sql | tr -d '\r' | shasum -a 256 | cut -d' ' -f1)
CHECKSUM2=$(cat prisma/migrations/add_tipo_guia_remision/migration.sql | tr -d '\r' | shasum -a 256 | cut -d' ' -f1)

echo "  add_submodulos         → $CHECKSUM1"
echo "  add_tipo_guia_remision → $CHECKSUM2"

cat > /tmp/fix_prisma_checksums.sql <<SQL
UPDATE "_prisma_migrations"
SET "checksum" = '${CHECKSUM1}'
WHERE migration_name = '20260421120000_add_submodulos';

UPDATE "_prisma_migrations"
SET "checksum" = '${CHECKSUM2}'
WHERE migration_name = 'add_tipo_guia_remision';
SQL

npx prisma db execute --file /tmp/fix_prisma_checksums.sql --schema prisma/schema.prisma
rm /tmp/fix_prisma_checksums.sql
echo "  ✓ Checksums actualizados en la DB"

echo ""
echo "=== Paso 2: Creando shadow database temporal ==="
PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d postgres \
  -c "DROP DATABASE IF EXISTS ${PGSHADOWDB};" 2>/dev/null || true
PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d postgres \
  -c "CREATE DATABASE ${PGSHADOWDB};"
echo "  ✓ Shadow DB '${PGSHADOWDB}' creada"

echo ""
echo "=== Paso 3: Generando migración baseline para el drift ==="
BASELINE="prisma/migrations/20260511000000_baseline_sync"

# Limpiar directorio si quedó vacío de un run anterior
rm -rf "$BASELINE"

npx prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datasource prisma/schema.prisma \
  --shadow-database-url "$SHADOW_DB_URL" \
  --script \
  --output /tmp/baseline_sync.sql

# Crear directorio y mover el archivo (así Prisma no ve un dir vacío)
mkdir -p "$BASELINE"
mv /tmp/baseline_sync.sql "$BASELINE/migration.sql"

echo "  ✓ Baseline generado"

echo ""
echo "=== Paso 4: Limpiando shadow database ==="
PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d postgres \
  -c "DROP DATABASE IF EXISTS ${PGSHADOWDB};" 2>/dev/null || true
echo "  ✓ Shadow DB eliminada"

echo ""
echo "=== Paso 5: Marcando baseline como ya aplicado ==="
npx prisma migrate resolve --applied 20260511000000_baseline_sync
echo "  ✓ Baseline marcado como aplicado"

echo ""
echo "=== Paso 6: Aplicando cambios pendientes del schema ==="
npx prisma migrate dev --name add_usa_demo_and_pending

echo ""
echo "=== ✓ Listo. Migraciones en sincronía. ==="
