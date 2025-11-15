const { spawn } = require('child_process');

const ticketText = `


        EMPRESA DE PRUEBA
    --------------------------------
    RAZON SOCIAL: TEST SAC
    RUC: 12345678901
    DIRECCION: Lima, Peru
    --------------------------------

       BOLETA DE VENTA ELECTRONICA
            B001-000123
    --------------------------------
    FECHA: ${new Date().toLocaleDateString()}
    HORA: ${new Date().toLocaleTimeString()}
    CLIENTE: CLIENTE DE PRUEBA
    DOC: 12345678
    --------------------------------
    CANT. DESCRIPCION         P.U.  IMP.
    --------------------------------
    1    PRODUCTO PRUEBA      10.00 10.00
    2    OTRO PRODUCTO        15.00 30.00
    --------------------------------
    TOTAL GRAVADAS:         33.90
    I.G.V 18.00%:           6.10
    IMPORTE TOTAL:          40.00
    --------------------------------
    MEDIO DE PAGO: EFECTIVO
    PAGADO: S/ 40.00
    VUELTO: S/ 0.00
    --------------------------------

        Representacion impresa del
        Comprobante de Pago Electronico.
        Autorizado por SUNAT.



`;

console.log('🖨️ Enviando ticket a TECH_CLA58 via CUPS...');

const lpProcess = spawn('lp', ['-d', 'TECH_CLA58', '-'], {
  stdio: ['pipe', 'pipe', 'pipe']
});

lpProcess.stdin.write(ticketText);
lpProcess.stdin.end();

lpProcess.stdout.on('data', (data) => {
  console.log('CUPS stdout:', data.toString());
});

lpProcess.stderr.on('data', (data) => {
  console.log('CUPS stderr:', data.toString());
});

lpProcess.on('close', (code) => {
  if (code === 0) {
    console.log('✅ ¡Ticket enviado a impresora TECH_CLA58!');
    console.log('Revisa si la impresora imprimió el ticket');
  } else {
    console.log(`❌ Error en CUPS, código: ${code}`);
  }
});