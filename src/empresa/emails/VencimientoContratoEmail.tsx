import * as React from 'react';
import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Preview,
  Text,
} from '@react-email/components';

export interface VencimientoContratoEmailProps {
  destinatarioNombre: string;
  // true = el correo va al cliente dueño del vehículo; false = va al negocio/empresa.
  esCliente: boolean;
  placa: string;
  vehiculoDesc?: string; // marca + modelo
  servicio?: string;
  diasRestantes: number;
  fechaVencimiento: string;
  negocioNombre?: string; // nombre comercial del negocio (para el cliente)
  appName: string;
  ctaUrl?: string;
}

// ── Estilos (mismos que BienvenidaEmail / RecordatorioEmail) ──────────────────
const main: React.CSSProperties = {
  backgroundColor: '#111111',
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  margin: 0,
  padding: 0,
};
const outer: React.CSSProperties = {
  margin: '0 auto',
  padding: '40px 16px 48px',
  maxWidth: '560px',
};
const brandName: React.CSSProperties = {
  color: '#ffffff',
  fontSize: '16px',
  fontWeight: '700',
  margin: '0 0 24px 0',
};
const card: React.CSSProperties = {
  backgroundColor: '#ffffff',
  borderRadius: '14px',
  overflow: 'hidden',
  marginBottom: '16px',
};
const cardPad: React.CSSProperties = { padding: '28px 32px' };
const eyebrow: React.CSSProperties = {
  fontSize: '13px',
  color: '#6b7280',
  margin: '0 0 6px 0',
};
const titleText: React.CSSProperties = {
  fontSize: '34px',
  fontWeight: '800',
  color: '#111827',
  margin: '0 0 8px 0',
  letterSpacing: '-1px',
  lineHeight: '1.05',
};
const subtitle: React.CSSProperties = {
  fontSize: '14px',
  color: '#6b7280',
  margin: '0 0 20px 0',
  lineHeight: '1.6',
};
const ctaLink: React.CSSProperties = {
  backgroundColor: '#111111',
  color: '#ffffff',
  display: 'inline-block',
  fontSize: '13px',
  fontWeight: '700',
  letterSpacing: '0.02em',
  textDecoration: 'none',
  padding: '13px 18px',
  borderRadius: '10px',
};
const divider: React.CSSProperties = {
  border: 'none',
  borderTop: '1px solid #e5e7eb',
  margin: '0',
};
const metaLabel: React.CSSProperties = {
  fontSize: '13px',
  color: '#6b7280',
  margin: '0',
  padding: '10px 0',
};
const metaValue: React.CSSProperties = {
  fontSize: '13px',
  color: '#111827',
  fontWeight: '600',
  margin: '0',
  padding: '10px 0',
  textAlign: 'right' as const,
};
const alertBox = (tone: 'danger' | 'warning' | 'ok'): React.CSSProperties => ({
  backgroundColor:
    tone === 'danger' ? '#fef2f2' : tone === 'warning' ? '#fffbeb' : '#ecfdf5',
  border:
    tone === 'danger'
      ? '1px solid #fecaca'
      : tone === 'warning'
        ? '1px solid #fde68a'
        : '1px solid #bbf7d0',
  borderRadius: '12px',
  padding: '14px 16px',
  margin: '16px 0 0 0',
});
const alertText = (tone: 'danger' | 'warning' | 'ok'): React.CSSProperties => ({
  color:
    tone === 'danger' ? '#991b1b' : tone === 'warning' ? '#92400e' : '#166534',
  fontSize: '13px',
  lineHeight: '1.6',
  margin: '0',
});
const footerText: React.CSSProperties = {
  fontSize: '13px',
  color: '#6b7280',
  textAlign: 'center' as const,
  lineHeight: '1.6',
  margin: '20px 0 4px 0',
};

const getCopy = (dias: number, esCliente: boolean, placa: string) => {
  const tuServicio = esCliente
    ? `el servicio de tu vehículo ${placa}`
    : `el contrato del vehículo ${placa}`;

  if (dias < 0) {
    const d = Math.abs(dias);
    return {
      tone: 'danger' as const,
      headline: 'Contrato vencido',
      status: `Venció hace ${d} día${d === 1 ? '' : 's'}`,
      preview: `${esCliente ? 'El servicio de tu vehículo' : 'El contrato del vehículo'} ${placa} venció.`,
      message: `Te recordamos que ${tuServicio} ya venció. Renuévalo para seguir con el servicio activo.`,
      recommendation: esCliente
        ? 'Comunícate con tu proveedor para renovar y evitar la interrupción del servicio.'
        : 'Renueva o contacta al cliente para regularizar el contrato cuanto antes.',
    };
  }
  if (dias === 0) {
    return {
      tone: 'warning' as const,
      headline: 'Vence hoy',
      status: 'Último día',
      preview: `${esCliente ? 'El servicio de tu vehículo' : 'El contrato del vehículo'} ${placa} vence hoy.`,
      message: `Hoy vence ${tuServicio}. Renuévalo hoy mismo para no perder la continuidad.`,
      recommendation: esCliente
        ? 'Renueva hoy para mantener el monitoreo/servicio de tu vehículo sin cortes.'
        : 'Confirma la renovación con el cliente antes del cierre del día.',
    };
  }
  const dLabel = dias === 1 ? 'mañana' : `en ${dias} días`;
  return {
    tone: dias <= 5 ? ('warning' as const) : ('ok' as const),
    headline: dias === 1 ? 'Vence mañana' : `Vence en ${dias} días`,
    status: 'Renovación pendiente',
    preview: `${esCliente ? 'El servicio de tu vehículo' : 'El contrato del vehículo'} ${placa} vence ${dLabel}.`,
    message: `Te recordamos que ${tuServicio} vence ${dLabel}. Puedes renovarlo con anticipación.`,
    recommendation: esCliente
      ? 'Coordina con tu proveedor la renovación para no quedarte sin servicio.'
      : 'Contacta al cliente para coordinar la renovación con tiempo.',
  };
};

export const VencimientoContratoEmail: React.FC<
  VencimientoContratoEmailProps
> = ({
  destinatarioNombre,
  esCliente,
  placa,
  vehiculoDesc,
  servicio,
  diasRestantes,
  fechaVencimiento,
  negocioNombre,
  appName,
  ctaUrl,
}) => {
  const copy = getCopy(diasRestantes, esCliente, placa);

  return (
    <Html lang="es">
      <Head />
      <Preview>{`${copy.preview}`}</Preview>
      <Body style={main}>
        <Container style={outer}>
          <p style={brandName}>{negocioNombre || appName}</p>

          <div style={card}>
            <div style={cardPad}>
              <p style={eyebrow}>Recordatorio de vencimiento</p>
              <p style={titleText}>{copy.headline}</p>
              <p style={subtitle}>
                Hola, <strong>{destinatarioNombre}</strong>. {copy.message}
              </p>

              {ctaUrl && (
                <a href={ctaUrl} style={ctaLink} target="_blank" rel="noreferrer">
                  {esCliente ? 'Contactar al proveedor' : 'Ver contratos'}
                </a>
              )}
            </div>

            <Hr style={divider} />

            <div style={cardPad}>
              <table
                width="100%"
                cellPadding={0}
                cellSpacing={0}
                style={{ borderCollapse: 'collapse' }}
              >
                <tbody>
                  <tr>
                    <td style={metaLabel}>Vehículo</td>
                    <td style={metaValue}>
                      {placa}
                      {vehiculoDesc ? ` · ${vehiculoDesc}` : ''}
                    </td>
                  </tr>
                  {servicio && (
                    <tr style={{ borderTop: '1px solid #f3f4f6' }}>
                      <td style={metaLabel}>Servicio</td>
                      <td style={metaValue}>{servicio}</td>
                    </tr>
                  )}
                  <tr style={{ borderTop: '1px solid #f3f4f6' }}>
                    <td style={metaLabel}>Fecha de vencimiento</td>
                    <td style={metaValue}>{fechaVencimiento}</td>
                  </tr>
                  <tr style={{ borderTop: '1px solid #f3f4f6' }}>
                    <td style={metaLabel}>Estado</td>
                    <td style={metaValue}>{copy.status}</td>
                  </tr>
                </tbody>
              </table>

              <div style={alertBox(copy.tone)}>
                <p style={alertText(copy.tone)}>
                  <strong>Recomendación:</strong> {copy.recommendation}
                </p>
              </div>
            </div>
          </div>

          <Text style={footerText}>
            {esCliente
              ? `Este recordatorio fue enviado por ${negocioNombre || appName}.`
              : `Recordatorio automático de ${appName} para tu negocio ${negocioNombre || ''}.`}
          </Text>
        </Container>
      </Body>
    </Html>
  );
};

export default VencimientoContratoEmail;
