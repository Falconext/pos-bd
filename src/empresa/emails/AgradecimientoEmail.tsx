import * as React from 'react';
import {
  Body, Column, Container, Head, Hr, Html,
  Preview, Row, Section, Text,
} from '@react-email/components';

export interface AgradecimientoEmailProps {
  empresaNombre: string;
  adminNombre: string;
  planNombre?: string;
  fechaExpiracion?: string;
  appName: string;
  mensajeExtra?: string;
}

const main: React.CSSProperties = {
  backgroundColor: '#faf5ff',
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
  boxShadow: '0 4px 24px rgba(99,102,241,0.10)',
};

const header: React.CSSProperties = {
  background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 50%, #9333ea 100%)',
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
};

const body: React.CSSProperties = {
  padding: '36px 40px',
};

const greeting: React.CSSProperties = {
  fontSize: '16px',
  color: '#111827',
  margin: '0 0 24px 0',
  lineHeight: '1.7',
};

const statGrid: React.CSSProperties = {
  marginBottom: '28px',
};

const statCard: React.CSSProperties = {
  backgroundColor: '#f5f3ff',
  borderRadius: '12px',
  padding: '18px 16px',
  textAlign: 'center' as const,
  border: '1px solid #ede9fe',
};

const statEmoji: React.CSSProperties = {
  fontSize: '24px',
  display: 'block',
  margin: '0 0 8px 0',
};

const statLabel: React.CSSProperties = {
  fontSize: '11px',
  color: '#7c3aed',
  fontWeight: '700',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.06em',
  margin: '0 0 4px 0',
};

const statValue: React.CSSProperties = {
  fontSize: '15px',
  color: '#1e1b4b',
  fontWeight: '700',
  margin: '0',
};

const highlightBox: React.CSSProperties = {
  background: 'linear-gradient(135deg, #f5f3ff, #ede9fe)',
  borderRadius: '14px',
  padding: '24px 28px',
  marginBottom: '28px',
  textAlign: 'center' as const,
  border: '1px solid #ddd6fe',
};

const highlightText: React.CSSProperties = {
  fontSize: '15px',
  color: '#4c1d95',
  margin: '0',
  lineHeight: '1.7',
};

const extraBox: React.CSSProperties = {
  backgroundColor: '#faf5ff',
  borderLeft: '4px solid #7c3aed',
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
  color: '#7c3aed',
  textAlign: 'center' as const,
  margin: '0 0 4px 0',
};

export const AgradecimientoEmail: React.FC<AgradecimientoEmailProps> = ({
  empresaNombre,
  adminNombre,
  planNombre,
  fechaExpiracion,
  appName,
  mensajeExtra,
}) => (
  <Html lang="es">
    <Head />
    <Preview>🙌 ¡Gracias por tu pago puntual, {empresaNombre}! Lo valoramos muchísimo.</Preview>
    <Body style={main}>
      <Container style={container}>
        <div style={card}>
          {/* Header */}
          <div style={header}>
            <p style={emojiStyle}>🙌</p>
            <p style={headerTitle}>¡Gracias por tu puntualidad!</p>
            <p style={headerSubtitle}>{empresaNombre} — Siempre al día</p>
          </div>

          {/* Body */}
          <div style={body}>
            <Text style={greeting}>
              Hola, <strong>{adminNombre}</strong>. Queremos tomarnos un momento para agradecerte
              por mantener tu suscripción al día. Tu puntualidad nos permite seguir mejorando y
              ofrecerte el mejor servicio posible.
            </Text>

            {/* Stats */}
            <div style={statGrid}>
              <Section>
                <Row>
                  <Column style={{ width: '33%', paddingRight: '8px' }}>
                    <div style={statCard}>
                      <p style={statEmoji}>✅</p>
                      <p style={statLabel}>Estado</p>
                      <p style={statValue}>Al día</p>
                    </div>
                  </Column>
                  <Column style={{ width: '34%', paddingLeft: '4px', paddingRight: '4px' }}>
                    <div style={statCard}>
                      <p style={statEmoji}>📋</p>
                      <p style={statLabel}>Plan</p>
                      <p style={statValue}>{planNombre || 'Activo'}</p>
                    </div>
                  </Column>
                  <Column style={{ width: '33%', paddingLeft: '8px' }}>
                    <div style={statCard}>
                      <p style={statEmoji}>📅</p>
                      <p style={statLabel}>Vence</p>
                      <p style={statValue}>{fechaExpiracion || '—'}</p>
                    </div>
                  </Column>
                </Row>
              </Section>
            </div>

            {/* Highlight */}
            <div style={highlightBox}>
              <Text style={highlightText}>
                💜 Clientes como tú son la razón por la que seguimos creciendo. Tu confianza
                es lo más valioso que tenemos. ¡Gracias por ser parte de <strong>{appName}</strong>!
              </Text>
            </div>

            {mensajeExtra && (
              <div style={extraBox}>
                <p style={extraText}>{mensajeExtra}</p>
              </div>
            )}

            <Hr style={hr} />

            <p style={footerBrand}>{appName}</p>
            <Text style={footer}>
              Este mensaje fue enviado al administrador de <strong>{empresaNombre}</strong>.
            </Text>
          </div>
        </div>
      </Container>
    </Body>
  </Html>
);

export default AgradecimientoEmail;
