import * as React from 'react';
import {
  Body, Column, Container, Head, Hr, Html,
  Preview, Row, Section, Text,
} from '@react-email/components';

export interface PromocionEmailProps {
  empresaNombre: string;
  adminNombre: string;
  tituloPromo: string;
  mensajePromo: string;
  appName: string;
  etiqueta?: string;
}

const main: React.CSSProperties = {
  backgroundColor: '#fdf4ff',
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
  boxShadow: '0 4px 24px rgba(236,72,153,0.10)',
};

const header: React.CSSProperties = {
  background: 'linear-gradient(135deg, #be185d 0%, #ec4899 50%, #f472b6 100%)',
  padding: '44px 40px 40px',
  textAlign: 'center' as const,
};

const emojiStyle: React.CSSProperties = {
  fontSize: '48px',
  lineHeight: '1',
  margin: '0 0 16px 0',
  display: 'block',
};

const etiquetaStyle: React.CSSProperties = {
  display: 'inline-block',
  backgroundColor: 'rgba(255,255,255,0.25)',
  color: '#ffffff',
  fontSize: '11px',
  fontWeight: '700',
  padding: '4px 14px',
  borderRadius: '99px',
  marginBottom: '12px',
  letterSpacing: '0.1em',
  textTransform: 'uppercase' as const,
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

const promoBox: React.CSSProperties = {
  background: 'linear-gradient(135deg, #fdf4ff, #fce7f3)',
  border: '2px solid #fbcfe8',
  borderRadius: '16px',
  padding: '28px 32px',
  marginBottom: '28px',
};

const promoTitle: React.CSSProperties = {
  fontSize: '20px',
  fontWeight: '800',
  color: '#831843',
  margin: '0 0 12px 0',
  letterSpacing: '-0.3px',
};

const promoText: React.CSSProperties = {
  fontSize: '15px',
  color: '#4a044e',
  margin: '0',
  lineHeight: '1.8',
};

const decorRow: React.CSSProperties = {
  marginBottom: '28px',
};

const decorCard: React.CSSProperties = {
  backgroundColor: '#fdf4ff',
  borderRadius: '12px',
  padding: '16px 12px',
  textAlign: 'center' as const,
  border: '1px solid #f9a8d4',
};

const decorEmoji: React.CSSProperties = {
  fontSize: '28px',
  display: 'block',
  margin: '0 0 6px 0',
};

const decorText: React.CSSProperties = {
  fontSize: '12px',
  color: '#9d174d',
  fontWeight: '600',
  margin: '0',
  lineHeight: '1.4',
};

const closingBox: React.CSSProperties = {
  backgroundColor: '#f9fafb',
  borderRadius: '12px',
  padding: '18px 22px',
  marginBottom: '28px',
  textAlign: 'center' as const,
  border: '1px solid #e5e7eb',
};

const closingText: React.CSSProperties = {
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
  color: '#ec4899',
  textAlign: 'center' as const,
  margin: '0 0 4px 0',
};

export const PromocionEmail: React.FC<PromocionEmailProps> = ({
  empresaNombre,
  adminNombre,
  tituloPromo,
  mensajePromo,
  appName,
  etiqueta = 'Oferta especial',
}) => (
  <Html lang="es">
    <Head />
    <Preview>🎁 {tituloPromo} — Exclusivo para {empresaNombre}</Preview>
    <Body style={main}>
      <Container style={container}>
        <div style={card}>
          {/* Header */}
          <div style={header}>
            <p style={emojiStyle}>🎁</p>
            <span style={etiquetaStyle}>{etiqueta}</span>
            <p style={headerTitle}>¡Tenemos algo especial para ti!</p>
            <p style={headerSubtitle}>Exclusivo para {empresaNombre}</p>
          </div>

          {/* Body */}
          <div style={body}>
            <Text style={greeting}>
              Hola, <strong>{adminNombre}</strong>. Como parte de nuestra comunidad de clientes
              especiales, queremos compartirte una novedad pensada especialmente para{' '}
              <strong>{empresaNombre}</strong>.
            </Text>

            {/* Promo content */}
            <div style={promoBox}>
              <p style={promoTitle}>{tituloPromo}</p>
              <p style={promoText}>{mensajePromo}</p>
            </div>

            {/* Decorative features */}
            <Section style={decorRow}>
              <Row>
                <Column style={{ width: '33%', paddingRight: '8px' }}>
                  <div style={decorCard}>
                    <p style={decorEmoji}>⚡</p>
                    <p style={decorText}>Disponible por tiempo limitado</p>
                  </div>
                </Column>
                <Column style={{ width: '34%', paddingLeft: '4px', paddingRight: '4px' }}>
                  <div style={decorCard}>
                    <p style={decorEmoji}>🎯</p>
                    <p style={decorText}>Exclusivo para clientes activos</p>
                  </div>
                </Column>
                <Column style={{ width: '33%', paddingLeft: '8px' }}>
                  <div style={decorCard}>
                    <p style={decorEmoji}>🤝</p>
                    <p style={decorText}>Sin costos ocultos</p>
                  </div>
                </Column>
              </Row>
            </Section>

            {/* Closing */}
            <div style={closingBox}>
              <p style={closingText}>
                Para más información o para aprovechar esta oferta, comunícate con nuestro equipo.
                Estamos disponibles para atenderte y resolver todas tus consultas. 💬
              </p>
            </div>

            <Hr style={hr} />

            <p style={footerBrand}>{appName}</p>
            <Text style={footer}>
              Este mensaje fue enviado al administrador de <strong>{empresaNombre}</strong>.
              Si no deseas recibir este tipo de comunicaciones, contáctanos.
            </Text>
          </div>
        </div>
      </Container>
    </Body>
  </Html>
);

export default PromocionEmail;
