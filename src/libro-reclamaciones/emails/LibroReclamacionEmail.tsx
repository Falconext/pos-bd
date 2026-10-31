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

/**
 * Un solo correo para los avisos del Libro de Reclamaciones (constancia al
 * consumidor, aviso a la empresa y respuesta). Mismo estilo que los correos
 * de la tienda.
 */
export interface LibroReclamacionEmailProps {
  remitente: string;
  preview: string;
  eyebrow: string;
  titulo: string;
  parrafos: string[];
  filas: { etiqueta: string; valor: string }[];
  /** Texto destacado (la respuesta del proveedor). */
  bloque?: { titulo: string; texto: string };
  pie: string;
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
const brand: React.CSSProperties = {
  color: '#ffffff',
  fontSize: '16px',
  fontWeight: '700',
  margin: '0 0 24px 0',
};
const card: React.CSSProperties = {
  backgroundColor: '#ffffff',
  borderRadius: '14px',
  overflow: 'hidden',
};
const pad: React.CSSProperties = { padding: '28px 32px' };
const eyebrowStyle: React.CSSProperties = {
  fontSize: '13px',
  color: '#6b7280',
  margin: '0 0 6px 0',
};
const tituloStyle: React.CSSProperties = {
  fontSize: '26px',
  fontWeight: '800',
  color: '#111827',
  margin: '0 0 12px 0',
  letterSpacing: '-0.5px',
  lineHeight: '1.15',
};
const parrafoStyle: React.CSSProperties = {
  fontSize: '14px',
  color: '#374151',
  margin: '0 0 12px 0',
  lineHeight: '1.6',
};
const etiquetaStyle: React.CSSProperties = {
  fontSize: '12px',
  color: '#6b7280',
  margin: '0',
};
const valorStyle: React.CSSProperties = {
  fontSize: '14px',
  color: '#111827',
  fontWeight: '600',
  margin: '0 0 10px 0',
};
const bloqueStyle: React.CSSProperties = {
  backgroundColor: '#f3f4f6',
  borderRadius: '12px',
  padding: '16px 18px',
  margin: '8px 0 0 0',
};
const bloqueTexto: React.CSSProperties = {
  fontSize: '14px',
  color: '#111827',
  margin: '0',
  lineHeight: '1.6',
  whiteSpace: 'pre-wrap',
};
const divider: React.CSSProperties = {
  border: 'none',
  borderTop: '1px solid #e5e7eb',
  margin: '16px 0',
};
const pieStyle: React.CSSProperties = {
  fontSize: '12px',
  color: '#9ca3af',
  margin: '20px 0 0 0',
  lineHeight: '1.5',
};

export function LibroReclamacionEmail(props: LibroReclamacionEmailProps) {
  return (
    <Html lang="es">
      <Head />
      <Preview>{props.preview}</Preview>
      <Body style={main}>
        <Container style={outer}>
          <Text style={brand}>{props.remitente}</Text>
          <Section style={card}>
            <Section style={pad}>
              <Text style={eyebrowStyle}>{props.eyebrow}</Text>
              <Text style={tituloStyle}>{props.titulo}</Text>
              {props.parrafos.map((p, i) => (
                <Text key={i} style={parrafoStyle}>
                  {p}
                </Text>
              ))}
              <Hr style={divider} />
              {props.filas.map((f) => (
                <Section key={f.etiqueta}>
                  <Text style={etiquetaStyle}>{f.etiqueta}</Text>
                  <Text style={valorStyle}>{f.valor}</Text>
                </Section>
              ))}
              {props.bloque ? (
                <Section style={bloqueStyle}>
                  <Text style={etiquetaStyle}>{props.bloque.titulo}</Text>
                  <Text style={bloqueTexto}>{props.bloque.texto}</Text>
                </Section>
              ) : null}
            </Section>
          </Section>
          <Text style={pieStyle}>{props.pie}</Text>
        </Container>
      </Body>
    </Html>
  );
}

export default LibroReclamacionEmail;
