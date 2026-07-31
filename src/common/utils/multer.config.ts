import { BadRequestException } from '@nestjs/common';
import multer from 'multer';

const storage = multer.memoryStorage();

const fileFilter = (req: any, file: any, cb: any) => {
  const allowedTypes = [
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ];
  if (!allowedTypes.includes(file.mimetype)) {
    return cb(
      new BadRequestException('Solo se permiten archivos Excel (.xls, .xlsx)'),
    );
  }
  cb(null, true);
};

export const excelUploadOptions = {
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 },
} as const;

export const uploadExcel: any = multer(excelUploadOptions).single('excel');

// Hoja de cálculo: Excel (.xls/.xlsx) o CSV. Usado por la importación de
// Notas de venta históricas. Acepta CSV además de los mimetypes de Excel.
const spreadsheetFilter = (req: any, file: any, cb: any) => {
  const allowedMimes = [
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'application/csv',
    'text/plain',
  ];
  const name = String(file.originalname || '').toLowerCase();
  const okExt = ['.xls', '.xlsx', '.csv'].some((ext) => name.endsWith(ext));
  if (!allowedMimes.includes(file.mimetype) && !okExt) {
    return cb(
      new BadRequestException('Solo se permiten archivos Excel (.xlsx, .xls) o CSV'),
    );
  }
  cb(null, true);
};

export const spreadsheetUploadOptions = {
  storage: multer.memoryStorage(),
  fileFilter: spreadsheetFilter,
  limits: { fileSize: 10 * 1024 * 1024 },
} as const;

// Imágenes (PNG/JPEG/WEBP) en memoria
const imageStorage = multer.memoryStorage();
const imageFilter = (req: any, file: any, cb: any) => {
  const allowed = [
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/webp',
    'image/avif',
  ];
  if (!allowed.includes(file.mimetype)) {
    return cb(
      new BadRequestException('Solo se permiten imágenes PNG/JPEG/WEBP/AVIF'),
    );
  }
  cb(null, true);
};

export const imageUploadOptions = {
  storage: imageStorage,
  fileFilter: imageFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
} as const;

// XML SUNAT en memoria
const xmlFilter = (req: any, file: any, cb: any) => {
  const isXmlMime = ['text/xml', 'application/xml'].includes(file.mimetype);
  const isXmlExt = file.originalname?.toLowerCase().endsWith('.xml');
  if (!isXmlMime && !isXmlExt) {
    return cb(new BadRequestException('Solo se permiten archivos XML'));
  }
  cb(null, true);
};

export const xmlUploadOptions = {
  storage: multer.memoryStorage(),
  fileFilter: xmlFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
} as const;
