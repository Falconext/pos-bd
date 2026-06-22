# Requirements: Gestión de cuentas bancarias por empresa

## Problem Statement
Las empresas peruanas manejan múltiples cuentas bancarias (BCP, INTERBANK, BBVA, SCOTIABANK) para recibir pagos. Actualmente el sistema solo almacena un banco por empresa y no permite rastrear a qué cuenta llegó cada pago por transferencia. Esto impide el control de tesorería por banco.

## Acceptance Criteria
- [ ] El administrador puede crear, editar y desactivar cuentas bancarias de su empresa
- [ ] Bancos soportados: BCP, INTERBANK, BBVA, SCOTIABANK, PICHINCHA, BANBIF, NACIÓN, OTROS
- [ ] Cada cuenta tiene: banco, número de cuenta, CCI (opcional), tipo (ahorros/corriente), moneda (PEN/USD), alias opcional
- [ ] Al registrar un pago con medioPago = "Transferencia", se puede seleccionar la cuenta bancaria destino
- [ ] El sistema guarda qué cuenta bancaria recibió cada pago
- [ ] La configuración está disponible en Mi Negocio (empresa settings)

## Scope

### In Scope
- CRUD de CuentaBancaria vinculada a Empresa
- Campo cuentaBancariaId en modelo Pago
- Selector de cuenta en ModalPaymentUnified cuando medioPago = Transferencia
- Página de configuración bajo empresa/Edit

### Out of Scope
- Reporte/dashboard de totales por banco (fase siguiente)
- Conciliación bancaria automática
- Integración con APIs bancarias
- Depósito como método de pago separado (se usa Transferencia)
- Pagos en caja (MovimientoCaja) — solo Pago de comprobantes

## Technical Constraints
- Backend: NestJS + Prisma, módulo empresa existente (no crear módulo nuevo)
- Frontend: React 19 + Zustand + Tailwind, patrón ViewModel/Store existente
- Respuestas: { code: 1, message, data }
- empresaId siempre del JWT, nunca del body
- Migración SQL idempotente

## Dependencies
- Módulo empresa existente (empresa.controller.ts, empresa.service.ts)
- Modelo Pago en schema.prisma
- ModalPaymentUnified.tsx y usePaymentFlow.ts

## Methodology: traditional
## Complexity: medium
