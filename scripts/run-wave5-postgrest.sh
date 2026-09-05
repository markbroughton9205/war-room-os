#!/bin/zsh
set -euo pipefail
wave5_tmp=$(mktemp -d /tmp/war-room-wave5.XXXXXX)
wave5_data="$wave5_tmp/postgres"
cleanup() {
  if [ -n "${pgrst_pid:-}" ]; then kill "$pgrst_pid" 2>/dev/null || true; wait "$pgrst_pid" 2>/dev/null || true; fi
  /opt/homebrew/Cellar/postgresql@16/16.15/bin/pg_ctl -D "$wave5_data" -m fast stop >/dev/null 2>&1 || true
  /usr/bin/trash "$wave5_tmp" 2>/dev/null || true
}
trap cleanup EXIT
/opt/homebrew/Cellar/postgresql@16/16.15/bin/initdb -D "$wave5_data" --auth=trust --no-locale >/dev/null
/opt/homebrew/Cellar/postgresql@16/16.15/bin/pg_ctl -D "$wave5_data" -l "$wave5_tmp/postgres.log" -o "-h 127.0.0.1 -p 55549" start >/dev/null
psql_cmd=(/opt/homebrew/Cellar/postgresql@16/16.15/bin/psql -h 127.0.0.1 -p 55549 -d postgres -v ON_ERROR_STOP=1)
"${psql_cmd[@]}" -c "create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; create role authenticator noinherit login password 'local-only'; grant anon, authenticated, service_role to authenticator; grant usage on schema public to anon; create table public.war_room_conversations(id uuid primary key default gen_random_uuid()); create table public.war_room_claim_records(id uuid primary key default gen_random_uuid()); create table public.war_room_prompt_artifacts(id uuid primary key default gen_random_uuid()); create table public.war_room_agi_experience_records(id uuid primary key default gen_random_uuid(), model_target jsonb not null default '{}', turn_kind text not null, outcome_signal text not null);" >/dev/null
"${psql_cmd[@]}" -f supabase/war_room_phase50a_projects_and_loops.sql >/dev/null
"${psql_cmd[@]}" -f supabase/war_room_phase51c_world_learning_contradictions_gaps.sql >/dev/null
"${psql_cmd[@]}" -f supabase/war_room_phase52a_active_learning_curriculum.sql >/dev/null
"${psql_cmd[@]}" -f supabase/war_room_phase53a_training_checkpoint_loop.sql >/dev/null
"${psql_cmd[@]}" -f supabase/war_room_phase54a_real_engineering_evidence.sql >/dev/null
"${psql_cmd[@]}" -f supabase/war_room_phase55a_continuous_evidence_capabilities.sql >/dev/null
jwt_secret='wave5-local-secret-000000000000000000000000000000'
make_jwt='const c=require("crypto"),s=process.argv[1],role=process.argv[2],e=x=>Buffer.from(JSON.stringify(x)).toString("base64url"),a=e({alg:"HS256",typ:"JWT"})+"."+e({role,exp:Math.floor(Date.now()/1000)+3600});process.stdout.write(a+"."+c.createHmac("sha256",s).update(a).digest("base64url"))'
service_jwt=$(node -e "$make_jwt" "$jwt_secret" service_role); anon_jwt=$(node -e "$make_jwt" "$jwt_secret" anon)
printf '%s\n' "db-uri = \"postgres://authenticator:local-only@127.0.0.1:55549/postgres\"" "db-schemas = \"public\"" "db-anon-role = \"anon\"" "jwt-secret = \"$jwt_secret\"" "server-host = \"127.0.0.1\"" "server-port = 33309" > "$wave5_tmp/postgrest.conf"
/opt/homebrew/bin/postgrest "$wave5_tmp/postgrest.conf" >"$wave5_tmp/postgrest.log" 2>&1 & pgrst_pid=$!
for _ in {1..40}; do curl -sf http://127.0.0.1:33309/ >/dev/null && break; sleep 0.25; done
WAVE5_POSTGREST_UPSTREAM=http://127.0.0.1:33309 WAVE5_PROXY_PORT=33310 WAVE5_ANON_JWT="$anon_jwt" SUPABASE_SERVICE_ROLE_KEY="$service_jwt" pnpm run validate:agi-wave5:postgrest
echo 'Wave 5 production isolation: loopback-only disposable PostgreSQL/PostgREST removed.'
