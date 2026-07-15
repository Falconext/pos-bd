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

export interface ComprobanteEmailProps {
  empresaNombre: string;
  empresaRuc: string;
  empresaDireccion?: string;
  empresaEmail?: string;
  logoUrl?: string;
  tipoPretty: string;
  serie: string;
  correlativo: string;
  fecha: string;
  clienteNombre: string;
  monto: string;
  monedaSimbolo?: string;
  pdfUrl?: string;
  productos?: Array<{
    descripcion: string;
    cantidad: number;
    unidad?: string;
    precioUnitario: string;
    total: string;
  }>;
  formaPago?: string;
  mtoOperGravadas?: string;
  mtoIGV?: string;
  descuento?: string;
  sistemaUrl?: string;
  sistemaNombre?: string;
}

/* ── styles ───────────────────────────────────────────────────────────────── */

const main: React.CSSProperties = {
  backgroundColor: '#111111',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  margin: 0,
  padding: 0,
};

const outer: React.CSSProperties = {
  margin: '0 auto',
  padding: '40px 16px 48px',
  maxWidth: '560px',
};

/* top brand bar */
const brandRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  marginBottom: '28px',
};
const brandName: React.CSSProperties = {
  color: '#ffffff',
  fontSize: '16px',
  fontWeight: '600',
  margin: '0 0 24px 0',
};

/* white card */
const card: React.CSSProperties = {
  backgroundColor: '#ffffff',
  borderRadius: '14px',
  overflow: 'hidden',
  marginBottom: '16px',
};

const cardPad: React.CSSProperties = {
  padding: '28px 32px',
};

/* Card 1 — summary */
const receiptFrom: React.CSSProperties = {
  fontSize: '13px',
  color: '#6b7280',
  margin: '0 0 6px 0',
};

const amountText: React.CSSProperties = {
  fontSize: '40px',
  fontWeight: '800',
  color: '#111827',
  margin: '0 0 6px 0',
  letterSpacing: '-1px',
  lineHeight: '1',
};

const dateText: React.CSSProperties = {
  fontSize: '14px',
  color: '#6b7280',
  margin: '0 0 20px 0',
};

const downloadLink: React.CSSProperties = {
  fontSize: '13px',
  color: '#374151',
  textDecoration: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
  marginRight: '20px',
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
  fontWeight: '500',
  margin: '0',
  padding: '10px 0',
  textAlign: 'right' as const,
};

const divider: React.CSSProperties = {
  border: 'none',
  borderTop: '1px solid #e5e7eb',
  margin: '0',
};

/* Card 2 — detail */
const detailTitle: React.CSSProperties = {
  fontSize: '16px',
  fontWeight: '700',
  color: '#111827',
  margin: '0 0 6px 0',
};

const detailDate: React.CSSProperties = {
  fontSize: '13px',
  color: '#6b7280',
  margin: '0 0 20px 0',
};

const itemName: React.CSSProperties = {
  fontSize: '14px',
  fontWeight: '600',
  color: '#111827',
  margin: '0 0 2px 0',
};

const itemSub: React.CSSProperties = {
  fontSize: '12px',
  color: '#9ca3af',
  margin: '0',
};

const itemTotal: React.CSSProperties = {
  fontSize: '14px',
  fontWeight: '700',
  color: '#111827',
  margin: '0 0 2px 0',
  textAlign: 'right' as const,
};

const itemSubRight: React.CSSProperties = {
  fontSize: '12px',
  color: '#9ca3af',
  margin: '0',
  textAlign: 'right' as const,
};

const summaryLabel: React.CSSProperties = {
  fontSize: '14px',
  color: '#374151',
  margin: '0',
  padding: '10px 0',
};

const summaryValue: React.CSSProperties = {
  fontSize: '14px',
  color: '#374151',
  margin: '0',
  padding: '10px 0',
  textAlign: 'right' as const,
};

const totalLabel: React.CSSProperties = {
  fontSize: '15px',
  fontWeight: '700',
  color: '#111827',
  margin: '0',
  padding: '12px 0',
};

const totalValue: React.CSSProperties = {
  fontSize: '15px',
  fontWeight: '700',
  color: '#111827',
  margin: '0',
  padding: '12px 0',
  textAlign: 'right' as const,
};

const discountLabel: React.CSSProperties = {
  fontSize: '13px',
  color: '#9ca3af',
  margin: '0',
  padding: '10px 0',
};

const discountValue: React.CSSProperties = {
  fontSize: '13px',
  color: '#9ca3af',
  margin: '0',
  padding: '10px 0',
  textAlign: 'right' as const,
};

/* footer */
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

/* ── component ──────────────────────────────────────────────────────────────── */

export const ComprobanteEmail: React.FC<ComprobanteEmailProps> = ({
  empresaNombre,
  empresaRuc,
  empresaDireccion,
  empresaEmail,
  tipoPretty,
  serie,
  correlativo,
  fecha,
  clienteNombre,
  monto,
  monedaSimbolo = 'S/',
  pdfUrl,
  productos = [],
  formaPago,
  mtoOperGravadas,
  mtoIGV,
  descuento,
  sistemaUrl = 'https://falconext.pe',
  sistemaNombre = 'Falconext',
}) => {
  const docNumber = `${serie}-${correlativo}`;
  const previewText = `${tipoPretty} ${docNumber} — ${monto} | ${empresaNombre}`;

  return (
    <Html lang="es">
      <Head />
      <Preview>{previewText}</Preview>
      <Body style={main}>
        <Container style={outer}>

          {/* ── Brand bar ───────────────────────────────────────────── */}
          <div style={brandRow}>
            <p style={brandName}>{empresaNombre}</p>
          </div>

          {/* ── Card 1: Summary ─────────────────────────────────────── */}
          <div style={card}>
            <div style={cardPad}>
              <p style={receiptFrom}>{tipoPretty} de {empresaNombre}</p>
              <p style={amountText}>{monto}</p>
              <p style={dateText}>Emitido el {fecha}</p>

              <Hr style={divider} />

              {/* Download link */}
              {pdfUrl && (
                <div style={{ padding: '14px 0' }}>
                  <a href={pdfUrl} style={downloadLink} target="_blank" rel="noreferrer">
                    ↓ Descargar PDF
                  </a>
                </div>
              )}

              <Hr style={divider} />

              {/* Meta rows */}
              <table width="100%" cellPadding={0} cellSpacing={0} style={{ borderCollapse: 'collapse' }}>
                <tbody>
                  <tr>
                    <td style={metaLabel}>N° de comprobante</td>
                    <td style={metaValue}>{docNumber}</td>
                  </tr>
                  <tr style={{ borderTop: '1px solid #f3f4f6' }}>
                    <td style={metaLabel}>Cliente</td>
                    <td style={metaValue}>{clienteNombre}</td>
                  </tr>
                  {formaPago && (
                    <tr style={{ borderTop: '1px solid #f3f4f6' }}>
                      <td style={metaLabel}>Condición de pago</td>
                      <td style={metaValue}>{formaPago}</td>
                    </tr>
                  )}
                  <tr style={{ borderTop: '1px solid #f3f4f6' }}>
                    <td style={metaLabel}>RUC emisor</td>
                    <td style={metaValue}>{empresaRuc}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Card 2: Line items + totals ─────────────────────────── */}
          {productos.length > 0 && (
            <div style={card}>
              <div style={cardPad}>
                <p style={detailTitle}>Detalle — {docNumber}</p>
                <p style={detailDate}>{fecha}</p>

                {/* Items */}
                {productos.map((p, i) => (
                  <div key={i}>
                    {i > 0 && <Hr style={{ ...divider, margin: '0' }} />}
                    <table width="100%" cellPadding={0} cellSpacing={0} style={{ borderCollapse: 'collapse' }}>
                      <tbody>
                        <tr>
                          <td style={{ padding: '12px 0 2px 0', verticalAlign: 'top', width: '60%' }}>
                            <p style={itemName}>{p.descripcion}</p>
                            <p style={itemSub}>Cant: {Number(p.cantidad).toFixed(3)}{p.unidad ? ` ${p.unidad}` : ''}</p>
                          </td>
                          <td style={{ padding: '12px 0 2px 0', verticalAlign: 'top', width: '40%' }}>
                            <p style={itemTotal}>{monedaSimbolo} {p.total}</p>
                            <p style={itemSubRight}>{monedaSimbolo} {p.precioUnitario} c/u</p>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                ))}

                <Hr style={{ ...divider, margin: '8px 0 0 0' }} />

                {/* Totals summary */}
                <table width="100%" cellPadding={0} cellSpacing={0} style={{ borderCollapse: 'collapse' }}>
                  <tbody>
                    {mtoOperGravadas && (
                      <tr style={{ borderBottom: '1px solid #f3f4f6' }}>
                        <td style={summaryLabel}>Op. Gravadas</td>
                        <td style={summaryValue}>{monedaSimbolo} {mtoOperGravadas}</td>
                      </tr>
                    )}
                    {descuento && parseFloat(descuento) > 0 && (
                      <tr style={{ borderBottom: '1px solid #f3f4f6' }}>
                        <td style={discountLabel}>Descuento</td>
                        <td style={discountValue}>-{monedaSimbolo} {descuento}</td>
                      </tr>
                    )}
                    {mtoIGV && (
                      <tr style={{ borderBottom: '1px solid #f3f4f6' }}>
                        <td style={summaryLabel}>IGV 18%</td>
                        <td style={summaryValue}>{monedaSimbolo} {mtoIGV}</td>
                      </tr>
                    )}
                  </tbody>
                </table>

                <Hr style={divider} />

                <table width="100%" cellPadding={0} cellSpacing={0} style={{ borderCollapse: 'collapse' }}>
                  <tbody>
                    <tr>
                      <td style={totalLabel}>Total</td>
                      <td style={totalValue}>{monto}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Footer ──────────────────────────────────────────────── */}
          <Section>
            <Hr style={{ ...divider, borderColor: '#333', margin: '8px 0 16px' }} />
            <Text style={footerText}>
              ¿Tienes alguna pregunta?{empresaEmail ? <> Contáctanos en <a href={`mailto:${empresaEmail}`} style={footerLink}>{empresaEmail}</a>.</> : ' Comunícate directamente con el negocio.'}
            </Text>
            <Text style={{ ...footerText, marginTop: '4px' }}>
              Comprobante emitido a través de{' '}
              <a href={sistemaUrl} style={footerLink}>{sistemaNombre}</a>
            </Text>
          </Section>

        </Container>
      </Body>
    </Html>
  );
};

export default ComprobanteEmail;
