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

export interface BienvenidaEmailProps {
  empresaNombre: string;
  adminNombre: string;
  adminEmail?: string;
  planNombre?: string;
  planCosto?: string;
  planFeatures?: string[];
  fechaActivacion?: string;
  fechaExpiracion?: string;
  accessUrl?: string;
  appName: string;
  costoInstalacion?: string;
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

export const BienvenidaEmail: React.FC<BienvenidaEmailProps> = ({
  empresaNombre,
  adminNombre,
  adminEmail,
  planNombre,
  planCosto,
  planFeatures = [],
  fechaActivacion,
  fechaExpiracion,
  accessUrl = 'https://app.falconext.pe',
  appName,
  costoInstalacion,
  mensajeExtra,
}) => {
  const resetUrl = `${accessUrl.replace(/\/$/, '')}/forgot-password`;

  return (
    <Html lang="es">
      <Head />
      <Preview>
        Bienvenido a {appName}. La cuenta de {empresaNombre} ya está lista.
      </Preview>
      <Body style={main}>
        <Container style={outer}>
          <p style={brandName}>{appName}</p>

          <div style={card}>
            <div style={cardPad}>
              <p style={eyebrow}>Cuenta activada</p>
              <p style={titleText}>Bienvenido a {appName}</p>
              <p style={subtitle}>
                Hola, <strong>{adminNombre}</strong>. La cuenta de{' '}
                <strong>{empresaNombre}</strong> ya quedó habilitada para operar
                ventas, inventario, facturación y gestión del negocio.
              </p>

              <a href={accessUrl} style={ctaLink} target="_blank" rel="noreferrer">
                Ingresar a mi panel
              </a>
            </div>

            <Hr style={divider} />

            <div style={cardPad}>{/* sección: datos de la cuenta */}
              <table width="100%" cellPadding={0} cellSpacing={0} style={{ borderCollapse: 'collapse' }}>
                <tbody>
                  <tr>
                    <td style={metaLabel}>Empresa</td>
                    <td style={metaValue}>{empresaNombre}</td>
                  </tr>
                  <tr style={{ borderTop: '1px solid #f3f4f6' }}>
                    <td style={metaLabel}>Administrador</td>
                    <td style={metaValue}>{adminEmail || adminNombre}</td>
                  </tr>
                  <tr style={{ borderTop: '1px solid #f3f4f6' }}>
                    <td style={metaLabel}>Plan contratado</td>
                    <td style={metaValue}>{planNombre || 'Plan activo'}</td>
                  </tr>
                  <tr style={{ borderTop: '1px solid #f3f4f6' }}>
                    <td style={metaLabel}>Fecha de activación</td>
                    <td style={metaValue}>{fechaActivacion || 'Registrada'}</td>
                  </tr>
                  <tr style={{ borderTop: '1px solid #f3f4f6' }}>
                    <td style={metaLabel}>Vigencia</td>
                    <td style={metaValue}>{fechaExpiracion || 'Por confirmar'}</td>
                  </tr>
                  {planCosto && (
                    <tr style={{ borderTop: '1px solid #f3f4f6' }}>
                      <td style={metaLabel}>Inversión</td>
                      <td style={metaValue}>{planCosto}</td>
                    </tr>
                  )}
                  {costoInstalacion && (
                    <tr style={{ borderTop: '1px solid #f3f4f6' }}>
                      <td style={metaLabel}>Coste de instalación</td>
                      <td style={metaValue}>{costoInstalacion}</td>
                    </tr>
                  )}
                </tbody>
              </table>

              <div style={alertBox}>
                <p style={alertText}>
                  <strong>Acceso seguro:</strong> si necesitas crear o recuperar tu
                  contraseña, usa la opción de recuperación desde el panel. Por
                  seguridad no enviamos contraseñas por correo.
                </p>
              </div>
            </div>

            <Hr style={divider} />

            <div style={cardPad}>
              <p style={detailTitle}>Primeros pasos recomendados</p>
              <p style={{ ...detailText, marginBottom: '18px' }}>
                Te sugerimos dejar lista la configuración base antes de iniciar la
                operación diaria.
              </p>

              <Section>
                <table width="100%" cellPadding={0} cellSpacing={0} style={{ borderCollapse: 'collapse' }}>
                  <tbody>
                    <tr>
                      <td style={{ padding: '12px 0', verticalAlign: 'top', width: '50%' }}>
                        <p style={itemTitle}>Datos fiscales y series</p>
                        <p style={itemText}>Revisa RUC, dirección fiscal, certificados y numeración.</p>
                      </td>
                      <td style={{ padding: '12px 0 12px 18px', verticalAlign: 'top', width: '50%' }}>
                        <p style={itemTitle}>Productos y precios</p>
                        <p style={itemText}>Carga inventario, costos, categorías, marcas y stock inicial.</p>
                      </td>
                    </tr>
                    <tr style={{ borderTop: '1px solid #f3f4f6' }}>
                      <td style={{ padding: '12px 0', verticalAlign: 'top', width: '50%' }}>
                        <p style={itemTitle}>Equipo y sedes</p>
                        <p style={itemText}>Crea usuarios, permisos, sedes y almacenes según tu operación.</p>
                      </td>
                      <td style={{ padding: '12px 0 12px 18px', verticalAlign: 'top', width: '50%' }}>
                        <p style={itemTitle}>Pagos y tienda virtual</p>
                        <p style={itemText}>Configura cuentas bancarias, métodos de pago y catálogo online.</p>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </Section>
            </div>

            {planFeatures.length > 0 && (
              <>
                <Hr style={divider} />
                <div style={cardPad}>
                  <p style={detailTitle}>Incluido en tu plan</p>
                  <table width="100%" cellPadding={0} cellSpacing={0} style={{ borderCollapse: 'collapse' }}>
                    <tbody>
                      {planFeatures.slice(0, 8).map((feature, index) => (
                        <tr key={feature} style={index > 0 ? { borderTop: '1px solid #f3f4f6' } : undefined}>
                          <td style={metaLabel}>Módulo {index + 1}</td>
                          <td style={metaValue}>{feature}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {mensajeExtra && (
              <>
                <Hr style={divider} />
                <div style={cardPad}>
                  <p style={detailTitle}>Mensaje adicional</p>
                  <p style={detailText}>{mensajeExtra}</p>
                </div>
              </>
            )}
          </div>

          <Text style={footerText}>
            Este correo fue enviado al administrador de <strong>{empresaNombre}</strong>.
            Ingresa desde{' '}
            <a href={accessUrl} style={footerLink} target="_blank" rel="noreferrer">
              tu panel
            </a>{' '}
            o recupera tu acceso desde{' '}
            <a href={resetUrl} style={footerLink} target="_blank" rel="noreferrer">
              recuperación de contraseña
            </a>
            .
          </Text>
        </Container>
      </Body>
    </Html>
  );
};

export default BienvenidaEmail;
