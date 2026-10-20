import * as React from 'react';
import {
  Body,
  Container,
  Head,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components';

export interface StockBajoEmailProps {
  negocioNombre: string;
  appName: string;
  fecha: string;
  total: number;
  agotados: number;
  grupos: {
    sedeNombre: string;
    productos: {
      descripcion: string;
      codigo: string | null;
      stock: string;
      minimo: number;
      faltan: string;
      agotado: boolean;
    }[];
  }[];
  /** Hay más filas de las que caben en el correo; el Excel adjunto las trae todas. */
  recortado: number;
  panelUrl: string;
}

// ── Estilos (mismo lenguaje que VencimientoContratoEmail) ─────────────────────
const main: React.CSSProperties = {
  backgroundColor: '#111111',
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  margin: 0,
  padding: 0,
};
const outer: React.CSSProperties = { margin: '0 auto', padding: '40px 16px 48px', maxWidth: '600px' };
const brandName: React.CSSProperties = { color: '#ffffff', fontSize: '16px', fontWeight: '700', margin: '0 0 24px 0' };
const card: React.CSSProperties = { backgroundColor: '#ffffff', borderRadius: '14px', overflow: 'hidden', marginBottom: '16px' };
const cardPad: React.CSSProperties = { padding: '28px 28px' };
const eyebrow: React.CSSProperties = { fontSize: '13px', color: '#6b7280', margin: '0 0 6px 0' };
const titleText: React.CSSProperties = {
  fontSize: '30px', fontWeight: '800', color: '#111827', margin: '0 0 8px 0', letterSpacing: '-1px', lineHeight: '1.1',
};
const subtitle: React.CSSProperties = { fontSize: '14px', color: '#6b7280', margin: '0 0 18px 0', lineHeight: '1.6' };
const sedeTitle: React.CSSProperties = { fontSize: '14px', fontWeight: '700', color: '#111827', margin: '18px 0 8px 0' };
const th: React.CSSProperties = {
  fontSize: '11px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em', textAlign: 'left',
  padding: '8px 6px', borderBottom: '1px solid #e5e7eb',
};
const thNum: React.CSSProperties = { ...th, textAlign: 'right' };
const td: React.CSSProperties = { fontSize: '13px', color: '#111827', padding: '9px 6px', borderBottom: '1px solid #f3f4f6', verticalAlign: 'top' };
const tdNum: React.CSSProperties = { ...td, textAlign: 'right', whiteSpace: 'nowrap' };
const codigo: React.CSSProperties = { display: 'block', fontSize: '11px', color: '#9ca3af' };
const ctaLink: React.CSSProperties = {
  backgroundColor: '#111111', color: '#ffffff', display: 'inline-block', fontSize: '13px', fontWeight: '700',
  textDecoration: 'none', padding: '13px 18px', borderRadius: '10px', marginTop: '20px',
};
const nota: React.CSSProperties = { fontSize: '12px', color: '#6b7280', margin: '14px 0 0 0', lineHeight: '1.6' };
const footerText: React.CSSProperties = {
  fontSize: '12px', color: '#6b7280', textAlign: 'center', lineHeight: '1.6', margin: '20px 0 4px 0',
};

export function StockBajoEmail(p: StockBajoEmailProps) {
  const variasSedes = p.grupos.length > 1;
  return (
    <Html lang="es">
      <Head />
      <Preview>{`${p.total} productos en su stock mínimo o por debajo${p.agotados ? ` · ${p.agotados} agotados` : ''}`}</Preview>
      <Body style={main}>
        <Container style={outer}>
          <Text style={brandName}>{p.negocioNombre}</Text>
          <Section style={card}>
            <div style={cardPad}>
              <Text style={eyebrow}>Inventario · {p.fecha}</Text>
              <Text style={titleText}>
                {p.total} {p.total === 1 ? 'producto por reponer' : 'productos por reponer'}
              </Text>
              <Text style={subtitle}>
                Están en su stock mínimo o por debajo
                {p.agotados > 0 ? `; ${p.agotados} ${p.agotados === 1 ? 'ya está agotado' : 'ya están agotados'}` : ''}.
                La columna <strong>Faltan</strong> es lo que falta para volver al mínimo. Adjuntamos la lista en Excel para tu pedido.
              </Text>

              {p.grupos.map((g) => (
                <div key={g.sedeNombre}>
                  {variasSedes && <Text style={sedeTitle}>{g.sedeNombre}</Text>}
                  <table width="100%" cellPadding={0} cellSpacing={0} style={{ borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={th}>Producto</th>
                        <th style={thNum}>Stock</th>
                        <th style={thNum}>Mínimo</th>
                        <th style={thNum}>Faltan</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.productos.map((x, i) => (
                        <tr key={`${x.descripcion}-${i}`}>
                          <td style={td}>
                            {x.descripcion}
                            {x.codigo ? <span style={codigo}>{x.codigo}</span> : null}
                          </td>
                          <td style={{ ...tdNum, color: x.agotado ? '#b91c1c' : '#b45309', fontWeight: 700 }}>{x.stock}</td>
                          <td style={tdNum}>{x.minimo}</td>
                          <td style={tdNum}>{x.faltan}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}

              {p.recortado > 0 && (
                <Text style={nota}>…y {p.recortado} más. La lista completa está en el Excel adjunto.</Text>
              )}

              <a href={p.panelUrl} style={ctaLink}>Ver inventario en el panel</a>

              <Text style={nota}>
                El mínimo de cada producto se cambia en Kardex. Este resumen se apaga o se envía a otros correos desde Perfil → Configuración → Alertas de stock bajo.
              </Text>
            </div>
          </Section>
          {/* "AUTOPARTES S.A." ya termina en punto: sin esto salía "S.A..". */}
          <Text style={footerText}>Aviso automático de {p.appName} para {p.negocioNombre.replace(/\.+$/, '')}.</Text>
        </Container>
      </Body>
    </Html>
  );
}

export default StockBajoEmail;
