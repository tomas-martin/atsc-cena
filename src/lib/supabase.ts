import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isSupabaseConfigured = Boolean(url && anonKey && !url.includes('TU-PROYECTO'))

// El cliente solo usa la clave pública/publishable. La service_role jamás va en el navegador.
export const supabase = isSupabaseConfigured
  ? createClient(url!, anonKey!)
  : null
