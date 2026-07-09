export type BillingProviderCode = 'QPSE' | 'APISUNAT' | 'JAMBLE';

type EmpresaLike = {
  billingProvider?: string | null;
  usaDemo?: boolean | null;
};

export function resolveBillingProvider(
  empresa: EmpresaLike | null | undefined,
): BillingProviderCode {
  const configured = String(empresa?.billingProvider || '')
    .trim()
    .toUpperCase();
  if (configured === 'JAMBLE') {
    return 'JAMBLE';
  }

  // APISUNAT desactivado temporalmente: forzamos QPSE para emisión estándar.
  // Si se requiere reactivar APISUNAT en el futuro, restaurar la resolución original aquí.
  return 'QPSE';
}

export function isQpseProvider(provider: BillingProviderCode): boolean {
  return provider === 'QPSE';
}

export function isApisunatProvider(provider: BillingProviderCode): boolean {
  return provider === 'APISUNAT';
}

export function isJambleProvider(provider: BillingProviderCode): boolean {
  return provider === 'JAMBLE';
}
