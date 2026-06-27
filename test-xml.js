const convert = require('xml-js');

function formatDate(date) {
    if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
    const d = new Date(date);
    const year = d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

const guia = {
    modoTransporte: '02',
    fechaInicioTraslado: new Date('2026-06-27'),
    conductorNumDoc: '12345678'
};

const stage = {
    'cbc:TransportModeCode': { _text: guia.modoTransporte },
    'cac:TransitPeriod': {
        'cbc:StartDate': { _text: formatDate(guia.fechaInicioTraslado) },
    },
};

stage['cac:ActualPickupTransportEvent'] = {
    'cbc:OccurrenceDate': { _text: formatDate(guia.fechaInicioTraslado) }
};

if (guia.modoTransporte === '02' && String(guia.conductorNumDoc || '').trim()) {
    stage['cac:DriverPerson'] = [{
        'cbc:ID': { _text: guia.conductorNumDoc }
    }];
}

const doc = {
    _declaration: { _attributes: { version: '1.0', encoding: 'UTF-8' } },
    'Invoice': {
        'cac:ShipmentStage': stage
    }
};

const xml = convert.js2xml(doc, { compact: true, spaces: 4 });
console.log(xml);
