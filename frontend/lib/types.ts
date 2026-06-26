export type CanMap = Record<string, boolean>;

export interface User {
  username: string;
  full_name: string;
  role: string;
  role_label_key: string;
  email: string;
  lang: string;
  can: CanMap;
}

export interface Vehicle {
  vehicle_id: string;
  make_model: string;
  year: number | null;
  license_plate: string;
  color: string;
  mileage: number;
  status: string;
  base_daily_rate: number; // cents
  notes: string;
}

export interface FleetCounts {
  total: number;
  available: number;
  rented: number;
  garage: number;
}

export interface NavItem {
  key: string;
  label_key: string;
  icon: string;
}

export interface BusinessInfo {
  business_name: string;
  initial: string;
  tagline: string;
  version: string;
}

export interface LanguagesInfo {
  languages: Record<string, string>;
  default: string;
  staff_only: string[];
}
