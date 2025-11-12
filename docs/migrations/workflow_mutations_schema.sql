-- Migration: Create workflow_mutations table for tracking partial update operations
-- Purpose: Capture workflow transformation data to improve partial updates tooling
-- Date: 2025-01-12

-- Create workflow_mutations table
CREATE TABLE IF NOT EXISTS workflow_mutations (
  -- Primary key
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- User identification (anonymized)
  user_id TEXT NOT NULL,
  session_id TEXT NOT NULL,

  -- Workflow snapshots (compressed JSONB)
  workflow_before JSONB NOT NULL,
  workflow_after JSONB NOT NULL,
  workflow_hash_before TEXT NOT NULL,
  workflow_hash_after TEXT NOT NULL,

  -- Intent capture
  user_intent TEXT NOT NULL,
  intent_classification TEXT,
  tool_name TEXT NOT NULL CHECK (tool_name IN ('n8n_update_partial_workflow', 'n8n_update_full_workflow')),

  -- Operations performed
  operations JSONB NOT NULL,
  operation_count INTEGER NOT NULL CHECK (operation_count >= 0),
  operation_types TEXT[] NOT NULL,

  -- Validation metrics
  validation_before JSONB,
  validation_after JSONB,
  validation_improved BOOLEAN,
  errors_resolved INTEGER DEFAULT 0 CHECK (errors_resolved >= 0),
  errors_introduced INTEGER DEFAULT 0 CHECK (errors_introduced >= 0),

  -- Change metrics
  nodes_added INTEGER DEFAULT 0 CHECK (nodes_added >= 0),
  nodes_removed INTEGER DEFAULT 0 CHECK (nodes_removed >= 0),
  nodes_modified INTEGER DEFAULT 0 CHECK (nodes_modified >= 0),
  connections_added INTEGER DEFAULT 0 CHECK (connections_added >= 0),
  connections_removed INTEGER DEFAULT 0 CHECK (connections_removed >= 0),
  properties_changed INTEGER DEFAULT 0 CHECK (properties_changed >= 0),

  -- Outcome tracking
  mutation_success BOOLEAN NOT NULL,
  mutation_error TEXT,

  -- Performance metrics
  duration_ms INTEGER CHECK (duration_ms >= 0),

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for efficient querying

-- Primary indexes for filtering
CREATE INDEX IF NOT EXISTS idx_workflow_mutations_user_id
  ON workflow_mutations(user_id);

CREATE INDEX IF NOT EXISTS idx_workflow_mutations_session_id
  ON workflow_mutations(session_id);

CREATE INDEX IF NOT EXISTS idx_workflow_mutations_created_at
  ON workflow_mutations(created_at DESC);

-- Intent and classification indexes
CREATE INDEX IF NOT EXISTS idx_workflow_mutations_intent_classification
  ON workflow_mutations(intent_classification)
  WHERE intent_classification IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_workflow_mutations_tool_name
  ON workflow_mutations(tool_name);

-- Operation analysis indexes
CREATE INDEX IF NOT EXISTS idx_workflow_mutations_operation_types
  ON workflow_mutations USING GIN(operation_types);

CREATE INDEX IF NOT EXISTS idx_workflow_mutations_operation_count
  ON workflow_mutations(operation_count);

-- Outcome indexes
CREATE INDEX IF NOT EXISTS idx_workflow_mutations_success
  ON workflow_mutations(mutation_success);

CREATE INDEX IF NOT EXISTS idx_workflow_mutations_validation_improved
  ON workflow_mutations(validation_improved)
  WHERE validation_improved IS NOT NULL;

-- Change metrics indexes
CREATE INDEX IF NOT EXISTS idx_workflow_mutations_nodes_added
  ON workflow_mutations(nodes_added)
  WHERE nodes_added > 0;

CREATE INDEX IF NOT EXISTS idx_workflow_mutations_nodes_modified
  ON workflow_mutations(nodes_modified)
  WHERE nodes_modified > 0;

-- Hash indexes for deduplication
CREATE INDEX IF NOT EXISTS idx_workflow_mutations_hash_before
  ON workflow_mutations(workflow_hash_before);

CREATE INDEX IF NOT EXISTS idx_workflow_mutations_hash_after
  ON workflow_mutations(workflow_hash_after);

-- Composite indexes for common queries

-- Find successful mutations by intent classification
CREATE INDEX IF NOT EXISTS idx_workflow_mutations_success_classification
  ON workflow_mutations(mutation_success, intent_classification)
  WHERE intent_classification IS NOT NULL;

-- Find mutations that improved validation
CREATE INDEX IF NOT EXISTS idx_workflow_mutations_validation_success
  ON workflow_mutations(validation_improved, mutation_success)
  WHERE validation_improved IS TRUE;

-- Find mutations by user and time range
CREATE INDEX IF NOT EXISTS idx_workflow_mutations_user_time
  ON workflow_mutations(user_id, created_at DESC);

-- Find mutations with significant changes
CREATE INDEX IF NOT EXISTS idx_workflow_mutations_significant_changes
  ON workflow_mutations(nodes_added + nodes_removed + nodes_modified)
  WHERE (nodes_added + nodes_removed + nodes_modified) > 0;

-- Comments for documentation
COMMENT ON TABLE workflow_mutations IS
  'Tracks workflow mutations from partial update operations to analyze transformation patterns and improve tooling';

COMMENT ON COLUMN workflow_mutations.workflow_before IS
  'Complete workflow JSON before mutation (sanitized, credentials removed)';

COMMENT ON COLUMN workflow_mutations.workflow_after IS
  'Complete workflow JSON after mutation (sanitized, credentials removed)';

COMMENT ON COLUMN workflow_mutations.user_intent IS
  'User instruction or intent for the workflow change (sanitized for PII)';

COMMENT ON COLUMN workflow_mutations.intent_classification IS
  'Classified pattern: add_functionality, modify_configuration, rewire_logic, fix_validation, cleanup, unknown';

COMMENT ON COLUMN workflow_mutations.operations IS
  'Array of diff operations performed (addNode, updateNode, addConnection, etc.)';

COMMENT ON COLUMN workflow_mutations.validation_improved IS
  'Whether the mutation reduced validation errors (NULL if validation data unavailable)';

-- Row-level security (optional - uncomment if using Supabase auth)
-- ALTER TABLE workflow_mutations ENABLE ROW LEVEL SECURITY;

-- Create policy for anonymous inserts (required for telemetry)
-- CREATE POLICY "Allow anonymous inserts"
--   ON workflow_mutations
--   FOR INSERT
--   TO anon
--   WITH CHECK (true);

-- Create policy for authenticated reads (for analysis)
-- CREATE POLICY "Allow authenticated reads"
--   ON workflow_mutations
--   FOR SELECT
--   TO authenticated
--   USING (true);
