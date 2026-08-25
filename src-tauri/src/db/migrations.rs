pub struct SqlMigration {
    pub version: i64,
    pub name: &'static str,
    pub sql: &'static str,
}

const CHATS_V1: &str = "
CREATE TABLE chats (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL,
    project_slug TEXT NOT NULL,
    project_root TEXT NOT NULL,
    title TEXT NOT NULL,
    mode TEXT NOT NULL,
    model TEXT NOT NULL,
    status TEXT NOT NULL,
    attention TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    forked_from TEXT,
    pinned INTEGER NOT NULL DEFAULT 0,
    pinned_at TEXT,
    prefix_snapshot TEXT,
    active_context TEXT,
    awaiting_plan_go TEXT,
    subagent_model TEXT,
    reasoning TEXT,
    subagent_reasoning TEXT,
    usage_totals TEXT
);

CREATE INDEX idx_chats_list ON chats (project_slug, pinned, updated_at DESC);
CREATE INDEX idx_chats_pinned ON chats (pinned);

CREATE TABLE chat_messages (
    id TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    role TEXT NOT NULL,
    parts_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    model TEXT,
    mention_highlights_json TEXT,
    harness_event_json TEXT,
    extras_json TEXT,
    PRIMARY KEY (chat_id, id),
    FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
    UNIQUE (chat_id, seq)
);

CREATE TABLE chat_usage_rows (
    id TEXT PRIMARY KEY NOT NULL,
    chat_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    record_json TEXT NOT NULL,
    at TEXT,
    FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
    UNIQUE (chat_id, seq)
);
";

const CHAT_MESSAGES_SEQ_PK_V3: &str = "
CREATE TABLE chat_messages_v3 (
    id TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    role TEXT NOT NULL,
    parts_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    model TEXT,
    mention_highlights_json TEXT,
    harness_event_json TEXT,
    extras_json TEXT,
    PRIMARY KEY (chat_id, seq),
    FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
);

INSERT INTO chat_messages_v3 (
    id, chat_id, seq, role, parts_json, created_at, model,
    mention_highlights_json, harness_event_json, extras_json
)
SELECT id, chat_id, seq, role, parts_json, created_at, model,
       mention_highlights_json, harness_event_json, extras_json
FROM chat_messages;

DROP TABLE chat_messages;
ALTER TABLE chat_messages_v3 RENAME TO chat_messages;
";

const WORKBENCH_V2: &str = "
CREATE TABLE workbench_tabs (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL,
    type TEXT NOT NULL,
    label TEXT NOT NULL,
    sort_order INTEGER NOT NULL,
    is_active INTEGER NOT NULL,
    payload_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE editor_view_state (
    project_id TEXT NOT NULL,
    path TEXT NOT NULL,
    view_state_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (project_id, path)
);

CREATE TABLE workbench_prefs (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
);
";

pub const MIGRATIONS: &[SqlMigration] = &[
    SqlMigration {
        version: 1,
        name: "chats",
        sql: CHATS_V1,
    },
    SqlMigration {
        version: 2,
        name: "workbench",
        sql: WORKBENCH_V2,
    },
    SqlMigration {
        version: 3,
        name: "chat_messages_seq_pk",
        sql: CHAT_MESSAGES_SEQ_PK_V3,
    },
];
