import * as React from 'react';
import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Preview,
  Text,
} from '@react-email/components';

export interface ContratoVehiculoEmailItem {
  placa: string;
  desc?: string; // marca + modelo
  monto?: string; // ya formateado (ej. "S/ 500.00")
}

export interface ContratoGeneradoEmailProps {
  destinatarioNombre: string;
  vehiculos: ContratoVehiculoEmailItem[];
  servicio?: string;
  fechaInicio: string;
  fechaVencimiento: string;
  montoAnual?: string; // total ya formateado (ej. "S/ 500.00")
  observaciones?: string;
  negocioNombre?: string; // nombre comercial del negocio
  appName: string;
}

// ── Estilos (mismos que VencimientoContratoEmail / BienvenidaEmail) ───────────
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
const brandName: React.CSSProperties = {
  color: '#ffffff',
  fontSize: '16px',
  fontWeight: '700',
  margin: '0 0 24px 0',
};
const card: React.CSSProperties = {
  backgroundColor: '#ffffff',
  borderRadius: '14px',
  overflow: 'hidden',
  marginBottom: '16px',
};
const cardPad: React.CSSProperties = { padding: '28px 32px' };
const eyebrow: React.CSSProperties = {
  fontSize: '13px',
  color: '#6b7280',
  margin: '0 0 6px 0',
};
const titleText: React.CSSProperties = {
  fontSize: '34px',
  fontWeight: '800',
  color: '#111827',
  margin: '0 0 8px 0',
  letterSpacing: '-1px',
  lineHeight: '1.05',
};
const subtitle: React.CSSProperties = {
  fontSize: '14px',
  color: '#6b7280',
  margin: '0 0 4px 0',
  lineHeight: '1.6',
};
const divider: React.CSSProperties = {
  border: 'none',
  borderTop: '1px solid #e5e7eb',
  margin: '0',
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
  fontWeight: '600',
  margin: '0',
  padding: '10px 0',
  textAlign: 'right' as const,
};
const okBox: React.CSSProperties = {
  backgroundColor: '#ecfdf5',
  border: '1px solid #bbf7d0',
  borderRadius: '12px',
  padding: '14px 16px',
  margin: '16px 0 0 0',
};
const okText: React.CSSProperties = {
  color: '#166534',
  fontSize: '13px',
  lineHeight: '1.6',
  margin: '0',
};
const footerText: React.CSSProperties = {
  fontSize: '13px',
  color: '#6b7280',
  textAlign: 'center' as const,
  lineHeight: '1.6',
  margin: '20px 0 4px 0',
};

export const ContratoGeneradoEmail: React.FC<ContratoGeneradoEmailProps> = ({
  destinatarioNombre,
  vehiculos,
  servicio,
  fechaInicio,
  fechaVencimiento,
  montoAnual,
  observaciones,
  negocioNombre,
  appName,
}) => {
  const lista = vehiculos || [];
  const varios = lista.length > 1;
  const resumenVehiculos = varios
    ? `${lista.length} vehículos (${lista.map((v) => v.placa).join(', ')})`
    : `el vehículo ${lista[0]?.placa ?? ''}`;

  return (
    <Html lang="es">
      <Head />
      <Preview>{`Tu contrato de ${resumenVehiculos} ha sido generado.`}</Preview>
      <Body style={main}>
        <Container style={outer}>
          <p style={brandName}>{negocioNombre || appName}</p>

          <div style={card}>
            <div style={cardPad}>
              <p style={eyebrow}>Contrato generado</p>
              <p style={titleText}>¡Contrato activo!</p>
              <p style={subtitle}>
                Hola, <strong>{destinatarioNombre}</strong>. Te confirmamos que
                se ha generado el contrato de <strong>{resumenVehiculos}</strong>
                . A continuación el detalle.
              </p>
            </div>

            <Hr style={divider} />

            <div style={cardPad}>
              <p style={eyebrow}>
                {varios ? `Vehículos (${lista.length})` : 'Vehículo'}
              </p>
              <table
                width="100%"
                cellPadding={0}
                cellSpacing={0}
                style={{ borderCollapse: 'collapse', marginBottom: '8px' }}
              >
                <tbody>
                  {lista.map((v, i) => (
                    <tr
                      key={`${v.placa}-${i}`}
                      style={
                        i > 0 ? { borderTop: '1px solid #f3f4f6' } : undefined
                      }
                    >
                      <td style={metaLabel}>
                        <strong style={{ color: '#111827' }}>{v.placa}</strong>
                        {v.desc ? ` · ${v.desc}` : ''}
                      </td>
                      <td style={metaValue}>{v.monto || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <Hr style={divider} />

              <table
                width="100%"
                cellPadding={0}
                cellSpacing={0}
                style={{ borderCollapse: 'collapse' }}
              >
                <tbody>
                  {servicio && (
                    <tr>
                      <td style={metaLabel}>Servicio</td>
                      <td style={metaValue}>{servicio}</td>
                    </tr>
                  )}
                  <tr style={{ borderTop: '1px solid #f3f4f6' }}>
                    <td style={metaLabel}>Fecha de inicio</td>
                    <td style={metaValue}>{fechaInicio}</td>
                  </tr>
                  <tr style={{ borderTop: '1px solid #f3f4f6' }}>
                    <td style={metaLabel}>Vence el</td>
                    <td style={metaValue}>{fechaVencimiento}</td>
                  </tr>
                  {montoAnual && (
                    <tr style={{ borderTop: '1px solid #f3f4f6' }}>
                      <td style={metaLabel}>
                        {varios ? 'Monto total anual' : 'Monto anual'}
                      </td>
                      <td style={metaValue}>{montoAnual}</td>
                    </tr>
                  )}
                  {observaciones && (
                    <tr style={{ borderTop: '1px solid #f3f4f6' }}>
                      <td style={metaLabel}>Observaciones</td>
                      <td style={metaValue}>{observaciones}</td>
                    </tr>
                  )}
                </tbody>
              </table>

              <div style={okBox}>
                <p style={okText}>
                  <strong>Gracias por tu confianza.</strong> Te avisaremos
                  cuando se acerque la fecha de renovación para que no pierdas la
                  continuidad del servicio.
                </p>
              </div>
            </div>
          </div>

          <Text style={footerText}>
            {`Este mensaje fue enviado por ${negocioNombre || appName}.`}
          </Text>
        </Container>
      </Body>
    </Html>
  );
};

export default ContratoGeneradoEmail;
