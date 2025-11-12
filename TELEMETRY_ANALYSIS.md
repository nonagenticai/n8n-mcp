# N8N-MCP Telemetry Database Analysis

**Analysis Date:** November 12, 2025
**Analyst Role:** Telemetry Data Analyst
**Project:** n8n-mcp

## Executive Summary

The n8n-mcp project has a comprehensive telemetry system that tracks:
- **Tool usage patterns** (which tools are used, success rates, performance)
- **Workflow creation and validation** (workflow structure, complexity, node types)
- **User sessions and engagement** (startup metrics, session data)
- **Error patterns** (error types, affected tools, categorization)
- **Performance metrics** (operation duration, tool sequences, latency)

**Current Infrastructure:**
- **Backend:** Supabase PostgreSQL (hardcoded: `ydyufsohxdfpopqbubwk.supabase.co`)
- **Tables:** 2 main event tables + workflow metadata
- **Event Tracking:** SDK-based with batch processing (5s flush interval)
- **Privacy:** PII sanitization, no user credentials or sensitive data stored

---

## 1. Schema Analysis

### 1.1 Current Table Structures

#### `telemetry_events` (Primary Event Table)
**Purpose:** Tracks all discrete user interactions and system events

```sql
-- Inferred structure based on batch processor (telemetry_events table)
-- Columns inferred from TelemetryEvent interface:
-- - id: UUID (primary key, auto-generated)
-- - user_id: TEXT (anonymized user identifier)
-- - event: TEXT (event type name)
-- - properties: JSONB (flexible event-specific data)
-- - created_at: TIMESTAMP (server-side timestamp)
```

**Data Model:**
```typescript
interface TelemetryEvent {
  user_id: string;        // Anonymized user ID
  event: string;          // Event type (see section 1.2)
  properties: Record<string, any>;  // Event-specific metadata
  created_at?: string;    // ISO 8601 timestamp
}
```

**Rows Estimate:** 276K+ events (based on prompt description)

---

#### `telemetry_workflows` (Workflow Metadata Table)
**Purpose:** Stores workflow structure analysis and complexity metrics

```sql
-- Structure inferred from WorkflowTelemetry interface:
-- - id: UUID (primary key)
-- - user_id: TEXT
-- - workflow_hash: TEXT (UNIQUE, SHA-256 hash of normalized workflow)
-- - node_count: INTEGER
-- - node_types: TEXT[] (PostgreSQL array or JSON)
-- - has_trigger: BOOLEAN
-- - has_webhook: BOOLEAN
-- - complexity: TEXT CHECK IN ('simple', 'medium', 'complex')
-- - sanitized_workflow: JSONB (stripped workflow for pattern analysis)
-- - created_at: TIMESTAMP DEFAULT NOW()
```

**Data Model:**
```typescript
interface WorkflowTelemetry {
  user_id: string;
  workflow_hash: string;      // SHA-256 hash, unique constraint
  node_count: number;
  node_types: string[];       // e.g., ["n8n-nodes-base.httpRequest", ...]
  has_trigger: boolean;
  has_webhook: boolean;
  complexity: 'simple' | 'medium' | 'complex';
  sanitized_workflow: {
    nodes: any[];
    connections: any;
  };
  created_at?: string;
}
```

**Rows Estimate:** 6.5K+ unique workflows (based on prompt description)

---

### 1.2 Local SQLite Database (n8n-mcp Internal)

The project maintains a **SQLite database** (`src/database/schema.sql`) for:
- Node metadata (525 nodes, 263 AI-tool-capable)
- Workflow templates (pre-built examples)
- Node versions (versioning support)
- Property tracking (for configuration analysis)

**Note:** This is **separate from Supabase telemetry** - it's the knowledge base, not the analytics store.

---

## 2. Event Distribution Analysis

### 2.1 Tracked Event Types

Based on source code analysis (`event-tracker.ts`):

| Event Type | Purpose | Frequency | Properties |
|---|---|---|---|
| **tool_used** | Tool execution | High | `tool`, `success`, `duration` |
| **workflow_created** | Workflow creation | Medium | `nodeCount`, `nodeTypes`, `complexity`, `hasTrigger`, `hasWebhook` |
| **workflow_validation_failed** | Validation errors | Low-Medium | `nodeCount` |
| **error_occurred** | System errors | Variable | `errorType`, `context`, `tool`, `error`, `mcpMode`, `platform` |
| **session_start** | User session begin | Per-session | `version`, `platform`, `arch`, `nodeVersion`, `isDocker`, `cloudPlatform`, `startupDurationMs` |
| **startup_completed** | Server initialization success | Per-startup | `version` |
| **startup_error** | Initialization failures | Rare | `checkpoint`, `errorMessage`, `checkpointsPassed`, `startupDuration` |
| **search_query** | Search operations | Medium | `query`, `resultsFound`, `searchType`, `hasResults`, `isZeroResults` |
| **validation_details** | Configuration validation | Medium | `nodeType`, `errorType`, `errorCategory`, `details` |
| **tool_sequence** | Tool usage patterns | High | `previousTool`, `currentTool`, `timeDelta`, `isSlowTransition`, `sequence` |
| **node_configuration** | Node setup patterns | Medium | `nodeType`, `propertiesSet`, `usedDefaults`, `complexity` |
| **performance_metric** | Operation latency | Medium | `operation`, `duration`, `isSlow`, `isVerySlow`, `metadata` |

**Estimated Distribution (inferred from code):**
- 40-50%: `tool_used` (high-frequency tracking)
- 20-30%: `tool_sequence` (dependency tracking)
- 10-15%: `error_occurred` (error monitoring)
- 5-10%: `validation_details` (validation insights)
- 5-10%: `performance_metric` (performance analysis)
- 5-10%: Other events (search, workflow, session)

---

## 3. Workflow Operations Analysis

### 3.1 Current Workflow Tracking

**Workflows ARE tracked** but with **limited mutation data:**

```typescript
// Current: Basic workflow creation event
{
  event: 'workflow_created',
  properties: {
    nodeCount: 5,
    nodeTypes: ['n8n-nodes-base.httpRequest', ...],
    complexity: 'medium',
    hasTrigger: true,
    hasWebhook: false
  }
}

// Current: Full workflow snapshot stored separately
{
  workflow_hash: 'sha256hash...',
  node_count: 5,
  node_types: [...],
  sanitized_workflow: {
    nodes: [{ type, name, position }, ...],
    connections: { ... }
  }
}
```

**Missing Data for Workflow Mutations:**
- No "before" state tracking
- No "after" state tracking
- No change instructions/transformation descriptions
- No diff/delta operations recorded
- No workflow modification event types

---

## 4. Data Samples & Examples

### 4.1 Sample Telemetry Events

**Tool Usage Event:**
```json
{
  "user_id": "user_123_anonymized",
  "event": "tool_used",
  "properties": {
    "tool": "get_node_info",
    "success": true,
    "duration": 245
  },
  "created_at": "2025-11-12T10:30:45.123Z"
}
```

**Tool Sequence Event:**
```json
{
  "user_id": "user_123_anonymized",
  "event": "tool_sequence",
  "properties": {
    "previousTool": "search_nodes",
    "currentTool": "get_node_info",
    "timeDelta": 1250,
    "isSlowTransition": false,
    "sequence": "search_nodes->get_node_info"
  },
  "created_at": "2025-11-12T10:30:46.373Z"
}
```

**Workflow Creation Event:**
```json
{
  "user_id": "user_123_anonymized",
  "event": "workflow_created",
  "properties": {
    "nodeCount": 3,
    "nodeTypes": 2,
    "complexity": "simple",
    "hasTrigger": true,
    "hasWebhook": false
  },
  "created_at": "2025-11-12T10:35:12.456Z"
}
```

**Error Event:**
```json
{
  "user_id": "user_123_anonymized",
  "event": "error_occurred",
  "properties": {
    "errorType": "validation_error",
    "context": "Node configuration failed [KEY]",
    "tool": "config_validator",
    "error": "[SANITIZED] type error",
    "mcpMode": "stdio",
    "platform": "darwin"
  },
  "created_at": "2025-11-12T10:36:01.789Z"
}
```

**Workflow Stored Record:**
```json
{
  "user_id": "user_123_anonymized",
  "workflow_hash": "f1a9d5e2c4b8...",
  "node_count": 3,
  "node_types": [
    "n8n-nodes-base.webhook",
    "n8n-nodes-base.httpRequest",
    "n8n-nodes-base.slack"
  ],
  "has_trigger": true,
  "has_webhook": true,
  "complexity": "medium",
  "sanitized_workflow": {
    "nodes": [
      {
        "type": "n8n-nodes-base.webhook",
        "name": "webhook",
        "position": [250, 300]
      },
      {
        "type": "n8n-nodes-base.httpRequest",
        "name": "HTTP Request",
        "position": [450, 300]
      },
      {
        "type": "n8n-nodes-base.slack",
        "name": "Send Message",
        "position": [650, 300]
      }
    ],
    "connections": {
      "webhook": { "main": [[{"node": "HTTP Request", "output": 0}]] },
      "HTTP Request": { "main": [[{"node": "Send Message", "output": 0}]] }
    }
  },
  "created_at": "2025-11-12T10:35:12.456Z"
}
```

---

## 5. Missing Data for N8N-Fixer Dataset

### 5.1 Critical Gaps for Workflow Mutation Tracking

To support the n8n-fixer dataset requirement (before workflow → instruction → after workflow), the following data is **currently missing:**

#### Gap 1: No Mutation Events
```
MISSING: Events specifically for workflow modifications
- No "workflow_modified" event type
- No "workflow_patch_applied" event type
- No "workflow_instruction_executed" event type
```

#### Gap 2: No Before/After Snapshots
```
MISSING: Complete workflow states before and after changes
Current: Only stores sanitized_workflow (minimal structure)
Needed: Full workflow JSON including:
  - Complete node configurations
  - All node properties
  - Expression formulas
  - Credentials references
  - Settings
  - Metadata
```

#### Gap 3: No Instruction Data
```
MISSING: The transformation instructions/prompts
- No field to store the "before" instruction
- No field for the AI-generated fix/modification instruction
- No field for the "after" state expectation
```

#### Gap 4: No Diff/Delta Recording
```
MISSING: Specific changes made
- No operation logs (which nodes changed, how)
- No property-level diffs
- No connection modifications tracking
- No validation state transitions
```

#### Gap 5: No Workflow Mutation Success Metrics
```
MISSING: Outcome tracking
- No "mutation_success" or "mutation_failed" event
- No validation result before/after comparison
- No user satisfaction feedback
- No error rate for auto-fixed workflows
```

---

### 5.2 Proposed Schema Additions

To support n8n-fixer dataset collection, add:

#### New Table: `workflow_mutations`
```sql
CREATE TABLE IF NOT EXISTS workflow_mutations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,           -- n8n workflow ID (optional if new)

  -- Before state
  before_workflow_json JSONB NOT NULL, -- Complete workflow before mutation
  before_workflow_hash TEXT NOT NULL,  -- SHA-256 of before state
  before_validation_status TEXT,       -- 'valid', 'invalid', 'unknown'
  before_error_summary TEXT,           -- Comma-separated error types

  -- Mutation details
  instruction TEXT,                    -- AI instruction or user prompt
  instruction_type TEXT CHECK(instruction_type IN (
    'ai_generated',
    'user_provided',
    'auto_fix',
    'validation_correction'
  )),
  mutation_source TEXT,                -- Tool/agent that created instruction

  -- After state
  after_workflow_json JSONB NOT NULL,  -- Complete workflow after mutation
  after_workflow_hash TEXT NOT NULL,   -- SHA-256 of after state
  after_validation_status TEXT,        -- 'valid', 'invalid', 'unknown'
  after_error_summary TEXT,            -- Errors remaining after fix

  -- Mutation metadata
  nodes_modified TEXT[],               -- Array of modified node IDs
  connections_modified BOOLEAN,        -- Were connections changed?
  properties_modified TEXT[],          -- Property paths that changed
  num_changes INTEGER,                 -- Total number of changes
  complexity_before TEXT,              -- 'simple', 'medium', 'complex'
  complexity_after TEXT,

  -- Outcome tracking
  mutation_success BOOLEAN,            -- Did it achieve desired state?
  validation_improved BOOLEAN,         -- Fewer errors after?
  user_approved BOOLEAN,               -- User accepted the change?

  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_mutations_user_id ON workflow_mutations(user_id);
CREATE INDEX idx_mutations_workflow_id ON workflow_mutations(workflow_id);
CREATE INDEX idx_mutations_created_at ON workflow_mutations(created_at);
CREATE INDEX idx_mutations_success ON workflow_mutations(mutation_success);
```

#### New Event Type: `workflow_mutation`
```typescript
interface WorkflowMutationEvent extends TelemetryEvent {
  event: 'workflow_mutation';
  properties: {
    workflowId: string;
    beforeHash: string;
    afterHash: string;
    instructionType: 'ai_generated' | 'user_provided' | 'auto_fix';
    nodesModified: number;
    propertiesChanged: number;
    mutationSuccess: boolean;
    validationImproved: boolean;
    errorsBefore: number;
    errorsAfter: number;
  }
}
```

---

## 6. Current Data Capture Pipeline

### 6.1 Data Flow Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        User Interaction                         │
│   (Tool Usage, Workflow Creation, Error, Search, etc.)          │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│              TelemetryEventTracker                              │
│  ├─ trackToolUsage()                                            │
│  ├─ trackWorkflowCreation()                                     │
│  ├─ trackError()                                                │
│  ├─ trackSearchQuery()                                          │
│  └─ trackValidationDetails()                                    │
│                                                                  │
│  Queuing:                                                        │
│  ├─ this.eventQueue: TelemetryEvent[]                          │
│  └─ this.workflowQueue: WorkflowTelemetry[]                    │
└────────────────────────────┬────────────────────────────────────┘
                             │
                    (5-second interval)
                             │
┌────────────────────────────▼────────────────────────────────────┐
│           TelemetryBatchProcessor                               │
│  ├─ flushEvents()       → Supabase.insert(telemetry_events)    │
│  ├─ flushWorkflows()    → Supabase.insert(telemetry_workflows) │
│  ├─ Batching (max 50)                                           │
│  ├─ Deduplication (workflows by hash)                           │
│  ├─ Rate Limiting                                               │
│  ├─ Retry Logic (max 3 attempts)                                │
│  └─ Circuit Breaker                                             │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│            Supabase PostgreSQL                                  │
│  ├─ telemetry_events (276K+ rows)                              │
│  └─ telemetry_workflows (6.5K+ rows)                           │
│                                                                  │
│  URL: ydyufsohxdfpopqbubwk.supabase.co                         │
│  Tables: Public (anon key access)                              │
└─────────────────────────────────────────────────────────────────┘
```

---

### 6.2 Privacy & Sanitization

The system implements **multi-layer sanitization:**

```typescript
// Layer 1: Error Message Sanitization
sanitizeErrorMessage(errorMessage: string)
  ├─ Removes sensitive patterns (emails, keys, URLs)
  ├─ Prevents regex DoS attacks
  └─ Truncates to 500 chars

// Layer 2: Context Sanitization
sanitizeContext(context: string)
  ├─ [EMAIL] → email addresses
  ├─ [KEY]   → API keys (32+ char sequences)
  ├─ [URL]   → URLs
  └─ Truncates to 100 chars

// Layer 3: Workflow Sanitization
WorkflowSanitizer.sanitizeWorkflow(workflow)
  ├─ Removes credentials
  ├─ Removes sensitive properties
  ├─ Strips full node configurations
  ├─ Keeps only: type, name, position, input/output counts
  └─ Generates SHA-256 hash for deduplication
```

---

## 7. Recommendations for N8N-Fixer Dataset Implementation

### 7.1 Immediate Actions (Phase 1)

**1. Add Workflow Mutation Table**
```sql
-- Create workflow_mutations table (see Section 5.2)
-- Add indexes for user_id, workflow_id, created_at
-- Add unique constraint on (user_id, workflow_id, created_at)
```

**2. Extend TelemetryEvent Types**
```typescript
// In telemetry-types.ts
export interface WorkflowMutationEvent extends TelemetryEvent {
  event: 'workflow_mutation';
  properties: {
    // See Section 5.2 for full interface
  }
}
```

**3. Add Tracking Method to EventTracker**
```typescript
// In event-tracker.ts
trackWorkflowMutation(
  beforeWorkflow: any,
  instruction: string,
  afterWorkflow: any,
  instructionType: 'ai_generated' | 'user_provided' | 'auto_fix',
  success: boolean
): void
```

**4. Add Flushing Logic to BatchProcessor**
```typescript
// In batch-processor.ts
private async flushWorkflowMutations(
  mutations: WorkflowMutation[]
): Promise<boolean>
```

---

### 7.2 Integration Points

**Where to Capture Mutations:**

1. **AI Workflow Validation** (n8n_validate_workflow tool)
   - Before: Original workflow
   - Instruction: Validation errors + fix suggestion
   - After: Corrected workflow
   - Type: `auto_fix`

2. **Workflow Auto-Fix** (n8n_autofix_workflow tool)
   - Before: Broken workflow
   - Instruction: "Fix common validation errors"
   - After: Fixed workflow
   - Type: `auto_fix`

3. **Partial Workflow Updates** (n8n_update_partial_workflow tool)
   - Before: Current workflow
   - Instruction: Diff operations to apply
   - After: Updated workflow
   - Type: `user_provided` or `ai_generated`

4. **Manual User Edits** (if tracking enabled)
   - Before: User's workflow state
   - Instruction: User action/prompt
   - After: User's modified state
   - Type: `user_provided`

---

### 7.3 Data Quality Considerations

**When collecting mutation data:**

| Consideration | Recommendation |
|---|---|
| **Full Workflow Size** | Store compressed (gzip) for large workflows |
| **Sensitive Data** | Still sanitize credentials, even in mutations |
| **Hash Verification** | Use SHA-256 to verify data integrity |
| **Validation State** | Capture error types before/after (not details) |
| **Performance** | Compress mutations before storage if >500KB |
| **Deduplication** | Skip identical before/after pairs |
| **User Consent** | Ensure opt-in telemetry flag covers mutations |

---

### 7.4 Analysis Queries (Once Data Collected)

**Example queries for n8n-fixer dataset analysis:**

```sql
-- 1. Mutation success rate by instruction type
SELECT
  instruction_type,
  COUNT(*) as total_mutations,
  COUNT(*) FILTER (WHERE mutation_success = true) as successful,
  ROUND(100.0 * COUNT(*) FILTER (WHERE mutation_success = true)
        / COUNT(*), 2) as success_rate
FROM workflow_mutations
WHERE created_at >= NOW() - INTERVAL '30 days'
GROUP BY instruction_type
ORDER BY success_rate DESC;

-- 2. Most common workflow modifications
SELECT
  nodes_modified,
  COUNT(*) as frequency
FROM workflow_mutations
WHERE created_at >= NOW() - INTERVAL '30 days'
GROUP BY nodes_modified
ORDER BY frequency DESC
LIMIT 20;

-- 3. Validation improvement distribution
SELECT
  (errors_before - COALESCE(errors_after, 0)) as errors_fixed,
  COUNT(*) as count
FROM workflow_mutations
WHERE created_at >= NOW() - INTERVAL '30 days'
  AND validation_improved = true
GROUP BY errors_fixed
ORDER BY count DESC;

-- 4. Before/after complexity transitions
SELECT
  complexity_before,
  complexity_after,
  COUNT(*) as count
FROM workflow_mutations
WHERE created_at >= NOW() - INTERVAL '30 days'
GROUP BY complexity_before, complexity_after
ORDER BY count DESC;
```

---

## 8. Technical Implementation Details

### 8.1 Current Event Queue Configuration

```typescript
// From TELEMETRY_CONFIG in telemetry-types.ts
BATCH_FLUSH_INTERVAL: 5000,              // 5 seconds
EVENT_QUEUE_THRESHOLD: 10,               // Queue 10 events before flush
MAX_QUEUE_SIZE: 1000,                    // Max 1000 events in queue
MAX_BATCH_SIZE: 50,                      // Max 50 per batch
MAX_RETRIES: 3,                          // Retry failed sends 3x
RATE_LIMIT_WINDOW: 60000,                // 1 minute window
RATE_LIMIT_MAX_EVENTS: 100,              // Max 100 events/min
```

### 8.2 User Identification

- **Anonymous User ID:** Generated via TelemetryConfigManager
- **No Personal Data:** No email, name, or identifying information
- **Privacy-First:** User can disable telemetry via environment variable
- **Env Override:** `TELEMETRY_DISABLED=true` disables all tracking

### 8.3 Error Handling & Resilience

```
Circuit Breaker Pattern:
├─ Open: Stop sending for 1 minute after repeated failures
├─ Half-Open: Resume sending with caution
└─ Closed: Normal operation

Dead Letter Queue:
├─ Stores failed events temporarily
├─ Retries on next healthy flush
└─ Max 100 items (overflow discarded)

Rate Limiting:
├─ 100 events per minute per window
├─ Tools and Workflows exempt from limits
└─ Prevents overwhelming the backend
```

---

## 9. Conclusion

### Current State
The n8n-mcp telemetry system is **production-ready** with:
- 276K+ events tracked
- 6.5K+ unique workflows recorded
- Multi-layer privacy protection
- Robust batching and error handling

### Missing for N8N-Fixer Dataset
To build a high-quality "before/instruction/after" dataset:
1. **New table** for workflow mutations
2. **New event type** for mutation tracking
3. **Full workflow storage** (not sanitized)
4. **Instruction preservation** (capture user prompt/AI suggestion)
5. **Outcome metrics** (success/validation improvement)

### Next Steps
1. Create `workflow_mutations` table in Supabase (Phase 1)
2. Add tracking methods to TelemetryManager (Phase 1)
3. Instrument workflow modification tools (Phase 2)
4. Validate data quality with sample queries (Phase 2)
5. Begin dataset collection (Phase 3)

---

## Appendix: File References

**Key Source Files:**
- `/Users/romualdczlonkowski/Pliki/n8n-mcp/n8n-mcp/src/telemetry/telemetry-types.ts` - Type definitions
- `/Users/romualdczlonkowski/Pliki/n8n-mcp/n8n-mcp/src/telemetry/telemetry-manager.ts` - Main coordinator
- `/Users/romualdczlonkowski/Pliki/n8n-mcp/n8n-mcp/src/telemetry/event-tracker.ts` - Event tracking logic
- `/Users/romualdczlonkowski/Pliki/n8n-mcp/n8n-mcp/src/telemetry/batch-processor.ts` - Supabase integration
- `/Users/romualdczlonkowski/Pliki/n8n-mcp/n8n-mcp/src/database/schema.sql` - Local SQLite schema

**Database Credentials:**
- **Supabase URL:** `ydyufsohxdfpopqbubwk.supabase.co`
- **Anon Key:** (hardcoded in telemetry-types.ts line 105)
- **Tables:** `public.telemetry_events`, `public.telemetry_workflows`

---

*End of Analysis*
