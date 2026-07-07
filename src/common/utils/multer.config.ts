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
