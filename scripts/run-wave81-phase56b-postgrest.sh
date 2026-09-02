#!/bin/zsh
set -euo pipefail
wave81_tmp=$(mktemp -d /tmp/war-room-wave81.XXXXXX)
wave81_data="$wave81_tmp/postgres"
cleanup() {
  if [ -n "${pgrst_pid:-}" ]; then kill "$pgrst_pid" 2>/dev/null || true; wait "$pgrst_pid" 2>/dev/null || true; fi
  /opt/homebrew/Cellar/postgresql@16/16.15/bin/pg_ctl -D "$wave81_data" -m fast stop >/dev/null 2>&1 || true
  /usr/bin/trash "$wave81_tmp" 2>/dev/null || true
}
trap cleanup EXIT
/opt/homebrew/Cellar/postgresql@16/16.15/bin/initdb -D "$wave81_data" --auth=trust --no-locale >/dev/null
/opt/homebrew/Cellar/postgresql@16/16.15/bin/pg_ctl -D "$wave81_data" -l "$wave81_tmp/postgres.log" -o "-h 127.0.0.1 -p 55551" start >/dev/null
psql_cmd=(/opt/homebrew/Cellar/postgresql@16/16.15/bin/psql -h 127.0.0.1 -p 55551 -d postgres -v ON_ERROR_STOP=1)
"${psql_cmd[@]}" -c "create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; create role authenticator noinherit login password 'local-only'; grant anon, authenticated, service_role to authenticator; grant usage on schema public to anon; create table public.war_room_conversations(id uuid primary key default gen_random_uuid()); create table public.war_room_claim_records(id uuid primary key default gen_random_uuid()); create table public.war_room_prompt_artifacts(id uuid primary key default gen_random_uuid());" >/dev/null
"${psql_cmd[@]}" -f supabase/war_room_phase50a_projects_and_loops.sql >/dev/null
"${psql_cmd[@]}" -f supabase/war_room_phase51c_world_learning_contradictions_gaps.sql >/dev/null
"${psql_cmd[@]}" -f supabase/war_room_phase52a_active_learning_curriculum.sql >/dev/null
"${psql_cmd[@]}" -f supabase/war_room_phase56a_agi_gym_runs.sql >/dev/null
"${psql_cmd[@]}" -f supabase/war_room_phase56b_tool_use_evidence_source.sql >/dev/null
jwt_secret='wave81-local-secret-000000000000000000000000000000'
make_jwt='const c=require("crypto"),s=process.argv[1],role=process.argv[2],e=x=>Buffer.from(JSON.stringify(x)).toString("base64url"),a=e({alg:"HS256",typ:"JWT"})+"."+e({role,exp:Math.floor(Date.now()/1000)+3600});process.stdout.write(a+"."+c.createHmac("sha256",s).update(a).digest("base64url"))'
service_jwt=$(node -e "$make_jwt" "$jwt_secret" service_role); anon_jwt=$(node -e "$make_jwt" "$jwt_secret" anon)
printf '%s\n' "db-uri = \"postgres://authenticator:local-only@127.0.0.1:55551/postgres\"" "db-schemas = \"public\"" "db-anon-role = \"anon\"" "jwt-secret = \"$jwt_secret\"" "server-host = \"127.0.0.1\"" "server-port = 33311" > "$wave81_tmp/postgrest.conf"
/opt/homebrew/bin/postgrest "$wave81_tmp/postgrest.conf" >"$wave81_tmp/postgrest.log" 2>&1 & pgrst_pid=$!
for _ in {1..40}; do curl -sf http://127.0.0.1:33311/ >/dev/null && break; sleep 0.25; done
WAVE81_POSTGREST_UPSTREAM=http://127.0.0.1:33311 WAVE81_PROXY_PORT=33312 WAVE81_ANON_JWT="$anon_jwt" SUPABASE_SERVICE_ROLE_KEY="$service_jwt" node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/wrim1-dataset/phase56b.validation.ts
echo 'Wave 8.1 Phase 56B: loopback-only disposable PostgreSQL/PostgREST removed.'
