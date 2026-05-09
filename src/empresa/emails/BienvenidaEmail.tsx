import * as React from 'react';
import {
  Body, Button, Column, Container, Head, Hr, Html,
  Preview, Row, Section, Text,
} from '@react-email/components';

export interface BienvenidaEmailProps {
  empresaNombre: string;
  adminNombre: string;
  planNombre?: string;
  appName: string;
  mensajeExtra?: string;
}

const main: React.CSSProperties = {
  backgroundColor: '#f0fdf4',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
};

const container: React.CSSProperties = {
  margin: '0 auto',
  padding: '40px 20px',
  maxWidth: '600px',
};

const card: React.CSSProperties = {
  backgroundColor: '#ffffff',
  borderRadius: '20px',
  overflow: 'hidden',
  boxShadow: '0 4px 24px rgba(16,185,129,0.10)',
};

const header: React.CSSProperties = {
  background: 'linear-gradient(135deg, #059669 0%, #10b981 50%, #34d399 100%)',
  padding: '44px 40px 40px',
  textAlign: 'center' as const,
};

const emojiStyle: React.CSSProperties = {
  fontSize: '48px',
  lineHeight: '1',
  margin: '0 0 16px 0',
  display: 'block',
};

const headerTitle: React.CSSProperties = {
  color: '#ffffff',
  fontSize: '26px',
  fontWeight: '800',
  margin: '0 0 8px 0',
  letterSpacing: '-0.5px',
};

const headerSubtitle: React.CSSProperties = {
  color: 'rgba(255,255,255,0.85)',
  fontSize: '14px',
  margin: '0',
  fontWeight: '500',
};

const body: React.CSSProperties = {
  padding: '36px 40px',
};

const greeting: React.CSSProperties = {
  fontSize: '16px',
  color: '#111827',
  margin: '0 0 20px 0',
  lineHeight: '1.7',
};

const featureGrid: React.CSSProperties = {
  backgroundColor: '#f0fdf4',
  borderRadius: '14px',
  padding: '24px',
  marginBottom: '28px',
  border: '1px solid #bbf7d0',
};

const featureItem: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  marginBottom: '14px',
};

const featureIcon: React.CSSProperties = {
  width: '32px',
  height: '32px',
  borderRadius: '8px',
  backgroundColor: '#d1fae5',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '16px',
  marginRight: '12px',
  flexShrink: 0,
  lineHeight: '32px',
  textAlign: 'center' as const,
};

const featureText: React.CSSProperties = {
  fontSize: '14px',
  color: '#374151',
  margin: '0',
  lineHeight: '1.5',
  paddingTop: '6px',
};

const planBadge: React.CSSProperties = {
  display: 'inline-block',
  backgroundColor: '#ecfdf5',
  border: '1.5px solid #6ee7b7',
  color: '#059669',
  fontSize: '13px',
  fontWeight: '700',
  padding: '6px 16px',
  borderRadius: '99px',
  marginBottom: '28px',
};

const ctaButton: React.CSSProperties = {
  backgroundColor: '#059669',
  borderRadius: '12px',
  color: '#ffffff',
  display: 'block',
  fontSize: '15px',
  fontWeight: '700',
  textAlign: 'center' as const,
  padding: '15px 32px',
  textDecoration: 'none',
  margin: '0 0 28px 0',
};

const extraBox: React.CSSProperties = {
  backgroundColor: '#f8fafc',
  borderLeft: '4px solid #10b981',
  borderRadius: '0 10px 10px 0',
  padding: '14px 18px',
  marginBottom: '28px',
};

const extraText: React.CSSProperties = {
  fontSize: '14px',
  color: '#374151',
  margin: '0',
  lineHeight: '1.7',
};

const hr: React.CSSProperties = {
  border: 'none',
  borderTop: '1px solid #e5e7eb',
  margin: '0 0 20px 0',
};

const footer: React.CSSProperties = {
  fontSize: '12px',
  color: '#9ca3af',
  textAlign: 'center' as const,
  lineHeight: '1.6',
  margin: '0',
};

const footerBrand: React.CSSProperties = {
  fontSize: '13px',
  fontWeight: '700',
  color: '#059669',
  textAlign: 'center' as const,
  margin: '0 0 4px 0',
};

export const BienvenidaEmail: React.FC<BienvenidaEmailProps> = ({
  empresaNombre,
  adminNombre,
  planNombre,
  appName,
  mensajeExtra,
}) => (
  <Html lang="es">
    <Head />
    <Preview>¡Bienvenido/a a {appName}! Tu cuenta de {empresaNombre} ya está lista.</Preview>
    <Body style={main}>
      <Container style={container}>
        <div style={card}>
          {/* Header */}
          <div style={header}>
            <p style={emojiStyle}>🎉</p>
            <p style={headerTitle}>¡Bienvenido/a a {appName}!</p>
            <p style={headerSubtitle}>{empresaNombre} · Tu cuenta está activa</p>
          </div>

          {/* Body */}
          <div style={body}>
            <Text style={greeting}>
              Hola, <strong>{adminNombre}</strong>. Estamos muy contentos de tenerte con nosotros.
              Tu cuenta de <strong>{empresaNombre}</strong> ha sido activada exitosamente y ya puedes
              empezar a usar todas las funcionalidades del sistema.
            </Text>

            {planNombre && (
              <div style={{ textAlign: 'center' as const, marginBottom: '24px' }}>
                <span style={planBadge}>Plan activo: {planNombre}</span>
              </div>
            )}

            {/* Features */}
            <div style={featureGrid}>
              <Section>
                <Row style={featureItem}>
                  <Column style={{ width: '44px' }}>
                    <div style={featureIcon}>🧾</div>
                  </Column>
                  <Column>
                    <p style={featureText}><strong>Facturación electrónica</strong> — Emite comprobantes con validez ante SUNAT de forma rápida y sencilla.</p>
                  </Column>
                </Row>
                <Row style={featureItem}>
                  <Column style={{ width: '44px' }}>
                    <div style={featureIcon}>📦</div>
                  </Column>
                  <Column>
                    <p style={featureText}><strong>Inventario y productos</strong> — Controla tu stock en tiempo real desde cualquier dispositivo.</p>
                  </Column>
                </Row>
                <Row style={{ ...featureItem, marginBottom: '0' }}>
                  <Column style={{ width: '44px' }}>
                    <div style={featureIcon}>📊</div>
                  </Column>
                  <Column>
                    <p style={featureText}><strong>Reportes y finanzas</strong> — Visualiza tus ventas, gastos y rentabilidad en tiempo real.</p>
                  </Column>
                </Row>
              </Section>
            </div>

            {mensajeExtra && (
              <div style={extraBox}>
                <p style={extraText}>{mensajeExtra}</p>
              </div>
            )}

            <Hr style={hr} />

            {/* Footer */}
            <p style={footerBrand}>{appName}</p>
            <Text style={footer}>
              Este correo fue enviado a la cuenta de administrador de <strong>{empresaNombre}</strong>.
              Si tienes alguna pregunta, nuestro equipo está disponible para ayudarte.
            </Text>
          </div>
        </div>
      </Container>
    </Body>
  </Html>
);

export default BienvenidaEmail;
