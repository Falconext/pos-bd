import * as React from 'react';
import {
  Body,
  Button,
  Container,
  Column,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Preview,
  Row,
  Section,
  Text,
} from '@react-email/components';

export interface ComprobanteEmailProps {
  empresaNombre: string;
  empresaRuc: string;
  empresaDireccion?: string;
  tipoPretty: string;
  serie: string;
  correlativo: string;
  fecha: string;
  clienteNombre: string;
  monto: string;
  pdfUrl?: string;
  productos?: Array<{ descripcion: string; cantidad: number; precioUnitario: string; total: string }>;
  formaPago?: string;
  medioPago?: string;
}

const main: React.CSSProperties = {
  backgroundColor: '#f8fafc',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
};

const container: React.CSSProperties = {
  margin: '0 auto',
  padding: '40px 20px',
  maxWidth: '600px',
};

const card: React.CSSProperties = {
  backgroundColor: '#ffffff',
  borderRadius: '16px',
  overflow: 'hidden',
  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
};

const header: React.CSSProperties = {
  backgroundColor: '#7c3aed',
  padding: '32px 40px',
};

const headerTitle: React.CSSProperties = {
  color: '#ffffff',
  fontSize: '22px',
  fontWeight: '700',
  margin: '0 0 4px 0',
};

const headerSubtitle: React.CSSProperties = {
  color: 'rgba(255,255,255,0.75)',
  fontSize: '13px',
  margin: '0',
};

const badge: React.CSSProperties = {
  display: 'inline-block',
  backgroundColor: 'rgba(255,255,255,0.2)',
  color: '#ffffff',
  fontSize: '11px',
  fontWeight: '700',
  padding: '4px 12px',
  borderRadius: '99px',
  marginBottom: '12px',
  letterSpacing: '0.05em',
  textTransform: 'uppercase' as const,
};

const body: React.CSSProperties = {
  padding: '32px 40px',
};

const greeting: React.CSSProperties = {
  fontSize: '15px',
  color: '#374151',
  margin: '0 0 24px 0',
  lineHeight: '1.6',
};

const infoBox: React.CSSProperties = {
  backgroundColor: '#f8fafc',
  borderRadius: '12px',
  padding: '20px 24px',
  marginBottom: '24px',
  border: '1px solid #e5e7eb',
};

const infoLabel: React.CSSProperties = {
  fontSize: '11px',
  color: '#9ca3af',
  fontWeight: '700',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.06em',
  margin: '0 0 4px 0',
};

const infoValue: React.CSSProperties = {
  fontSize: '14px',
  color: '#111827',
  fontWeight: '600',
  margin: '0 0 16px 0',
};

const totalBox: React.CSSProperties = {
  backgroundColor: '#7c3aed',
  borderRadius: '12px',
  padding: '20px 24px',
  marginBottom: '28px',
  textAlign: 'center' as const,
};

const totalLabel: React.CSSProperties = {
  fontSize: '12px',
  color: 'rgba(255,255,255,0.75)',
  fontWeight: '600',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.06em',
  margin: '0 0 6px 0',
};

const totalAmount: React.CSSProperties = {
  fontSize: '32px',
  color: '#ffffff',
  fontWeight: '800',
  margin: '0',
  letterSpacing: '-0.5px',
};

const tableHeader: React.CSSProperties = {
  fontSize: '11px',
  color: '#9ca3af',
  fontWeight: '700',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.06em',
  padding: '0 0 8px 0',
  borderBottom: '1.5px solid #e5e7eb',
};

const tableRow: React.CSSProperties = {
  borderBottom: '1px solid #f3f4f6',
};

const tableCell: React.CSSProperties = {
  fontSize: '13px',
  color: '#374151',
  padding: '10px 0',
  verticalAlign: 'top' as const,
};

const button: React.CSSProperties = {
  backgroundColor: '#7c3aed',
  borderRadius: '10px',
  color: '#ffffff',
  display: 'block',
  fontSize: '15px',
  fontWeight: '700',
  textAlign: 'center' as const,
  padding: '14px 28px',
  textDecoration: 'none',
  margin: '0 0 24px 0',
};

const hr: React.CSSProperties = {
  border: 'none',
  borderTop: '1px solid #e5e7eb',
  margin: '24px 0',
};

const footer: React.CSSProperties = {
  fontSize: '12px',
  color: '#9ca3af',
  textAlign: 'center' as const,
  lineHeight: '1.6',
};

const footerBrand: React.CSSProperties = {
  fontSize: '13px',
  fontWeight: '700',
  color: '#7c3aed',
  textAlign: 'center' as const,
  margin: '16px 0 4px 0',
};

export const ComprobanteEmail: React.FC<ComprobanteEmailProps> = ({
  empresaNombre,
  empresaRuc,
  empresaDireccion,
  tipoPretty,
  serie,
  correlativo,
  fecha,
  clienteNombre,
  monto,
  pdfUrl,
  productos = [],
  formaPago,
  medioPago,
}) => {
  const previewText = `${tipoPretty} ${serie}-${correlativo} — ${monto} | ${empresaNombre}`;

  return (
    <Html lang="es">
      <Head />
      <Preview>{previewText}</Preview>
      <Body style={main}>
        <Container style={container}>
          <div style={card}>
            {/* ── Header ─────────────────────────────────── */}
            <div style={header}>
              <p style={badge}>{tipoPretty}</p>
              <p style={headerTitle}>{empresaNombre}</p>
              <p style={headerSubtitle}>RUC: {empresaRuc}{empresaDireccion ? ` · ${empresaDireccion}` : ''}</p>
            </div>

            {/* ── Body ───────────────────────────────────── */}
            <div style={body}>
              <Text style={greeting}>
                Hola <strong>{clienteNombre}</strong>, adjunto encontrarás tu comprobante de pago.
                Puedes descargarlo desde el botón de abajo o revisarlo directamente en este correo.
              </Text>

              {/* Info del comprobante */}
              <div style={infoBox}>
                <Row>
                  <Column style={{ width: '50%', paddingRight: '12px' }}>
                    <p style={infoLabel}>Comprobante</p>
                    <p style={infoValue}>{serie}-{correlativo}</p>
                    <p style={infoLabel}>Fecha de emisión</p>
                    <p style={{ ...infoValue, marginBottom: 0 }}>{fecha}</p>
                  </Column>
                  <Column style={{ width: '50%', paddingLeft: '12px' }}>
                    {formaPago && (
                      <>
                        <p style={infoLabel}>Forma de pago</p>
                        <p style={infoValue}>{formaPago}</p>
                      </>
                    )}
                    {medioPago && (
                      <>
                        <p style={infoLabel}>Medio de pago</p>
                        <p style={{ ...infoValue, marginBottom: 0 }}>{medioPago}</p>
                      </>
                    )}
                  </Column>
                </Row>
              </div>

              {/* Monto total */}
              <div style={totalBox}>
                <p style={totalLabel}>Total a pagar</p>
                <p style={totalAmount}>{monto}</p>
              </div>

              {/* Detalle de productos */}
              {productos.length > 0 && (
                <Section style={{ marginBottom: '24px' }}>
                  <Heading as="h3" style={{ fontSize: '13px', fontWeight: '700', color: '#374151', margin: '0 0 12px 0' }}>
                    Detalle del comprobante
                  </Heading>
                  <Row>
                    <Column style={{ ...tableHeader, width: '45%' }}>Descripción</Column>
                    <Column style={{ ...tableHeader, width: '15%', textAlign: 'center' as const }}>Cant.</Column>
                    <Column style={{ ...tableHeader, width: '20%', textAlign: 'right' as const }}>P. Unit.</Column>
                    <Column style={{ ...tableHeader, width: '20%', textAlign: 'right' as const }}>Total</Column>
                  </Row>
                  {productos.map((p, i) => (
                    <Row key={i} style={tableRow}>
                      <Column style={{ ...tableCell, width: '45%' }}>{p.descripcion}</Column>
                      <Column style={{ ...tableCell, width: '15%', textAlign: 'center' as const }}>{p.cantidad}</Column>
                      <Column style={{ ...tableCell, width: '20%', textAlign: 'right' as const }}>S/ {p.precioUnitario}</Column>
                      <Column style={{ ...tableCell, width: '20%', textAlign: 'right' as const, fontWeight: '600' as const }}>S/ {p.total}</Column>
                    </Row>
                  ))}
                </Section>
              )}

              <Hr style={hr} />

              {/* Footer */}
              <Text style={footer}>
                Este correo fue enviado por <strong>{empresaNombre}</strong> a través de Falconext MyPE.
                Si tienes alguna pregunta, comunícate directamente con el negocio.
              </Text>
              <p style={footerBrand}>Falconext MyPE</p>
              <Text style={footer}>La plataforma de gestión para tu negocio</Text>
            </div>
          </div>
        </Container>
      </Body>
    </Html>
  );
};

export default ComprobanteEmail;
