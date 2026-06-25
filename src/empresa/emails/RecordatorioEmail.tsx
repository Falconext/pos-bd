import * as React from 'react';
import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components';

export interface RecordatorioEmailProps {
  empresaNombre: string;
  adminNombre: string;
  diasRestantes: number;
  fechaExpiracion: string;
  planNombre?: string;
  appName: string;
  mensajeExtra?: string;
}

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

const cardPad: React.CSSProperties = {
  padding: '28px 32px',
};

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

const detailTitle: React.CSSProperties = {
  fontSize: '16px',
  fontWeight: '800',
  color: '#111827',
  margin: '0 0 6px 0',
};

const detailText: React.CSSProperties = {
  fontSize: '14px',
  color: '#374151',
  lineHeight: '1.7',
  margin: '0',
};

const itemTitle: React.CSSProperties = {
  fontSize: '14px',
  color: '#111827',
  fontWeight: '700',
  margin: '0 0 4px 0',
};

const itemText: React.CSSProperties = {
  fontSize: '13px',
  color: '#6b7280',
  lineHeight: '1.6',
  margin: '0',
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

const footerLink: React.CSSProperties = {
  color: '#6366f1',
  textDecoration: 'underline',
};

const getSubscriptionCopy = (diasRestantes: number) => {
  if (diasRestantes < 0) {
    const days = Math.abs(diasRestantes);
    return {
      tone: 'danger' as const,
      headline: 'Plan vencido',
      status: `Venció hace ${days} día${days === 1 ? '' : 's'}`,
      preview: 'Tu suscripción venció. Renueva para mantener el servicio activo.',
      message:
        'Tu suscripción ya venció. Mientras la empresa siga activa, te enviamos este recordatorio para que puedas regularizarla antes de que el acceso se vea afectado.',
      recommendation:
        'Prioriza la renovación hoy para evitar bloqueos operativos en facturación, inventario, ventas y tienda virtual.',
    };
  }

  if (diasRestantes === 0) {
    return {
      tone: 'warning' as const,
      headline: 'Vence hoy',
      status: 'Último día disponible',
      preview: 'Tu suscripción vence hoy. Renueva para continuar sin interrupciones.',
      message:
        'Tu suscripción vence hoy. Te recomendamos renovarla antes del cierre del día para mantener todos tus módulos disponibles.',
      recommendation:
        'Confirma el pago con soporte y solicita la ampliación de tu fecha de expiración.',
    };
  }

  return {
    tone: diasRestantes <= 7 ? ('warning' as const) : ('ok' as const),
    headline: `Vence en ${diasRestantes} día${diasRestantes === 1 ? '' : 's'}`,
    status: 'Renovación pendiente',
    preview: `Tu suscripción vence en ${diasRestantes} día${diasRestantes === 1 ? '' : 's'}.`,
    message:
      'Tu suscripción está próxima a vencer. Puedes renovarla con anticipación para que el negocio continúe operando sin pausas.',
    recommendation:
      'Revisa el plan actual, confirma si deseas mantenerlo o actualizarlo, y coordina el pago con soporte.',
  };
};

export const RecordatorioEmail: React.FC<RecordatorioEmailProps> = ({
  empresaNombre,
  adminNombre,
  diasRestantes,
  fechaExpiracion,
  planNombre,
  appName,
  mensajeExtra,
}) => {
  const copy = getSubscriptionCopy(diasRestantes);
  const soporteUrl = 'https://wa.me/5191065217';

  return (
    <Html lang="es">
      <Head />
      <Preview>{`${copy.preview} ${empresaNombre}`}</Preview>
      <Body style={main}>
        <Container style={outer}>
          <p style={brandName}>{appName}</p>

          <div style={card}>
            <div style={cardPad}>
              <p style={eyebrow}>Recordatorio de suscripción</p>
              <p style={titleText}>{copy.headline}</p>
              <p style={subtitle}>
                Hola, <strong>{adminNombre}</strong>. {copy.message}
              </p>

              <a href={soporteUrl} style={ctaLink} target="_blank" rel="noreferrer">
                Coordinar renovación
              </a>
            </div>

            <Hr style={divider} />

            <div style={cardPad}>
              <table width="100%" cellPadding={0} cellSpacing={0} style={{ borderCollapse: 'collapse' }}>
                <tbody>
                  <tr>
                    <td style={metaLabel}>Empresa</td>
                    <td style={metaValue}>{empresaNombre}</td>
                  </tr>
                  <tr style={{ borderTop: '1px solid #f3f4f6' }}>
                    <td style={metaLabel}>Plan actual</td>
                    <td style={metaValue}>{planNombre || 'Suscripción activa'}</td>
                  </tr>
                  <tr style={{ borderTop: '1px solid #f3f4f6' }}>
                    <td style={metaLabel}>Fecha de vencimiento</td>
                    <td style={metaValue}>{fechaExpiracion || 'Por confirmar'}</td>
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

          <div style={card}>
            <div style={cardPad}>
              <p style={detailTitle}>Qué se mantiene activo al renovar</p>
              <p style={{ ...detailText, marginBottom: '18px' }}>
                La renovación asegura continuidad para los procesos diarios del negocio.
              </p>

              <Section>
                <table width="100%" cellPadding={0} cellSpacing={0} style={{ borderCollapse: 'collapse' }}>
                  <tbody>
                    <tr>
                      <td style={{ padding: '12px 0', verticalAlign: 'top', width: '50%' }}>
                        <p style={itemTitle}>Facturación y ventas</p>
                        <p style={itemText}>Emisión, historial, pagos y seguimiento comercial.</p>
                      </td>
                      <td style={{ padding: '12px 0 12px 18px', verticalAlign: 'top', width: '50%' }}>
                        <p style={itemTitle}>Inventario y reportes</p>
                        <p style={itemText}>Stock, kardex, finanzas y control operativo.</p>
                      </td>
                    </tr>
                    <tr style={{ borderTop: '1px solid #f3f4f6' }}>
                      <td style={{ padding: '12px 0', verticalAlign: 'top', width: '50%' }}>
                        <p style={itemTitle}>Usuarios y sedes</p>
                        <p style={itemText}>Accesos del equipo, permisos, sedes y almacenes.</p>
                      </td>
                      <td style={{ padding: '12px 0 12px 18px', verticalAlign: 'top', width: '50%' }}>
                        <p style={itemTitle}>Tienda virtual</p>
                        <p style={itemText}>Catálogo, pedidos y presencia digital del negocio.</p>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </Section>
            </div>
          </div>

          {mensajeExtra && (
            <div style={card}>
              <div style={cardPad}>
                <p style={detailTitle}>Mensaje adicional</p>
                <p style={detailText}>{mensajeExtra}</p>
              </div>
            </div>
          )}

          <Text style={footerText}>
            Este correo fue enviado al administrador de <strong>{empresaNombre}</strong>.
            Si ya renovaste tu plan, puedes ignorarlo o escribir a{' '}
            <a href={soporteUrl} style={footerLink} target="_blank" rel="noreferrer">
              soporte
            </a>
            .
          </Text>
        </Container>
      </Body>
    </Html>
  );
};

export default RecordatorioEmail;
