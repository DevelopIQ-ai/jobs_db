/**
 * Shared types for the validator
 */

export interface ValidationError {
  type: "structure" | "format" | "schema";
  file: string;
  line?: number;
  field?: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  stats: {
    recordsChecked: number;
    recordsValid: number;
    recordsInvalid: number;
  };
}

export interface PrimaryKeyStrategy {
  type: "stable_id" | "url" | "url_fingerprint" | "fingerprint";
  stable_id_context_path?: string[];
  canonical_url_field?: string;
  fingerprint_fields?: string[];
}

export interface SourceConfig {
  source_id?: string;
  display_name?: string;
  entity_type?: string;
  data_as_of?: string;
  start_urls?: string[];
  run_command?: string;
  refresh?: string;
  primary_key_strategy?: PrimaryKeyStrategy;
  expected_volume_range?: {
    min?: number;
    max?: number;
  };
}

export interface CoreSection {
  source_id: string;
  entity_type: "person" | "company";
  scraped_at: string;
  raw_url: string;
  primary_key: string;
}

export interface PersonSection {
  full_name: string;
  first_name?: string;
  middle_name?: string;
  last_name?: string;
  suffix?: string;
  title?: string;
  company_name?: string;
  profile_url?: string;
  name_raw?: string;
  website?: string;
  location?: {
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
  };
}

export interface CompanySection {
  company_name: string;
  legal_name?: string;
  domain?: string;
  industry?: string;
  size?: number;
  founded_year?: number;
  profile_url?: string;
  name_raw?: string;
  website?: string;
  location?: {
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
  };
}

export interface ContactSection {
  email?: string;
  phone?: string;
  socials?: Array<{ platform: string; url: string }>;
  [key: string]: unknown;  // Additional contact fields
}

export interface LeadRecord {
  core: CoreSection;
  person?: PersonSection;
  company?: CompanySection;
  contact: ContactSection;
  context: Record<string, unknown>;
}

export interface RunJson {
  source_id: string;
  run_id: string;
  started_at: string;
  ended_at: string;
  records_found: number;
  records_valid: number;
  records_written: number;
  error_count: number;
}
