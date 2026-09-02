import * as React from 'react';
import {
  Body,
  Button,
  Container,
  Head,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components';

export interface LeadCalienteEmailProps {
  nombreAdmin: string;
  nombreProspecto: string;
  telefonoProspecto: string;
  puntaje: number;
  presupuesto?: number | null;
  autoridad?: number | null;
  necesidad?: number | null;
  plazo?: number | null;
  resumen?: string | null;
  puntosClave?: string[];
  proximaAccion?: string | null;
  panelUrl: string;
  appName: string;
}

const main: React.CSSProperties = {
  backgroundColor: '#F8F9FF',
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
};
const container: React.CSSProperties = {
  margin: '0 auto',
  padding: '32px 20px',
  maxWidth: '600px',
};
const card: React.CSSProperties = {
  backgroundColor: '#ffffff',
  borderRadius: '20px',
  overflow: 'hidden',
  boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
};
const header: React.CSSProperties = {
  background: 'linear-gradient(135deg, #ef4444, #dc2626)',
  padding: '32px',
  textAlign: 'center',
};
const headerTitle: React.CSSProperties = {
  color: '#ffffff',
  fontSize: '24px',
  fontWeight: 800,
  margin: '0 0 6px 0',
  letterSpacing: '-0.5px',
};
const headerSub: React.CSSProperties = {
  color: 'rgba(255,255,255,0.9)',
  fontSize: '14px',
  margin: 0,
};
const scoreBadge: React.CSSProperties = {
  display: 'inline-block',
  backgroundColor: '#ffffff',
  color: '#ef4444',
  fontSize: '30px',
  fontWeight: 900,
  padding: '6px 22px',
  borderRadius: '50px',
  marginTop: '16px',
};
const body: React.CSSProperties = { padding: '28px 32px' };
const prospectBox: React.CSSProperties = {
  backgroundColor: '#fef2f2',
  borderLeft: '4px solid #ef4444',
  padding: '14px 16px',
  borderRadius: '0 8px 8px 0',
  margin: '0 0 20px 0',
};
const prospectName: React.CSSProperties = {
  margin: '0 0 2px 0',
  color: '#1f2937',
  fontSize: '18px',
  fontWeight: 700,
};
const prospectPhone: React.CSSProperties = {
  margin: 0,
  color: '#6b7280',
  fontSize: '14px',
};
const sectionLabel: React.CSSProperties = {
  margin: '0 0 6px 0',
  color: '#374151',
  fontSize: '12px',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};
const sectionText: React.CSSProperties = {
  margin: '0 0 20px 0',
  color: '#4b5563',
  fontSize: '14px',
  lineHeight: '1.6',
};
const bantRow: React.CSSProperties = {
  color: '#4b5563',
  fontSize: '14px',
  margin: '0 0 4px 0',
};
const ctaWrap: React.CSSProperties = { textAlign: 'center', padding: '8px 0 4px' };
const ctaBtn: React.CSSProperties = {
  backgroundColor: '#7c3aed',
  color: '#ffffff',
  padding: '13px 30px',
  borderRadius: '10px',
  textDecoration: 'none',
  fontWeight: 600,
  fontSize: '15px',
};
const footer: React.CSSProperties = {
  padding: '16px 32px',
  textAlign: 'center',
  color: '#9ca3af',
  fontSize: '12px',
};

export function LeadCalienteEmail(props: LeadCalienteEmailProps) {
  const {
    nombreAdmin,
    nombreProspecto,
    telefonoProspecto,
    puntaje,
    presupuesto,
    autoridad,
    necesidad,
    plazo,
    resumen,
    puntosClave = [],
    proximaAccion,
    panelUrl,
    appName,
  } = props;
  const waLink = `https://wa.me/${(telefonoProspecto || '').replace(/\D/g, '')}`;

  return (
    <Html>
      <Head />
      <Preview>{`🔥 Lead caliente: ${nombreProspecto} (score ${puntaje}/100)`}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={card}>
            <Section style={header}>
              <Text style={headerTitle}>🔥 Lead caliente detectado</Text>
              <Text style={headerSub}>
                Hola {nombreAdmin}, tienes un prospecto listo para cerrar
              </Text>
              <Text style={scoreBadge}>{puntaje}/100</Text>
            </Section>

            <Section style={body}>
              <Section style={prospectBox}>
                <Text style={prospectName}>{nombreProspecto}</Text>
                <Text style={prospectPhone}>📱 {telefonoProspecto}</Text>
              </Section>

              {resumen ? (
                <>
                  <Text style={sectionLabel}>Resumen del prospecto</Text>
                  <Text style={sectionText}>{resumen}</Text>
                </>
              ) : null}

              <Text style={sectionLabel}>Calificación BANT</Text>
              <Section style={{ margin: '0 0 20px 0' }}>
                <Text style={bantRow}>💰 Presupuesto: {presupuesto ?? '—'}/30</Text>
                <Text style={bantRow}>👔 Autoridad: {autoridad ?? '—'}/20</Text>
                <Text style={bantRow}>🎯 Necesidad: {necesidad ?? '—'}/25</Text>
                <Text style={bantRow}>⏱️ Plazo: {plazo ?? '—'}/25</Text>
              </Section>

              {puntosClave.length > 0 ? (
                <>
                  <Text style={sectionLabel}>Señales clave</Text>
                  <Section style={{ margin: '0 0 20px 0' }}>
                    {puntosClave.slice(0, 4).map((p, i) => (
                      <Text key={i} style={bantRow}>
                        ✅ {p}
                      </Text>
                    ))}
                  </Section>
                </>
              ) : null}

              {proximaAccion ? (
                <>
                  <Text style={sectionLabel}>Próxima acción recomendada</Text>
                  <Text style={sectionText}>{proximaAccion}</Text>
                </>
              ) : null}

              <Hr style={{ borderColor: '#eee', margin: '4px 0 16px' }} />
              <Section style={ctaWrap}>
                <Button style={ctaBtn} href={waLink}>
                  Escribirle por WhatsApp →
                </Button>
              </Section>
              <Section style={{ ...ctaWrap, paddingTop: '10px' }}>
                <Button
                  style={{ ...ctaBtn, backgroundColor: '#111827' }}
                  href={panelUrl}
                >
                  Ver en el panel
                </Button>
              </Section>
            </Section>

            <Section style={footer}>
              <Text style={{ margin: 0 }}>
                {appName} — IA de Ventas · alerta automática de lead caliente
              </Text>
            </Section>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export default LeadCalienteEmail;
