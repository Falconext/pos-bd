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

export interface ConfirmacionPedidoItem {
  descripcion: string;
  cantidad: number;
  subtotal: string;
}

export interface ConfirmacionPedidoClienteEmailProps {
  empresaNombre: string;
  appName: string;
  clienteNombre: string;
  codigoSeguimiento: string;
  tipoEntrega: string;
  direccion?: string;
  medioPago?: string;
  total: string;
  items: ConfirmacionPedidoItem[];
  trackingUrl?: string;
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

const codeBox: React.CSSProperties = {
  backgroundColor: '#f3f4f6',
  border: '1px dashed #d1d5db',
  borderRadius: '12px',
  padding: '16px 18px',
  textAlign: 'center' as const,
  margin: '0 0 4px 0',
};

const codeLabel: React.CSSProperties = {
  fontSize: '12px',
  color: '#6b7280',
  margin: '0 0 4px 0',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.08em',
};

const codeValue: React.CSSProperties = {
  fontSize: '22px',
  fontWeight: '800',
  color: '#111827',
  margin: '0',
  letterSpacing: '0.04em',
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

export const ConfirmacionPedidoClienteEmail: React.FC<ConfirmacionPedidoClienteEmailProps> = ({
  empresaNombre,
  appName,
  clienteNombre,
  codigoSeguimiento,
  tipoEntrega,
  direccion,
  medioPago,
  total,
  items = [],
  trackingUrl,
}) => {
  return (
    <Html lang="es">
      <Head />
      <Preview>
        Recibimos tu pedido en {empresaNombre}. Código {codigoSeguimiento}.
      </Preview>
      <Body style={main}>
        <Container style={outer}>
          <p style={brandName}>{empresaNombre}</p>

          <div style={card}>
            <div style={cardPad}>
              <p style={eyebrow}>Confirmación de pedido</p>
              <p style={titleText}>¡Gracias por tu compra!</p>
              <p style={subtitle}>
                Hola <strong>{clienteNombre}</strong>, recibimos tu pedido en{' '}
                <strong>{empresaNombre}</strong>. Te avisaremos cuando cambie de
                estado. Guarda tu código para hacerle seguimiento.
              </p>

              <div style={codeBox}>
                <p style={codeLabel}>Código de seguimiento</p>
                <p style={codeValue}>{codigoSeguimiento}</p>
              </div>

              {trackingUrl && (
                <div style={{ marginTop: '18px' }}>
                  <a href={trackingUrl} style={ctaLink} target="_blank" rel="noreferrer">
                    Ver el estado de mi pedido
                  </a>
                </div>
              )}
            </div>

            <Hr style={divider} />

            <div style={cardPad}>
              <table width="100%" cellPadding={0} cellSpacing={0} style={{ borderCollapse: 'collapse' }}>
                <tbody>
                  <tr>
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
                </tbody>
              </table>
            </div>

            <Hr style={divider} />

            <div style={cardPad}>
              <p style={detailTitle}>Resumen de tu pedido</p>
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
                        <td style={{ fontSize: '14px', fontWeight: 700, color: '#166534' }}>Total</td>
                        <td style={{ fontSize: '20px', fontWeight: 800, color: '#166534', textAlign: 'right' as const }}>{total}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </Section>
            </div>
          </div>

          <Text style={footerText}>
            Pedido realizado en {empresaNombre}. Este es un correo automático de confirmación.
          </Text>
        </Container>
      </Body>
    </Html>
  );
};

export default ConfirmacionPedidoClienteEmail;
