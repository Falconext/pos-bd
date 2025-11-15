const { SerialPort } = require('serialport');

const printerPath = '/dev/cu.MP210';

async function testXprinter() {
  return new Promise((resolve, reject) => {
    console.log('=== PRUEBA ESPECÍFICA XPRINTER JACL-P210 ===');
    console.log('Comandos ESC/POS específicos para impresoras térmicas...\n');

    const port = new SerialPort({
      path: printerPath,
      baudRate: 9600,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
      autoOpen: false
    });

    port.open((err) => {
      if (err) {
        console.error('Error abriendo puerto:', err.message);
        return reject(err);
      }

      console.log('✅ Puerto abierto correctamente');

      // Secuencia de comandos ESC/POS para Xprinter
      const commands = [
        // 1. Reset completo de la impresora
        Buffer.from([0x1B, 0x40]), // ESC @ (Initialize printer)
        
        // 2. Configurar ancho de papel a 58mm
        Buffer.from([0x1D, 0x57, 0x30]), // GS W (Set print area width)
        
        // 3. Configurar modo de impresión
        Buffer.from([0x1B, 0x21, 0x00]), // ESC ! (Select print mode - normal)
        
        // 4. Test de autotest (específico de Xprinter)
        Buffer.from([0x1D, 0x28, 0x41]), // GS ( A (Execute test print)
        
        // 5. Comando alternativo de test
        Buffer.from([0x1F, 0x40]), // US @ (Real-time commands)
        
        // 6. Texto de prueba simple
        Buffer.from('*** XPRINTER TEST ***\n'),
        Buffer.from('Modelo: JACL-P210\n'),
        Buffer.from('Puerto: ' + printerPath + '\n'),
        Buffer.from('Baudrate: 9600\n'),
        Buffer.from('Estado: TESTING\n'),
        Buffer.from('------------------------\n'),
        
        // 7. Alimentar papel
        Buffer.from([0x1B, 0x64, 0x05]), // ESC d (Print and feed n lines)
        
        // 8. Cortar papel (si tiene cortador)
        Buffer.from([0x1D, 0x56, 0x00]), // GS V (Cut paper)
        
        // 9. Comando de finalización
        Buffer.from([0x0C]) // Form feed
      ];

      let commandIndex = 0;

      function sendNextCommand() {
        if (commandIndex >= commands.length) {
          console.log('✅ Todos los comandos enviados');
          
          // Cerrar puerto después de 3 segundos
          setTimeout(() => {
            port.close();
            console.log('✅ Puerto cerrado');
            resolve();
          }, 3000);
          return;
        }

        const command = commands[commandIndex];
        console.log(`📤 Enviando comando ${commandIndex + 1}/${commands.length}: ${command.length} bytes`);
        
        port.write(command, (writeErr) => {
          if (writeErr) {
            console.error(`❌ Error enviando comando ${commandIndex + 1}:`, writeErr.message);
            port.close();
            return reject(writeErr);
          }

          // Pequeña pausa entre comandos
          setTimeout(() => {
            commandIndex++;
            sendNextCommand();
          }, 500);
        });
      }

      // Configurar eventos
      port.on('data', (data) => {
        console.log('📥 Datos recibidos:', data.toString('hex'));
      });

      port.on('error', (error) => {
        console.error('❌ Error del puerto:', error.message);
      });

      // Comenzar envío de comandos después de una pausa inicial
      setTimeout(() => {
        sendNextCommand();
      }, 1000);
    });

    // Timeout de seguridad
    setTimeout(() => {
      if (port.isOpen) {
        console.log('⏰ Timeout - cerrando puerto...');
        port.close();
      }
      resolve();
    }, 15000);
  });
}

// También probar comando directo de autotest
async function directAutotest() {
  console.log('\n=== COMANDO DIRECTO DE AUTOTEST ===');
  
  try {
    // Comando específico de Xprinter para autotest
    const autoTestCmd = Buffer.from([
      0x1B, 0x40,           // Reset
      0x1D, 0x28, 0x41,     // Autotest command  
      0x02, 0x00,           // Parameter length
      0x02, 0x01            // Autotest parameters
    ]);
    
    console.log('Enviando comando de autotest directo...');
    const { spawn } = require('child_process');
    
    // Usar dd para envío directo
    const process = spawn('dd', ['of=/dev/cu.MP210'], { 
      stdio: ['pipe', 'pipe', 'pipe'] 
    });
    
    process.stdin.write(autoTestCmd);
    process.stdin.end();
    
    await new Promise((resolve) => {
      process.on('close', (code) => {
        console.log(`Comando dd terminado con código: ${code}`);
        resolve();
      });
    });
    
  } catch (error) {
    console.error('Error en autotest directo:', error.message);
  }
}

async function main() {
  try {
    await testXprinter();
    await new Promise(resolve => setTimeout(resolve, 2000));
    await directAutotest();
    
    console.log('\n=== PRUEBA COMPLETADA ===');
    console.log('Si no imprimió nada, puede ser:');
    console.log('1. Impresora en modo Bluetooth (cambiar a USB)');
    console.log('2. Sin papel térmico o mal colocado');
    console.log('3. Impresora requiere drivers específicos');
    console.log('4. Baudrate incorrecto (probar 115200)');
    
  } catch (error) {
    console.error('Error en la prueba:', error.message);
  }
}

main();