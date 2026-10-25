// Database types for supabase/migrations/0001_init.sql.
// Same shape as `supabase gen types typescript` output, with the text status
// columns narrowed to the values allowed by their CHECK constraints.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type BulkJobStatus = 'pending' | 'running' | 'completed' | 'failed';
export type BulkRowStatus = 'pending' | 'running' | 'completed' | 'failed';
export type SearchStatus = 'completed' | 'no_results' | 'failed';

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: '13';
  };
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string | null;
          created_at: string;
        };
        Insert: {
          id: string;
          email?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          email?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      bulk_jobs: {
        Row: {
          id: string;
          user_id: string;
          file_name: string;
          total_rows: number;
          processed_rows: number;
          status: BulkJobStatus;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string;
          file_name: string;
          total_rows: number;
          processed_rows?: number;
          status?: BulkJobStatus;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          file_name?: string;
          total_rows?: number;
          processed_rows?: number;
          status?: BulkJobStatus;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      bulk_job_rows: {
        Row: {
          id: string;
          bulk_job_id: string;
          row_index: number;
          company_url: string;
          position: string;
          status: BulkRowStatus;
          search_id: string | null;
          error: string | null;
        };
        Insert: {
          id?: string;
          bulk_job_id: string;
          row_index: number;
          company_url?: string;
          position?: string;
          status?: BulkRowStatus;
          search_id?: string | null;
          error?: string | null;
        };
        Update: {
          id?: string;
          bulk_job_id?: string;
          row_index?: number;
          company_url?: string;
          position?: string;
          status?: BulkRowStatus;
          search_id?: string | null;
          error?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'bulk_job_rows_bulk_job_id_fkey';
            columns: ['bulk_job_id'];
            isOneToOne: false;
            referencedRelation: 'bulk_jobs';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'bulk_job_rows_search_id_fkey';
            columns: ['search_id'];
            isOneToOne: false;
            referencedRelation: 'searches';
            referencedColumns: ['id'];
          },
        ];
      };
      searches: {
        Row: {
          id: string;
          user_id: string;
          bulk_job_id: string | null;
          company_url: string;
          domain: string | null;
          company_name: string | null;
          position: string;
          status: SearchStatus;
          error: string | null;
          from_cache: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string;
          bulk_job_id?: string | null;
          company_url: string;
          domain?: string | null;
          company_name?: string | null;
          position: string;
          status?: SearchStatus;
          error?: string | null;
          from_cache?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          bulk_job_id?: string | null;
          company_url?: string;
          domain?: string | null;
          company_name?: string | null;
          position?: string;
          status?: SearchStatus;
          error?: string | null;
          from_cache?: boolean;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'searches_bulk_job_id_fkey';
            columns: ['bulk_job_id'];
            isOneToOne: false;
            referencedRelation: 'bulk_jobs';
            referencedColumns: ['id'];
          },
        ];
      };
      search_results: {
        Row: {
          id: string;
          search_id: string;
          rank: number;
          full_name: string;
          headline: string;
          linkedin_url: string;
          confidence: number;
          reasoning: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          search_id: string;
          rank: number;
          full_name: string;
          headline?: string;
          linkedin_url: string;
          confidence: number;
          reasoning?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          search_id?: string;
          rank?: number;
          full_name?: string;
          headline?: string;
          linkedin_url?: string;
          confidence?: number;
          reasoning?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'search_results_search_id_fkey';
            columns: ['search_id'];
            isOneToOne: false;
            referencedRelation: 'searches';
            referencedColumns: ['id'];
          },
        ];
      };
      search_cache: {
        Row: {
          domain: string;
          position_normalized: string;
          company_name: string;
          results: Json;
          created_at: string;
        };
        Insert: {
          domain: string;
          position_normalized: string;
          company_name: string;
          results?: Json;
          created_at?: string;
        };
        Update: {
          domain?: string;
          position_normalized?: string;
          company_name?: string;
          results?: Json;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      refresh_bulk_job_progress: {
        Args: { p_job_id: string };
        Returns: number;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type PublicSchema = Database['public'];

export type Tables<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Row'];
export type TablesInsert<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Insert'];
export type TablesUpdate<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Update'];

export type ProfileRow = Tables<'profiles'>;
export type BulkJobRow = Tables<'bulk_jobs'>;
export type BulkJobRowRow = Tables<'bulk_job_rows'>;
export type SearchRow = Tables<'searches'>;
export type SearchResultRow = Tables<'search_results'>;
export type SearchCacheRow = Tables<'search_cache'>;
