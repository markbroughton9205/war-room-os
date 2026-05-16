# Phase 10: Agent Foundry and Long-Lived Operations

## Purpose

Phase 10 introduces the Agent Foundry: a governed process for creating, evaluating, operating, and retiring specialized agents. Agents should emerge from validated operational needs, not from novelty or personality design.

The goal is an adaptive agent ecosystem with clear permissions, memory access, task specialization, approval boundaries, and measurable usefulness.

## Primary Outcomes

- Define the agent lifecycle from need detection to retirement.
- Support adaptive agents specialized by task, domain, risk class, or environment.
- Introduce long-lived workers for approved background operations.
- Preserve auditability and Commander control as automation expands.
- Establish review and scoring systems for agent usefulness.

## Agent Foundry

The Agent Foundry is the process and infrastructure for creating agents from repeated operational needs.

An agent may be created when the platform identifies:

- A recurring task pattern.
- A validated workflow with measurable value.
- A clear permission scope.
- A useful memory boundary.
- A repeatable input and output contract.
- A known escalation path.
- A review process for failures and drift.

Agents should not be created for vague identity, branding, or theatrical behavior. They should exist because they reduce operational friction or improve decision quality.

## Adaptive Agents

Adaptive agents may improve their routing, prompts, tools, and memory usage based on evaluation data. Adaptation must remain bounded by doctrine and approval requirements.

Adaptive behavior may include:

- Recommending workflow changes.
- Narrowing or broadening task classification.
- Updating retrieval strategy.
- Flagging weak tool performance.
- Suggesting permission changes for Commander review.
- Retiring steps that no longer improve outcomes.

Adaptive behavior may not include silent permission expansion, hidden external action, production mutation, spending, or external communication.

## Task Specialization

Agents should specialize where specialization improves reliability.

Potential specialization areas:

- Codebase triage.
- Deployment readiness.
- Memory curation.
- Provider evaluation.
- Financial review.
- External signal monitoring.
- Red Team challenge.
- Documentation synthesis.
- Customer or operator support.
- Incident review.

Specialized agents should have clear task boundaries. A specialized agent should escalate when work leaves its domain or risk scope.

## Long-Lived Workers

Long-lived workers support approved background operations. They may monitor, index, evaluate, summarize, or prepare work over time.

Worker categories:

- Memory compaction workers.
- Evaluation and scoring workers.
- Signal monitoring workers.
- Documentation freshness workers.
- CI and deployment readiness workers.
- Incident watch workers.
- Operator notification workers.

Long-lived workers require explicit scope, runtime limits, logging, failure handling, and stop controls. External actions and production changes still require approval unless a narrow pre-approved policy explicitly permits them.

## Background Operations

Background operations should be visible and controllable. The operator should be able to inspect active workers, recent actions, pending approvals, errors, and resource usage.

Background systems should record:

- Worker identity and version.
- Assigned mission.
- Permission scope.
- Memory scope.
- Tools used.
- Outputs produced.
- Escalations raised.
- Errors and recovery actions.
- Resource usage and cost.

## Agent Evaluation

Agents should be evaluated by outcomes.

Evaluation dimensions:

- Task success rate.
- Accuracy.
- Commander correction rate.
- Useful escalation rate.
- Cost and latency.
- Failure rate.
- Audit completeness.
- Compliance with approval doctrine.
- Memory quality.
- Reduction in operator workload.

Agents that underperform should be narrowed, retrained through better prompts or workflow design, merged into another agent, or retired.

## Acceptance Criteria

- War Room has an agent lifecycle doctrine.
- Adaptive agents are bounded by permissions, memory scopes, and audit requirements.
- Long-lived workers have visible scope, controls, and logs.
- Background operations preserve approval gates for risky work.
- Agent usefulness can be measured and reviewed.
