# N8N-Fixer Dataset: Telemetry Infrastructure Analysis

**Analysis Completed:** November 12, 2025
**Scope:** N8N-MCP Telemetry Database Schema & Workflow Mutation Tracking
**Status:** Ready for Implementation Planning

---

## Overview

This document synthesizes a comprehensive analysis of the n8n-mcp telemetry infrastructure and provides actionable recommendations for building an n8n-fixer dataset with before/instruction/after workflow snapshots.

**Key Findings:**
- Telemetry system is production-ready with 276K+ events tracked
- Supabase PostgreSQL backend stores all events
- Current system **does NOT capture workflow mutations** (before→after transitions)
- Requires new table + instrumentation to collect fixer dataset
- Implementation is straightforward with 3-4 weeks of development

---

## Documentation Map

### 1. TELEMETRY_ANALYSIS.md (Primary Reference)
**Length:** 720 lines | **Read Time:** 20-30 minutes
**Contains:**
- Complete schema analysis (tables, columns, types)
- All 12 event types with examples
- Current workflow tracking capabilities
- Missing data for mutation tracking
- Recommended schema additions
- Technical implementation details

**Start Here If:** You need the complete picture of current capabilities and gaps

---

### 2. TELEMETRY_MUTATION_SPEC.md (Implementation Blueprint)
**Length:** 918 lines | **Read Time:** 30-40 minutes
**Contains:**
- Detailed SQL schema for `workflow_mutations` table
- Complete TypeScript interfaces and types
- Integration points with existing tools
- Mutation analyzer service specification
- Batch processor extensions
- Query examples for dataset analysis

**Start Here If:** You're ready to implement the mutation tracking system

---

### 3. TELEMETRY_QUICK_REFERENCE.md (Developer Guide)
**Length:** 503 lines | **Read Time:** 10-15 minutes
**Contains:**
- Supabase connection details
- Common queries and patterns
- Performance tips and tricks
- Code file references
- Quick lookup for event types

**Start Here If:** You need to query existing telemetry data or reference specific details

---

### 4. TELEMETRY_QUICK_REFERENCE.md (Archive)
These documents from November 8 contain additional context:
- `TELEMETRY_ANALYSIS_REPORT.md` - Executive summary with visualizations
- `TELEMETRY_EXECUTIVE_SUMMARY.md` - High-level overview
- `TELEMETRY_TECHNICAL_DEEP_DIVE.md` - Architecture details
- `TELEMETRY_DATA_FOR_VISUALIZATION.md` - Sample data for dashboards

---

## Current State Summary

### Telemetry Backend
```
URL:     https://ydyufsohxdfpopqbubwk.supabase.co
Database: PostgreSQL
Tables:   telemetry_events (276K rows)
          telemetry_workflows (6.5K rows)
Privacy:  PII sanitization enabled
Scope:    Anonymous tool usage, workflows, errors
```

### Tracked Event Categories
1. **Tool Usage** (40-50%) - Which tools users employ
2. **Tool Sequences** (20-30%) - How tools are chained together
3. **Errors** (10-15%) - Error types and context
4. **Validation** (5-10%) - Configuration validation details
5. **Workflows** (5-10%) - Workflow creation and structure
6. **Performance** (5-10%) - Operation latency
7. **Sessions** (misc) - User session metadata

### What's Missing for N8N-Fixer
```
MISSING: Workflow Mutation Events
- No before workflow capture
- No instruction/transformation storage
- No after workflow snapshot
- No mutation success metrics
- No validation improvement tracking
```

---

## Recommended Implementation Path

### Phase 1: Infrastructure (1-2 weeks)
1. Create `workflow_mutations` table in Supabase
   - See TELEMETRY_MUTATION_SPEC.md Section 2.1 for full SQL
   - Includes 20+ strategic indexes
   - Supports compression for large workflows

2. Update TypeScript types
   - New `WorkflowMutation` interface
   - New `WorkflowMutationEvent` event type
   - Mutation analyzer service

3. Add data validators
   - Hash verification
   - Deduplication logic
   - Size validation

---

### Phase 2: Core Integration (1-2 weeks)
1. Extend TelemetryManager
   - Add `trackWorkflowMutation()` method
   - Auto-flush mutations to prevent loss

2. Extend EventTracker
   - Add mutation queue
   - Mutation analyzer integration
   - Validation state detection

3. Extend BatchProcessor
   - Flush workflow mutations to Supabase
   - Retry logic and dead letter queue
   - Performance monitoring

---

### Phase 3: Tool Integration (1 week)
Instrument 3 key tools to capture mutations:

1. **n8n_autofix_workflow**
   - Before: Broken workflow
   - Instruction: "Auto-fix validation errors"
   - After: Fixed workflow
   - Type: `auto_fix`

2. **n8n_update_partial_workflow**
   - Before: Current workflow
   - Instruction: Diff operations
   - After: Updated workflow
   - Type: `user_provided`

3. **Validation Engine** (if applicable)
   - Before: Invalid workflow
   - Instruction: Validation correction
   - After: Valid workflow
   - Type: `validation_correction`

---

### Phase 4: Validation & Analysis (1 week)
1. Data quality verification
   - Hash validation
   - Size checks
   - Deduplication effectiveness

2. Sample query execution
   - Success rate by instruction type
   - Common mutations
   - Complexity impact

3. Dataset assessment
   - Volume estimates
   - Data distribution
   - Quality metrics

---

## Key Metrics You'll Collect

### Per Mutation Record
- **Identification:** User ID, Workflow ID, Timestamp
- **Before State:** Full workflow JSON, hash, validation status
- **Instruction:** The transformation prompt/directive
- **After State:** Full workflow JSON, hash, validation status
- **Changes:** Nodes modified, properties changed, connections modified
- **Outcome:** Success boolean, validation improvement, errors fixed

### Aggregate Analysis
```sql
-- Success rates by instruction type
SELECT instruction_type, COUNT(*) as count,
       ROUND(100.0 * COUNT(*) FILTER(WHERE mutation_success) / COUNT(*), 2) as success_rate
FROM workflow_mutations
GROUP BY instruction_type;

-- Validation improvement distribution
SELECT validation_errors_fixed, COUNT(*) as count
FROM workflow_mutations
WHERE validation_improved = true
GROUP BY 1
ORDER BY 2 DESC;

-- Complexity transitions
SELECT complexity_before, complexity_after, COUNT(*) as transitions
FROM workflow_mutations
GROUP BY 1, 2;
```

---

## Storage Requirements

### Data Size Estimates
```
Average Before Workflow:     10 KB
Average After Workflow:      10 KB
Average Instruction:         500 B
Indexes & Metadata:          5 KB
Per Mutation Total:          25 KB

Monthly Mutations (estimate): 10K-50K
Monthly Storage:             250 MB - 1.2 GB
Annual Storage:              3-14 GB
```

### Optimization Strategies
1. **Compression:** Gzip workflows >1MB
2. **Deduplication:** Skip identical before/after pairs
3. **Retention:** Define archival policy (90 days? 1 year?)
4. **Indexing:** Materialized views for common queries

---

## Data Safety & Privacy

### Current Protections
- User IDs are anonymized
- Credentials are stripped from workflows
- Email addresses are masked [EMAIL]
- API keys are masked [KEY]
- URLs are masked [URL]
- Error messages are sanitized

### For Mutations Table
- Continue PII sanitization
- Hash verification for integrity
- Size limits (10 MB per workflow with compression)
- User consent (telemetry opt-in)

---

## Integration Points

### Where to Add Tracking Calls
```typescript
// In n8n_autofix_workflow
await telemetry.trackWorkflowMutation(
  originalWorkflow,
  'Auto-fix validation errors',
  fixedWorkflow,
  { instructionType: 'auto_fix', success: true }
);

// In n8n_update_partial_workflow
await telemetry.trackWorkflowMutation(
  currentWorkflow,
  formatOperationsAsInstruction(operations),
  updatedWorkflow,
  { instructionType: 'user_provided' }
);
```

### No Breaking Changes
- Fully backward compatible
- Existing telemetry unaffected
- Optional feature (can disable if needed)
- Doesn't require version bump

---

## Success Criteria

### Phase 1 Complete When:
- [ ] `workflow_mutations` table created with all indexes
- [ ] TypeScript types defined and compiling
- [ ] Validators written and tested
- [ ] No schema changes needed (validated against use cases)

### Phase 2 Complete When:
- [ ] TelemetryManager has `trackWorkflowMutation()` method
- [ ] EventTracker queues mutations properly
- [ ] BatchProcessor flushes mutations to Supabase
- [ ] Integration tests pass

### Phase 3 Complete When:
- [ ] 3+ tools instrumented with tracking calls
- [ ] Manual testing shows mutations captured
- [ ] Sample mutations visible in Supabase
- [ ] No performance regression in tools

### Phase 4 Complete When:
- [ ] 100+ mutations collected and validated
- [ ] Sample queries execute correctly
- [ ] Data quality metrics acceptable
- [ ] Dataset ready for ML training

---

## File Structure for Implementation

```
src/telemetry/
├── telemetry-types.ts          (Update: Add WorkflowMutation interface)
├── telemetry-manager.ts        (Update: Add trackWorkflowMutation method)
├── event-tracker.ts            (Update: Add mutation tracking)
├── batch-processor.ts          (Update: Add flush mutations)
├── mutation-analyzer.ts        (NEW: Analyze workflow diffs)
├── mutation-validator.ts       (NEW: Validate mutation data)
└── index.ts                    (Update: Export new functions)

tests/
└── unit/telemetry/
    ├── mutation-analyzer.test.ts        (NEW)
    ├── mutation-validator.test.ts       (NEW)
    └── telemetry-integration.test.ts    (Update)
```

---

## Risk Assessment

### Low Risk
- No changes to existing event system
- Supabase table addition is non-breaking
- TypeScript types only (no runtime impact)

### Medium Risk
- Large workflows may impact performance if not compressed
- Storage costs if dataset grows faster than estimated
- Mitigation: Compression + retention policy

### High Risk
- None identified if implemented as specified

---

## Next Steps

1. **Review This Analysis**
   - Read TELEMETRY_ANALYSIS.md (main reference)
   - Review TELEMETRY_MUTATION_SPEC.md (implementation guide)

2. **Plan Implementation**
   - Estimate developer hours
   - Assign implementation tasks
   - Create Jira tickets or equivalent

3. **Phase 1: Create Infrastructure**
   - Create Supabase table
   - Define TypeScript types
   - Write validators

4. **Phase 2: Integrate Core**
   - Extend telemetry system
   - Write integration tests

5. **Phase 3: Instrument Tools**
   - Add tracking calls to 3+ mutation sources
   - Test end-to-end

6. **Phase 4: Validate**
   - Collect sample data
   - Run analysis queries
   - Begin dataset collection

---

## Questions to Answer Before Starting

1. **Data Retention:** How long should mutations be kept? (90 days? 1 year?)
2. **Storage Budget:** What's acceptable monthly storage cost?
3. **Workflow Size:** What's the max workflow size to store? (with or without compression?)
4. **Dataset Timeline:** When do you need first 1K/10K/100K samples?
5. **Privacy:** Any additional PII to sanitize beyond current approach?
6. **User Consent:** Should mutation tracking be separate opt-in from telemetry?

---

## Useful Commands

### View Current Telemetry Tables
```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name LIKE 'telemetry%';
```

### Count Current Events
```sql
SELECT event, COUNT(*) FROM telemetry_events
GROUP BY event ORDER BY 2 DESC;
```

### Check Workflow Deduplication Rate
```sql
SELECT COUNT(*) as total,
       COUNT(DISTINCT workflow_hash) as unique
FROM telemetry_workflows;
```

---

## Document References

All documents are in the n8n-mcp repository root:

| Document | Purpose | Read Time |
|----------|---------|-----------|
| TELEMETRY_ANALYSIS.md | Complete schema & event analysis | 20-30 min |
| TELEMETRY_MUTATION_SPEC.md | Implementation specification | 30-40 min |
| TELEMETRY_QUICK_REFERENCE.md | Developer quick lookup | 10-15 min |
| TELEMETRY_ANALYSIS_REPORT.md | Executive summary (archive) | 15-20 min |
| TELEMETRY_TECHNICAL_DEEP_DIVE.md | Architecture (archive) | 20-25 min |

---

## Summary

The n8n-mcp telemetry infrastructure is mature, privacy-conscious, and well-designed. It currently tracks user interactions effectively but lacks workflow mutation capture needed for the n8n-fixer dataset.

**The solution is straightforward:** Add a single `workflow_mutations` table, extend the tracking system, and instrument 3-4 key tools.

**Implementation effort:** 3-4 weeks for a complete, production-ready system.

**Result:** A high-quality dataset of before/instruction/after workflow transformations suitable for training ML models to fix broken n8n workflows automatically.

---

**Analysis completed by:** Telemetry Data Analyst
**Date:** November 12, 2025
**Status:** Ready for implementation planning

For questions or clarifications, refer to the detailed specifications or raise issues on GitHub.
