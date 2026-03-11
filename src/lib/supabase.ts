import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://nwsfadecdaamlkahbxrf.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im53c2ZhZGVjZGFhbWxrYWhieHJmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg4NDQ3MjIsImV4cCI6MjA4NDQyMDcyMn0.yp3HSl41KfaffIi1R40S13NjU0Kz3ZA3hEzaroktjHU";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);