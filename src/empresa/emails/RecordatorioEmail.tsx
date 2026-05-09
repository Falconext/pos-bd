import * as React from 'react';
import {
  Body, Column, Container, Head, Hr, Html,
  Preview, Row, Section, Text,
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
  backgroundColor: '#fffbeb',
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
  boxShadow: '0 4px 24px rgba(245,158,11,0.12)',
};

const header: React.CSSProperties = {
  background: 'linear-gradient(135deg, #d97706 0%, #f59e0b 50%, #fbbf24 100%)',
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
  color: 'rgba(255,255,255,0.90)',
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

const countdownBox: React.CSSProperties = {
  background: 'linear-gradient(135deg, #fffbeb, #fef3c7)',
  border: '2px solid #fde68a',
  borderRadius: '16px',
  padding: '28px',
  marginBottom: '28px',
  textAlign: 'center' as const,
};

const countdownNumber: React.CSSProperties = {
  fontSize: '64px',
  fontWeight: '900',
  color: '#d97706',
  margin: '0',
  lineHeight: '1',
  letterSpacing: '-2px',
};

const countdownLabel: React.CSSProperties = {
  fontSize: '14px',
  color: '#92400e',
  fontWeight: '600',
  margin: '8px 0 0 0',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.1em',
};

const dateBox: React.CSSProperties = {
  backgroundColor: '#fff7ed',
  border: '1px solid #fed7aa',
  borderRadius: '10px',
  padding: '14px 20px',
  marginBottom: '24px',
  textAlign: 'center' as const,
};

const dateLabel: React.CSSProperties = {
  fontSize: '11px',
  color: '#c2410c',
  fontWeight: '700',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.08em',
  margin: '0 0 4px 0',
};

const dateValue: React.CSSProperties = {
  fontSize: '18px',
  color: '#7c2d12',
  fontWeight: '800',
  margin: '0',
};

const stepsBox: React.CSSProperties = {
  backgroundColor: '#f9fafb',
  borderRadius: '14px',
  padding: '20px 24px',
  marginBottom: '28px',
  border: '1px solid #e5e7eb',
};

const stepItem: React.CSSProperties = {
  marginBottom: '12px',
};

const stepText: React.CSSProperties = {
  fontSize: '14px',
  color: '#374151',
  margin: '0',
  lineHeight: '1.5',
};

const warningBox: React.CSSProperties = {
  backgroundColor: '#fef2f2',
  border: '1px solid #fecaca',
  borderRadius: '10px',
  padding: '14px 18px',
  marginBottom: '28px',
};

const warningText: React.CSSProperties = {
  fontSize: '13px',
  color: '#b91c1c',
  margin: '0',
  lineHeight: '1.6',
};

const extraBox: React.CSSProperties = {
  backgroundColor: '#fffbeb',
  borderLeft: '4px solid #f59e0b',
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
  color: '#d97706',
  textAlign: 'center' as const,
  margin: '0 0 4px 0',
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
  const urgente = diasRestantes <= 3;

  return (
    <Html lang="es">
      <Head />
      <Preview>{`⏰ Tu suscripción de ${empresaNombre} vence en ${diasRestantes} día${diasRestantes !== 1 ? 's' : ''}. ¡Renueva ahora!`}</Preview>
      <Body style={main}>
        <Container style={container}>
          <div style={card}>
            {/* Header */}
            <div style={header}>
              <p style={emojiStyle}>{urgente ? '🚨' : '⏰'}</p>
              <p style={headerTitle}>{urgente ? '¡Vence muy pronto!' : 'Tu suscripción vence pronto'}</p>
              <p style={headerSubtitle}>{empresaNombre} · {planNombre || 'Suscripción activa'}</p>
            </div>

            {/* Body */}
            <div style={body}>
              <Text style={greeting}>
                Hola, <strong>{adminNombre}</strong>. Te escribimos para recordarte que la suscripción de{' '}
                <strong>{empresaNombre}</strong> está próxima a vencer. Te recomendamos renovar
                a la brevedad para evitar cualquier interrupción en tu servicio.
              </Text>

              {/* Countdown */}
              <div style={countdownBox}>
                <p style={countdownNumber}>{diasRestantes}</p>
                <p style={countdownLabel}>{diasRestantes === 1 ? 'día restante' : 'días restantes'}</p>
              </div>

              {/* Date */}
              <div style={dateBox}>
                <p style={dateLabel}>Fecha de vencimiento</p>
                <p style={dateValue}>{fechaExpiracion}</p>
              </div>

              {/* Steps */}
              <div style={stepsBox}>
                <Section>
                  <Text style={{ ...stepText, fontWeight: '700', marginBottom: '12px', color: '#111827' }}>
                    ¿Cómo renovar?
                  </Text>
                  <Row style={stepItem}>
                    <Column style={{ width: '28px' }}>
                      <span style={{ fontSize: '16px' }}>1️⃣</span>
                    </Column>
                    <Column>
                      <p style={stepText}>Comunícate con nuestro equipo de soporte.</p>
                    </Column>
                  </Row>
                  <Row style={stepItem}>
                    <Column style={{ width: '28px' }}>
                      <span style={{ fontSize: '16px' }}>2️⃣</span>
                    </Column>
                    <Column>
                      <p style={stepText}>Confirma el plan que deseas mantener o cambiar.</p>
                    </Column>
                  </Row>
                  <Row>
                    <Column style={{ width: '28px' }}>
                      <span style={{ fontSize: '16px' }}>3️⃣</span>
                    </Column>
                    <Column>
                      <p style={stepText}>Realiza el pago y tu cuenta se actualiza de inmediato.</p>
                    </Column>
                  </Row>
                </Section>
              </div>

              {urgente && (
                <div style={warningBox}>
                  <p style={warningText}>
                    ⚠️ <strong>Atención:</strong> Al vencer el plan, el acceso al sistema quedará
                    suspendido temporalmente hasta que se complete la renovación.
                  </p>
                </div>
              )}

              {mensajeExtra && (
                <div style={extraBox}>
                  <p style={extraText}>{mensajeExtra}</p>
                </div>
              )}

              <Hr style={hr} />

              <p style={footerBrand}>{appName}</p>
              <Text style={footer}>
                Este recordatorio fue enviado al administrador de <strong>{empresaNombre}</strong>.
                Si ya realizaste el pago, puedes ignorar este mensaje.
              </Text>
            </div>
          </div>
        </Container>
      </Body>
    </Html>
  );
};

export default RecordatorioEmail;
