const fs = require('fs');
const { spawn } = require('child_process');

// Generar ticket de prueba
function generateTestTicket() {
  const commands = [];
  
  // Inicializar impresora
  commands.push(Buffer.from([0x1B, 0x40])); // ESC @
  
  // Encabezado centrado
  commands.push(Buffer.from([0x1B, 0x61, 0x01])); // Centrar
  commands.push(Buffer.from([0x1B, 0x21, 0x08])); // Negrita
  commands.push(Buffer.from('EMPRESA DE PRUEBA\n'));
  commands.push(Buffer.from('--------------------------------\n'));
  
  // Información de la empresa
  commands.push(Buffer.from([0x1B, 0x61, 0x00])); // Izquierda
  commands.push(Buffer.from([0x1B, 0x21, 0x00])); // Normal
  commands.push(Buffer.from('RAZON SOCIAL: TEST SAC\n'));
  commands.push(Buffer.from('RUC: 12345678901\n'));
  commands.push(Buffer.from('DIRECCION: Lima, Peru\n'));
  commands.push(Buffer.from('--------------------------------\n'));
  
  // Tipo de comprobante
  commands.push(Buffer.from([0x1B, 0x61, 0x01])); // Centrar
  commands.push(Buffer.from([0x1B, 0x21, 0x08])); // Negrita
  commands.push(Buffer.from('BOLETA DE VENTA ELECTRONICA\n'));
  commands.push(Buffer.from('B001-000123\n'));
  commands.push(Buffer.from('--------------------------------\n'));
  
  // Fecha y cliente
  commands.push(Buffer.from([0x1B, 0x61, 0x00])); // Izquierda
  commands.push(Buffer.from([0x1B, 0x21, 0x00])); // Normal
  commands.push(Buffer.from(`FECHA: ${new Date().toLocaleDateString()}\n`));
  commands.push(Buffer.from(`HORA: ${new Date().toLocaleTimeString()}\n`));
  commands.push(Buffer.from('CLIENTE: CLIENTE DE PRUEBA\n'));
  commands.push(Buffer.from('DOC: 12345678\n'));
  commands.push(Buffer.from('--------------------------------\n'));
  
  // Productos
  commands.push(Buffer.from('CANT. DESCRIPCION         P.U.  IMP.\n'));
  commands.push(Buffer.from('--------------------------------\n'));
  commands.push(Buffer.from('1    PRODUCTO PRUEBA      10.00 10.00\n'));
  commands.push(Buffer.from('2    OTRO PRODUCTO        15.00 30.00\n'));
  commands.push(Buffer.from('--------------------------------\n'));
  
  // Totales
  commands.push(Buffer.from('TOTAL GRAVADAS:         33.90\n'));
  commands.push(Buffer.from('I.G.V 18.00%:           6.10\n'));
  commands.push(Buffer.from('IMPORTE TOTAL:          40.00\n'));
  commands.push(Buffer.from('--------------------------------\n'));
  
  // Información de pago
  commands.push(Buffer.from('MEDIO DE PAGO: EFECTIVO\n'));
  commands.push(Buffer.from('PAGADO: S/ 40.00\n'));
  commands.push(Buffer.from('VUELTO: S/ 0.00\n'));
  commands.push(Buffer.from('--------------------------------\n'));
  
  // Pie de página
  commands.push(Buffer.from([0x1B, 0x61, 0x01])); // Centrar
  commands.push(Buffer.from('\n'));
  commands.push(Buffer.from('Representacion impresa del\n'));
  commands.push(Buffer.from('Comprobante de Pago Electronico.\n'));
  commands.push(Buffer.from('Autorizado por SUNAT.\n'));
  commands.push(Buffer.from('\n\n'));
  
  // Cortar papel
  commands.push(Buffer.from([0x1D, 0x56, 0x00])); // Cut
  
  return Buffer.concat(commands);
}

async function printDirect() {
  const printerPort = '/dev/cu.MP210';
  
  console.log('🖨️ Imprimiendo ticket directo usando dd...');
  console.log(`Puerto: ${printerPort}`);
  
  // Generar comandos ESC/POS
  const escposData = generateTestTicket();
  console.log(`Datos generados: ${escposData.length} bytes`);
  
  return new Promise((resolve, reject) => {
    // Usar dd para envío directo al puerto
    const ddProcess = spawn('dd', [`of=${printerPort}`], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    ddProcess.stdin.write(escposData);
    ddProcess.stdin.end();
    
    ddProcess.on('close', (code) => {
      if (code === 0) {
        console.log('✅ Ticket enviado correctamente');
        resolve();
      } else {
        console.log(`❌ Error en dd, código: ${code}`);
        reject(new Error(`dd failed with code ${code}`));
      }
    });
    
    ddProcess.stderr.on('data', (data) => {
      console.log('dd stderr:', data.toString());
    });
    
    // Timeout de 5 segundos
    setTimeout(() => {
      ddProcess.kill();
      reject(new Error('Timeout'));
    }, 5000);
  });
}

// Ejecutar
printDirect()
  .then(() => {
    console.log('🎉 ¡Impresión completada!');
    console.log('Si imprimió correctamente, podemos integrar este método al sistema');
  })
  .catch((error) => {
    console.error('❌ Error:', error.message);
  });