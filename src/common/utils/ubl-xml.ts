type UblRootName = 'Invoice' | 'CreditNote' | 'DebitNote' | 'DespatchAdvice';

const ROOT_NAMESPACES: Record<UblRootName, Record<string, string>> = {
  Invoice: {
    xmlns: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
    'xmlns:cac':
      'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
    'xmlns:cbc':
      'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
    'xmlns:ccts': 'urn:un:unece:uncefact:documentation:2',
    'xmlns:ds': 'http://www.w3.org/2000/09/xmldsig#',
    'xmlns:ext':
      'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2',
    'xmlns:qdt':
      'urn:oasis:names:specification:ubl:schema:xsd:QualifiedDatatypes-2',
    'xmlns:sac':
      'urn:sunat:names:specification:ubl:peru:schema:xsd:SunatAggregateComponents-1',
    'xmlns:udt':
      'urn:un:unece:uncefact:data:specification:UnqualifiedDataTypesSchemaModule:2',
    'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
  },
  CreditNote: {
    xmlns: 'urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2',
    'xmlns:cac':
      'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
    'xmlns:cbc':
      'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
    'xmlns:ccts': 'urn:un:unece:uncefact:documentation:2',
    'xmlns:ds': 'http://www.w3.org/2000/09/xmldsig#',
    'xmlns:ext':
      'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2',
    'xmlns:qdt':
      'urn:oasis:names:specification:ubl:schema:xsd:QualifiedDatatypes-2',
    'xmlns:sac':
      'urn:sunat:names:specification:ubl:peru:schema:xsd:SunatAggregateComponents-1',
    'xmlns:udt':
      'urn:un:unece:uncefact:data:specification:UnqualifiedDataTypesSchemaModule:2',
    'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
  },
  DebitNote: {
    xmlns: 'urn:oasis:names:specification:ubl:schema:xsd:DebitNote-2',
    'xmlns:cac':
      'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
    'xmlns:cbc':
      'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
    'xmlns:ccts': 'urn:un:unece:uncefact:documentation:2',
    'xmlns:ds': 'http://www.w3.org/2000/09/xmldsig#',
    'xmlns:ext':
      'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2',
    'xmlns:qdt':
      'urn:oasis:names:specification:ubl:schema:xsd:QualifiedDatatypes-2',
    'xmlns:sac':
      'urn:sunat:names:specification:ubl:peru:schema:xsd:SunatAggregateComponents-1',
    'xmlns:udt':
      'urn:un:unece:uncefact:data:specification:UnqualifiedDataTypesSchemaModule:2',
    'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
  },
  DespatchAdvice: {
    xmlns: 'urn:oasis:names:specification:ubl:schema:xsd:DespatchAdvice-2',
    'xmlns:cac':
      'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
    'xmlns:cbc':
      'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
    'xmlns:ccts': 'urn:un:unece:uncefact:documentation:2',
    'xmlns:ds': 'http://www.w3.org/2000/09/xmldsig#',
    'xmlns:ext':
      'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2',
    'xmlns:qdt':
      'urn:oasis:names:specification:ubl:schema:xsd:QualifiedDatatypes-2',
    'xmlns:sac':
      'urn:sunat:names:specification:ubl:peru:schema:xsd:SunatAggregateComponents-1',
    'xmlns:udt':
      'urn:un:unece:uncefact:data:specification:UnqualifiedDataTypesSchemaModule:2',
    'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
  },
};

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildAttributes(attributes?: Record<string, unknown>): string {
  if (!attributes) return '';
  return Object.entries(attributes)
    .filter(([, value]) => {
      if (value === undefined || value === null || value === '') return false;
      if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === 'undefined' || normalized === 'null') return false;
      }
      return true;
    })
    .map(([key, value]) => ` ${key}="${escapeXml(String(value))}"`)
    .join('');
}

function serializeNode(tagName: string, value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((item) => serializeNode(tagName, item)).join('');
  }

  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value !== 'object') {
    return `<${tagName}>${escapeXml(String(value))}</${tagName}>`;
  }

  const node = value as Record<string, any>;
  const attributes = buildAttributes(node._attributes);
  const text = node._text !== undefined && node._text !== null
    ? escapeXml(String(node._text))
    : '';
  const cdata = node._cdata !== undefined && node._cdata !== null
    ? `<![CDATA[${String(node._cdata)}]]>`
    : '';
  const children = Object.keys(node)
    .filter((key) => !['_attributes', '_text', '_cdata'].includes(key))
    .map((key) => serializeNode(key, node[key]))
    .join('');

  if (!text && !cdata && !children) {
    return `<${tagName}${attributes}/>`;
  }

  return `<${tagName}${attributes}>${text}${cdata}${children}</${tagName}>`;
}

export function buildUblXml(rootName: UblRootName, documentBody: Record<string, any>): string {
  const root = {
    _attributes: ROOT_NAMESPACES[rootName],
    'ext:UBLExtensions': {
      'ext:UBLExtension': {
        'ext:ExtensionContent': {},
      },
    },
    ...documentBody,
  };

  return `<?xml version="1.0" encoding="UTF-8"?>${serializeNode(rootName, root)}`;
}
