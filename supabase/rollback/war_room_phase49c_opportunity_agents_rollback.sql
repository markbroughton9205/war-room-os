-- Rollback for Phase 49-C-2 Opportunity Agent Workforce durable persistence proposal.
-- Drops only the proposed Phase 49-C tables and policies.

drop policy if exists war_room_opportunity_agent_audit_service_role_all on public.war_room_opportunity_agent_audit;
drop policy if exists war_room_opportunity_agent_work_packets_service_role_all on public.war_room_opportunity_agent_work_packets;
drop policy if exists war_room_opportunity_agent_records_service_role_all on public.war_room_opportunity_agent_records;
drop policy if exists war_room_opportunity_agent_audit_commander_all on public.war_room_opportunity_agent_audit;
drop policy if exists war_room_opportunity_agent_work_packets_commander_all on public.war_room_opportunity_agent_work_packets;
drop policy if exists war_room_opportunity_agent_records_commander_all on public.war_room_opportunity_agent_records;

drop table if exists public.war_room_opportunity_agent_audit;
drop table if exists public.war_room_opportunity_agent_work_packets;
drop table if exists public.war_room_opportunity_agent_records;
