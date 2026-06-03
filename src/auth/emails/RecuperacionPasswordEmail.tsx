import * as React from 'react';
import {
  Body, Button, Container, Head, Hr, Html, Preview, Text,
} from '@react-email/components';

export interface RecuperacionPasswordEmailProps {
  nombre: string;
  resetUrl: string;
  appName: string;
  expiresInMinutes?: number;
  primaryColor?: string;
}

const DEFAULT_COLOR = '#3E2BC7';

const main: React.CSSProperties = {
  backgroundColor: '#F8F9FF',
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
  boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
};

const emojiStyle: React.CSSProperties = {
  fontSize: '48px',
  lineHeight: '1',
  margin: '0 0 16px 0',
  display: 'block',
};

const headerTitle: React.CSSProperties = {
  color: '#ffffff',
  fontSize: '24px',
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
  fontSize: '15px',
  color: '#111827',
  margin: '0 0 20px 0',
  lineHeight: '1.7',
};

const infoText: React.CSSProperties = {
  fontSize: '13px',
  color: '#4B5563',
  margin: '0',
  lineHeight: '1.7',
};

const linkNote: React.CSSProperties = {
  fontSize: '12px',
  color: '#9CA3AF',
  margin: '0 0 28px 0',
  wordBreak: 'break-all' as const,
  lineHeight: '1.5',
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

export const RecuperacionPasswordEmail: React.FC<RecuperacionPasswordEmailProps> = ({
  nombre,
  resetUrl,
  appName,
  expiresInMinutes = 15,
  primaryColor = DEFAULT_COLOR,
}) => {
  const header: React.CSSProperties = {
    background: `linear-gradient(135deg, ${primaryColor} 0%, ${primaryColor}CC 100%)`,
    padding: '44px 40px 40px',
    textAlign: 'center' as const,
  };

  const infoBox: React.CSSProperties = {
    backgroundColor: `${primaryColor}0F`,
    borderLeft: `4px solid ${primaryColor}`,
    borderRadius: '0 10px 10px 0',
    padding: '14px 18px',
    marginBottom: '28px',
  };

  const ctaButton: React.CSSProperties = {
    backgroundColor: primaryColor,
    borderRadius: '12px',
    color: '#ffffff',
    display: 'block',
    fontSize: '15px',
    fontWeight: '700',
    textAlign: 'center' as const,
    padding: '15px 32px',
    textDecoration: 'none',
    margin: '0 0 20px 0',
  };

  const footerBrand: React.CSSProperties = {
    fontSize: '13px',
    fontWeight: '700',
    color: primaryColor,
    textAlign: 'center' as const,
    margin: '0 0 4px 0',
  };

  return (
    <Html lang="es">
      <Head />
      <Preview>Solicitud de cambio de contraseña para tu cuenta en {appName}</Preview>
      <Body style={main}>
        <Container style={container}>
          <div style={card}>
            {/* Header */}
            <div style={header}>
              <p style={emojiStyle}>🔐</p>
              <p style={headerTitle}>Recupera tu contraseña</p>
              <p style={headerSubtitle}>{appName} · Seguridad de cuenta</p>
            </div>

            {/* Body */}
            <div style={body}>
              <Text style={greeting}>
                Hola, <strong>{nombre}</strong>. Recibimos una solicitud para restablecer la contraseña
                de tu cuenta. Si no fuiste tú, puedes ignorar este correo.
              </Text>

              <div style={infoBox}>
                <p style={infoText}>
                  ⏱️ Este enlace es válido por <strong>{expiresInMinutes} minutos</strong> y solo puede
                  ser usado una vez.
                </p>
              </div>

              <Button href={resetUrl} style={ctaButton}>
                Cambiar mi contraseña
              </Button>

              <p style={linkNote}>
                Si el botón no funciona, copia y pega este enlace en tu navegador:{' '}
                <a href={resetUrl} style={{ color: primaryColor }}>{resetUrl}</a>
              </p>

              <Hr style={hr} />

              <p style={footerBrand}>{appName}</p>
              <Text style={footer}>
                Si no solicitaste este cambio, tu contraseña permanece segura. Puedes ignorar este mensaje.
              </Text>
            </div>
          </div>
        </Container>
      </Body>
    </Html>
  );
};

export default RecuperacionPasswordEmail;
