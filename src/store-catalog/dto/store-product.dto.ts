import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';

const VALID_CATEGORIES = ['Accesorios', 'Combo', 'Equipos', 'Sistema'];

export class CreateStoreProductDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNumber()
  @Min(0)
  @Transform(({ value }) => parseFloat(value))
  price: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Transform(({ value }) =>
    value !== undefined && value !== '' ? parseFloat(value) : undefined,
  )
  oldPrice?: number;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsString()
  badge?: string;

  @IsOptional()
  @IsIn(VALID_CATEGORIES)
  category?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Transform(({ value }) =>
    value !== undefined && value !== '' ? parseInt(value) : undefined,
  )
  stock?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsNumber()
  @Transform(({ value }) => (value !== undefined ? parseInt(value) : 0))
  order?: number;
}

export class UpdateStoreProductDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Transform(({ value }) =>
    value !== undefined ? parseFloat(value) : undefined,
  )
  price?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Transform(({ value }) =>
    value !== undefined && value !== '' ? parseFloat(value) : undefined,
  )
  oldPrice?: number;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsString()
  badge?: string;

  @IsOptional()
  @IsIn(VALID_CATEGORIES)
  category?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Transform(({ value }) =>
    value !== undefined && value !== '' ? parseInt(value) : undefined,
  )
  stock?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsNumber()
  @Transform(({ value }) => (value !== undefined ? parseInt(value) : undefined))
  order?: number;
}

export class FilterStoreProductDto {
  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @Transform(({ value }) => parseFloat(value))
  minPrice?: number;

  @IsOptional()
  @Transform(({ value }) => parseFloat(value))
  maxPrice?: number;

  /** "true" = solo en stock (stock > 0 o null), "false" = solo agotados (stock === 0) */
  @IsOptional()
  @Transform(({ value }) => value === 'true')
  inStock?: boolean;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  sortBy?: 'name_asc' | 'name_desc' | 'price_asc' | 'price_desc';
}
