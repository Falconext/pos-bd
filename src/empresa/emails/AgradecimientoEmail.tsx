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

export interface AgradecimientoEmailProps {
  empresaNombre: string;
  adminNombre: string;
  planNombre?: string;
  planCosto?: string;
  fechaExpiracion?: string;
  pagoConcepto?: string;
  pagoMonto?: string;
  pagoReferencia?: string;
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

const alertBox: React.CSSProperties = {
  backgroundColor: '#ecfdf5',
  border: '1px solid #bbf7d0',
  borderRadius: '12px',
  padding: '14px 16px',
  margin: '16px 0 0 0',
};

const alertText: React.CSSProperties = {
  color: '#166534',
  fontSize: '13px',
  lineHeight: '1.6',
  margin: '0',
};

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

export const AgradecimientoEmail: React.FC<AgradecimientoEmailProps> = ({
  empresaNombre,
  adminNombre,
  planNombre,
  planCosto,
  fechaExpiracion,
  pagoConcepto,
  pagoMonto,
  pagoReferencia,
  appName,
  mensajeExtra,
}) => {
  const soporteUrl = 'https://wa.me/5191065217';

  return (
    <Html lang="es">
      <Head />
      <Preview>
        Gracias por tu pago. {empresaNombre} mantiene su servicio activo.
      </Preview>
      <Body style={main}>
        <Container style={outer}>
          <p style={brandName}>{appName}</p>

          <div style={card}>
            <div style={cardPad}>
              <p style={eyebrow}>Confirmación de pago</p>
              <p style={titleText}>Pago registrado</p>
              <p style={subtitle}>
                Hola, <strong>{adminNombre}</strong>. Gracias por mantener la
                suscripción de <strong>{empresaNombre}</strong> al día. Tu pago
                ayuda a conservar la continuidad operativa de tu negocio.
              </p>

              <a href={soporteUrl} style={ctaLink} target="_blank" rel="noreferrer">
                Contactar soporte
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
                    <td style={metaLabel}>Concepto</td>
                    <td style={metaValue}>{pagoConcepto || 'Renovación de suscripción'}</td>
                  </tr>
                  <tr style={{ borderTop: '1px solid #f3f4f6' }}>
                    <td style={metaLabel}>Monto registrado</td>
                    <td style={metaValue}>{pagoMonto || planCosto || 'Registrado'}</td>
                  </tr>
                  <tr style={{ borderTop: '1px solid #f3f4f6' }}>
                    <td style={metaLabel}>Referencia</td>
                    <td style={metaValue}>{pagoReferencia || 'Confirmado por administración'}</td>
                  </tr>
                  <tr style={{ borderTop: '1px solid #f3f4f6' }}>
                    <td style={metaLabel}>Plan</td>
                    <td style={metaValue}>{planNombre || 'Plan activo'}</td>
                  </tr>
                  <tr style={{ borderTop: '1px solid #f3f4f6' }}>
                    <td style={metaLabel}>Nueva vigencia</td>
                    <td style={metaValue}>{fechaExpiracion || 'Por confirmar'}</td>
                  </tr>
                </tbody>
              </table>

              <div style={alertBox}>
                <p style={alertText}>
                  <strong>Estado:</strong> tu servicio queda registrado como al día.
                  Conserva este correo como constancia administrativa del pago.
                </p>
              </div>
            </div>
          </div>

          <div style={card}>
            <div style={cardPad}>
              <p style={detailTitle}>Servicio activo y respaldado</p>
              <p style={{ ...detailText, marginBottom: '18px' }}>
                La suscripción vigente mantiene disponibles los módulos clave para
                que el negocio continúe operando con orden.
              </p>

              <Section>
                <table width="100%" cellPadding={0} cellSpacing={0} style={{ borderCollapse: 'collapse' }}>
                  <tbody>
                    <tr>
                      <td style={{ padding: '12px 0', verticalAlign: 'top', width: '50%' }}>
                        <p style={itemTitle}>Facturación y ventas</p>
                        <p style={itemText}>Emisión de comprobantes, historial, pagos y seguimiento.</p>
                      </td>
                      <td style={{ padding: '12px 0 12px 18px', verticalAlign: 'top', width: '50%' }}>
                        <p style={itemTitle}>Inventario y finanzas</p>
                        <p style={itemText}>Stock, kardex, reportes y control del dinero recibido.</p>
                      </td>
                    </tr>
                    <tr style={{ borderTop: '1px solid #f3f4f6' }}>
                      <td style={{ padding: '12px 0', verticalAlign: 'top', width: '50%' }}>
                        <p style={itemTitle}>Sedes y usuarios</p>
                        <p style={itemText}>Permisos, equipos de trabajo, sedes y almacenes.</p>
                      </td>
                      <td style={{ padding: '12px 0 12px 18px', verticalAlign: 'top', width: '50%' }}>
                        <p style={itemTitle}>Tienda virtual</p>
                        <p style={itemText}>Catálogo online, pedidos y presencia comercial digital.</p>
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
            Para dudas sobre tu plan o comprobante de pago, escribe a{' '}
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

export default AgradecimientoEmail;
