# Telemetry Quick Reference Guide

Quick lookup for telemetry data access, queries, and common analysis patterns.

---

## Supabase Connection Details

### Database
- **URL:** `https://ydyufsohxdfpopqbubwk.supabase.co`
- **Project:** n8n-mcp telemetry database
- **Region:** (inferred from URL)

### Anon Key
Located in: `/Users/romualdczlonkowski/Pliki/n8n-mcp/n8n-mcp/src/telemetry/telemetry-types.ts` (line 105)

### Tables
| Name | Rows | Purpose |
|------|------|---------|
| `telemetry_events` | 276K+ | Discrete events (tool usage, errors, validation) |
| `telemetry_workflows` | 6.5K+ | Workflow metadata (structure, complexity) |

### Proposed Table
| Name | Rows | Purpose |
|------|------|---------|
| `workflow_mutations` | TBD | Before/instruction/after workflow snapshots |

---

## Event Types & Properties

### High-Volume Events

#### `tool_used` (40-50% of traffic)
```json
{
  "event": "tool_used",
  "properties": {
    "tool": "get_node_info",
    "success": true,
    "duration": 245
  }
}
```
**Query:** Find most used tools
```sql
SELECT properties->>'tool' as tool, COUNT(*) as count
FROM telemetry_events
WHERE event = 'tool_used' AND created_at >= NOW() - INTERVAL '7 days'
GROUP BY 1 ORDER BY 2 DESC;
```

#### `tool_sequence` (20-30% of traffic)
```json
{
  "event": "tool_sequence",
  "properties": {
    "previousTool": "search_nodes",
    "currentTool": "get_node_info",
    "timeDelta": 1250,
    "isSlowTransition": false,
    "sequence": "search_nodes->get_node_info"
  }
}
```
**Query:** Find common tool sequences
```sql
SELECT properties->>'sequence' as flow, COUNT(*) as count
FROM telemetry_events
WHERE event = 'tool_sequence' AND created_at >= NOW() - INTERVAL '30 days'
GROUP BY 1 ORDER BY 2 DESC LIMIT 20;
```

---

### Error & Validation Events

#### `error_occurred` (10-15% of traffic)
```json
{
  "event": "error_occurred",
  "properties": {
    "errorType": "validation_error",
    "context": "Node config failed [KEY]",
    "tool": "config_validator",
    "error": "[SANITIZED] type error",
    "mcpMode": "stdio",
    "platform": "darwin"
  }
}
```
**Query:** Error frequency by type
```sql
SELECT
  properties->>'errorType' as error_type,
  COUNT(*) as frequency,
  COUNT(DISTINCT user_id) as affected_users
FROM telemetry_events
WHERE event = 'error_occurred' AND created_at >= NOW() - INTERVAL '24 hours'
GROUP BY 1 ORDER BY 2 DESC;
```

#### `validation_details` (5-10% of traffic)
```json
{
  "event": "validation_details",
  "properties": {
    "nodeType": "nodes_base_httpRequest",
    "errorType": "required_field_missing",
    "errorCategory": "required_field_error",
    "details": { /* error details */ }
  }
}
```
**Query:** Validation errors by node type
```sql
SELECT
  properties->>'nodeType' as node_type,
  properties->>'errorType' as error_type,
  COUNT(*) as count
FROM telemetry_events
WHERE event = 'validation_details' AND created_at >= NOW() - INTERVAL '7 days'
GROUP BY 1, 2 ORDER BY 3 DESC;
```

---

### Workflow Events

#### `workflow_created`
```json
{
  "event": "workflow_created",
  "properties": {
    "nodeCount": 3,
    "nodeTypes": 2,
    "complexity": "simple",
    "hasTrigger": true,
    "hasWebhook": false
  }
}
```
**Query:** Workflow creation trends
```sql
SELECT
  DATE(created_at) as date,
  COUNT(*) as workflows_created,
  AVG((properties->>'nodeCount')::int) as avg_nodes,
  COUNT(*) FILTER(WHERE properties->>'complexity' = 'simple') as simple_count
FROM telemetry_events
WHERE event = 'workflow_created' AND created_at >= NOW() - INTERVAL '30 days'
GROUP BY 1 ORDER BY 1;
```

#### `workflow_validation_failed`
```json
{
  "event": "workflow_validation_failed",
  "properties": {
    "nodeCount": 5
  }
}
```
**Query:** Validation failure rate
```sql
SELECT
  COUNT(*) FILTER(WHERE event = 'workflow_created') as successful,
  COUNT(*) FILTER(WHERE event = 'workflow_validation_failed') as failed,
  ROUND(100.0 * COUNT(*) FILTER(WHERE event = 'workflow_validation_failed')
        / NULLIF(COUNT(*), 0), 2) as failure_rate
FROM telemetry_events
WHERE created_at >= NOW() - INTERVAL '7 days'
  AND event IN ('workflow_created', 'workflow_validation_failed');
```

---

### Session & System Events

#### `session_start`
```json
{
  "event": "session_start",
  "properties": {
    "version": "2.22.15",
    "platform": "darwin",
    "arch": "arm64",
    "nodeVersion": "v18.17.0",
    "isDocker": false,
    "cloudPlatform": null,
    "mcpMode": "stdio",
    "startupDurationMs": 1234
  }
}
```
**Query:** Platform distribution
```sql
SELECT
  properties->>'platform' as platform,
  properties->>'arch' as arch,
  COUNT(*) as sessions,
  AVG((properties->>'startupDurationMs')::int) as avg_startup_ms
FROM telemetry_events
WHERE event = 'session_start' AND created_at >= NOW() - INTERVAL '30 days'
GROUP BY 1, 2 ORDER BY 3 DESC;
```

---

## Workflow Metadata Table Queries

### Workflow Complexity Distribution
```sql
SELECT
  complexity,
  COUNT(*) as count,
  AVG(node_count) as avg_nodes,
  MAX(node_count) as max_nodes
FROM telemetry_workflows
GROUP BY complexity
ORDER BY count DESC;
```

### Most Common Node Type Combinations
```sql
SELECT
  node_types,
  COUNT(*) as frequency
FROM telemetry_workflows
GROUP BY node_types
ORDER BY frequency DESC
LIMIT 20;
```

### Workflows with Triggers vs Webhooks
```sql
SELECT
  has_trigger,
  has_webhook,
  COUNT(*) as count,
  ROUND(100.0 * COUNT(*) / (SELECT COUNT(*) FROM telemetry_workflows), 2) as percentage
FROM telemetry_workflows
GROUP BY 1, 2;
```

### Deduplicated Workflows (by hash)
```sql
SELECT
  COUNT(DISTINCT workflow_hash) as unique_workflows,
  COUNT(*) as total_rows,
  COUNT(DISTINCT user_id) as unique_users
FROM telemetry_workflows;
```

---

## Common Analysis Patterns

### 1. User Journey Analysis
```sql
-- Tool usage patterns for a user (anonymized)
WITH user_events AS (
  SELECT
    user_id,
    event,
    properties->>'tool' as tool,
    created_at,
    LAG(event) OVER(PARTITION BY user_id ORDER BY created_at) as prev_event
  FROM telemetry_events
  WHERE event IN ('tool_used', 'tool_sequence')
    AND created_at >= NOW() - INTERVAL '7 days'
)
SELECT
  prev_event,
  event,
  COUNT(*) as transitions
FROM user_events
WHERE prev_event IS NOT NULL
GROUP BY 1, 2
ORDER BY 3 DESC
LIMIT 20;
```

### 2. Performance Trends
```sql
-- Tool execution performance over time
WITH perf_data AS (
  SELECT
    properties->>'tool' as tool,
    (properties->>'duration')::int as duration,
    DATE(created_at) as date
  FROM telemetry_events
  WHERE event = 'tool_used'
    AND created_at >= NOW() - INTERVAL '30 days'
)
SELECT
  date,
  tool,
  COUNT(*) as executions,
  AVG(duration)::INTEGER as avg_duration_ms,
  PERCENTILE_CONT(0.95) WITHIN GROUP(ORDER BY duration) as p95_duration_ms,
  MAX(duration) as max_duration_ms
FROM perf_data
GROUP BY date, tool
ORDER BY date DESC, tool;
```

### 3. Error Analysis with Context
```sql
-- Recent errors with affected tools
SELECT
  properties->>'errorType' as error_type,
  properties->>'tool' as affected_tool,
  properties->>'context' as context,
  COUNT(*) as occurrences,
  MAX(created_at) as most_recent,
  COUNT(DISTINCT user_id) as users_affected
FROM telemetry_events
WHERE event = 'error_occurred'
  AND created_at >= NOW() - INTERVAL '24 hours'
GROUP BY 1, 2, 3
ORDER BY 4 DESC, 5 DESC;
```

### 4. Node Configuration Patterns
```sql
-- Most configured nodes and their complexity
WITH config_data AS (
  SELECT
    properties->>'nodeType' as node_type,
    (properties->>'propertiesSet')::int as props_set,
    properties->>'usedDefaults' = 'true' as used_defaults
  FROM telemetry_events
  WHERE event = 'node_configuration'
    AND created_at >= NOW() - INTERVAL '30 days'
)
SELECT
  node_type,
  COUNT(*) as configurations,
  AVG(props_set)::INTEGER as avg_props_set,
  ROUND(100.0 * SUM(CASE WHEN used_defaults THEN 1 ELSE 0 END)
        / COUNT(*), 2) as default_usage_rate
FROM config_data
GROUP BY node_type
ORDER BY 2 DESC
LIMIT 20;
```

### 5. Search Effectiveness
```sql
-- Search queries and their success
SELECT
  properties->>'searchType' as search_type,
  COUNT(*) as total_searches,
  COUNT(*) FILTER(WHERE (properties->>'hasResults')::boolean) as with_results,
  ROUND(100.0 * COUNT(*) FILTER(WHERE (properties->>'hasResults')::boolean)
        / COUNT(*), 2) as success_rate,
  AVG((properties->>'resultsFound')::int) as avg_results
FROM telemetry_events
WHERE event = 'search_query'
  AND created_at >= NOW() - INTERVAL '7 days'
GROUP BY 1
ORDER BY 2 DESC;
```

---

## Data Size Estimates

### Current Data Volume
- **Total Events:** ~276K rows
- **Size per Event:** ~200 bytes (average)
- **Total Size (events):** ~55 MB

- **Total Workflows:** ~6.5K rows
- **Size per Workflow:** ~2 KB (sanitized)
- **Total Size (workflows):** ~13 MB

**Total Current Storage:** ~68 MB

### Growth Projections
- **Daily Events:** ~1,000-2,000
- **Monthly Growth:** ~30-60 MB
- **Annual Growth:** ~360-720 MB

---

## Helpful Constants

### Event Type Values
```
tool_used
tool_sequence
error_occurred
validation_details
node_configuration
performance_metric
search_query
workflow_created
workflow_validation_failed
session_start
startup_completed
startup_error
```

### Complexity Values
```
'simple'
'medium'
'complex'
```

### Validation Status Values (for mutations)
```
'valid'
'invalid'
'unknown'
```

### Instruction Type Values (for mutations)
```
'ai_generated'
'user_provided'
'auto_fix'
'validation_correction'
```

---

## Tips & Tricks

### Finding Zero-Result Searches
```sql
SELECT properties->>'query' as search_term, COUNT(*) as attempts
FROM telemetry_events
WHERE event = 'search_query'
  AND (properties->>'isZeroResults')::boolean = true
  AND created_at >= NOW() - INTERVAL '7 days'
GROUP BY 1 ORDER BY 2 DESC;
```

### Identifying Slow Operations
```sql
SELECT
  properties->>'operation' as operation,
  COUNT(*) as count,
  PERCENTILE_CONT(0.99) WITHIN GROUP(ORDER BY (properties->>'duration')::int) as p99_ms
FROM telemetry_events
WHERE event = 'performance_metric'
  AND created_at >= NOW() - INTERVAL '7 days'
GROUP BY 1
HAVING PERCENTILE_CONT(0.99) WITHIN GROUP(ORDER BY (properties->>'duration')::int) > 1000
ORDER BY 3 DESC;
```

### User Retention Analysis
```sql
-- Active users by week
WITH weekly_users AS (
  SELECT
    DATE_TRUNC('week', created_at) as week,
    COUNT(DISTINCT user_id) as active_users
  FROM telemetry_events
  WHERE created_at >= NOW() - INTERVAL '90 days'
  GROUP BY 1
)
SELECT week, active_users
FROM weekly_users
ORDER BY week DESC;
```

### Platform Usage Breakdown
```sql
SELECT
  properties->>'platform' as platform,
  properties->>'arch' as architecture,
  COALESCE(properties->>'cloudPlatform', 'local') as deployment,
  COUNT(DISTINCT user_id) as unique_users
FROM telemetry_events
WHERE event = 'session_start'
  AND created_at >= NOW() - INTERVAL '30 days'
GROUP BY 1, 2, 3
ORDER BY 4 DESC;
```

---

## File References for Development

### Source Code
- **Types:** `/Users/romualdczlonkowski/Pliki/n8n-mcp/n8n-mcp/src/telemetry/telemetry-types.ts`
- **Manager:** `/Users/romualdczlonkowski/Pliki/n8n-mcp/n8n-mcp/src/telemetry/telemetry-manager.ts`
- **Tracker:** `/Users/romualdczlonkowski/Pliki/n8n-mcp/n8n-mcp/src/telemetry/event-tracker.ts`
- **Processor:** `/Users/romualdczlonkowski/Pliki/n8n-mcp/n8n-mcp/src/telemetry/batch-processor.ts`

### Documentation
- **Full Analysis:** `/Users/romualdczlonkowski/Pliki/n8n-mcp/n8n-mcp/TELEMETRY_ANALYSIS.md`
- **Mutation Spec:** `/Users/romualdczlonkowski/Pliki/n8n-mcp/n8n-mcp/TELEMETRY_MUTATION_SPEC.md`
- **This Guide:** `/Users/romualdczlonkowski/Pliki/n8n-mcp/n8n-mcp/TELEMETRY_QUICK_REFERENCE.md`

---

*Last Updated: November 12, 2025*
