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

export interface NuevoPedidoItem {
  descripcion: string;
  cantidad: number;
  subtotal: string;
}

export interface NuevoPedidoEmailProps {
  empresaNombre: string;
  adminNombre?: string;
  appName: string;
  codigoSeguimiento: string;
  clienteNombre: string;
  clienteTelefono?: string;
  clienteEmail?: string;
  tipoEntrega: string;
  direccion?: string;
  medioPago?: string;
  total: string;
  items: NuevoPedidoItem[];
  fecha?: string;
  accessUrl?: string;
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
  fontSize: '32px',
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

const itemTitle: React.CSSProperties = {
  fontSize: '14px',
  color: '#111827',
  fontWeight: '600',
  margin: '0',
  padding: '10px 0',
};

const itemQty: React.CSSProperties = {
  fontSize: '13px',
  color: '#6b7280',
  margin: '0',
  padding: '10px 8px',
  textAlign: 'center' as const,
  whiteSpace: 'nowrap' as const,
};

const itemAmount: React.CSSProperties = {
  fontSize: '13px',
  color: '#111827',
  fontWeight: '700',
  margin: '0',
  padding: '10px 0',
  textAlign: 'right' as const,
  whiteSpace: 'nowrap' as const,
};

const totalBox: React.CSSProperties = {
  backgroundColor: '#ecfdf5',
  border: '1px solid #bbf7d0',
  borderRadius: '12px',
  padding: '16px 18px',
  margin: '18px 0 0 0',
};

const footerText: React.CSSProperties = {
  fontSize: '13px',
  color: '#6b7280',
  textAlign: 'center' as const,
  lineHeight: '1.6',
  margin: '20px 0 4px 0',
};

export const NuevoPedidoEmail: React.FC<NuevoPedidoEmailProps> = ({
  empresaNombre,
  adminNombre,
  appName,
  codigoSeguimiento,
  clienteNombre,
  clienteTelefono,
  clienteEmail,
  tipoEntrega,
  direccion,
  medioPago,
  total,
  items = [],
  fecha,
  accessUrl = 'https://app.falconext.pe',
}) => {
  const pedidosUrl = `${accessUrl.replace(/\/$/, '')}/administrador/tienda/pedidos`;

  return (
    <Html lang="es">
      <Head />
      <Preview>
        Nuevo pedido en {empresaNombre} — {codigoSeguimiento} por {total}
      </Preview>
      <Body style={main}>
        <Container style={outer}>
          <p style={brandName}>{appName}</p>

          <div style={card}>
            <div style={cardPad}>
              <p style={eyebrow}>Nuevo pedido en tu tienda</p>
              <p style={titleText}>¡Recibiste un pedido!</p>
              <p style={subtitle}>
                Hola{adminNombre ? <> <strong>{adminNombre}</strong></> : ''}. Tu tienda{' '}
                <strong>{empresaNombre}</strong> recibió un nuevo pedido online.
                Revisa el detalle y prepáralo desde tu panel.
              </p>

              <a href={pedidosUrl} style={ctaLink} target="_blank" rel="noreferrer">
                Ver el pedido en mi panel
              </a>
            </div>

            <Hr style={divider} />

            <div style={cardPad}>
              <table width="100%" cellPadding={0} cellSpacing={0} style={{ borderCollapse: 'collapse' }}>
                <tbody>
                  <tr>
                    <td style={metaLabel}>Código de seguimiento</td>
                    <td style={metaValue}>{codigoSeguimiento}</td>
                  </tr>
                  <tr style={{ borderTop: '1px solid #f3f4f6' }}>
                    <td style={metaLabel}>Cliente</td>
                    <td style={metaValue}>{clienteNombre}</td>
                  </tr>
                  {clienteTelefono && (
                    <tr style={{ borderTop: '1px solid #f3f4f6' }}>
                      <td style={metaLabel}>Teléfono</td>
                      <td style={metaValue}>{clienteTelefono}</td>
                    </tr>
                  )}
                  {clienteEmail && (
                    <tr style={{ borderTop: '1px solid #f3f4f6' }}>
                      <td style={metaLabel}>Correo</td>
                      <td style={metaValue}>{clienteEmail}</td>
                    </tr>
                  )}
                  <tr style={{ borderTop: '1px solid #f3f4f6' }}>
                    <td style={metaLabel}>Entrega</td>
                    <td style={metaValue}>{tipoEntrega}</td>
                  </tr>
                  {direccion && (
                    <tr style={{ borderTop: '1px solid #f3f4f6' }}>
                      <td style={metaLabel}>Dirección</td>
                      <td style={metaValue}>{direccion}</td>
                    </tr>
                  )}
                  {medioPago && (
                    <tr style={{ borderTop: '1px solid #f3f4f6' }}>
                      <td style={metaLabel}>Medio de pago</td>
                      <td style={metaValue}>{medioPago}</td>
                    </tr>
                  )}
                  {fecha && (
                    <tr style={{ borderTop: '1px solid #f3f4f6' }}>
                      <td style={metaLabel}>Fecha</td>
                      <td style={metaValue}>{fecha}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <Hr style={divider} />

            <div style={cardPad}>
              <p style={detailTitle}>Productos del pedido</p>
              <Section>
                <table width="100%" cellPadding={0} cellSpacing={0} style={{ borderCollapse: 'collapse' }}>
                  <tbody>
                    {items.map((it, index) => (
                      <tr key={`${it.descripcion}-${index}`} style={index > 0 ? { borderTop: '1px solid #f3f4f6' } : undefined}>
                        <td style={itemTitle}>{it.descripcion}</td>
                        <td style={itemQty}>x{it.cantidad}</td>
                        <td style={itemAmount}>{it.subtotal}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div style={totalBox}>
                  <table width="100%" cellPadding={0} cellSpacing={0} style={{ borderCollapse: 'collapse' }}>
                    <tbody>
                      <tr>
                        <td style={{ fontSize: '14px', fontWeight: 700, color: '#166534' }}>Total del pedido</td>
                        <td style={{ fontSize: '20px', fontWeight: 800, color: '#166534', textAlign: 'right' as const }}>{total}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </Section>
            </div>
          </div>

          <Text style={footerText}>
            Este correo fue enviado al administrador de <strong>{empresaNombre}</strong> desde {appName}.
          </Text>
        </Container>
      </Body>
    </Html>
  );
};

export default NuevoPedidoEmail;
