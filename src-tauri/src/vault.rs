use std::path::{Path, PathBuf};
use rusqlite::{Connection, Result};

pub struct VaultManager {
    db_path: PathBuf,
}

impl VaultManager {
    /// Create a new VaultManager for the given app data directory.
    pub fn new(app_dir: &Path) -> Self {
        let db_path = app_dir.join("Capsules").join("vault.db");
        Self { db_path }
    }

    /// Initialize the vault index database and create tables if absent.
    pub fn init(&self) -> Result<()> {
        // Ensure directories exist
        if let Some(parent) = self.db_path.parent() {
            std::fs::create_dir_all(parent).map_err(|_| {
                rusqlite::Error::InvalidPath(parent.to_path_buf())
            })?;
        }

        // Open/create DB
        let conn = Connection::open(&self.db_path)?;

        // Create settings table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )",
            [],
        )?;

        // Create capsules index table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS capsules (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                platform TEXT NOT NULL,
                capture_level TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                messages_count INTEGER NOT NULL,
                size_bytes INTEGER NOT NULL,
                is_pinned INTEGER DEFAULT 0,
                completeness INTEGER DEFAULT 100,
                checksum TEXT NOT NULL,
                status TEXT DEFAULT 'healthy', -- 'healthy' | 'corrupt'
                path TEXT NOT NULL
            )",
            [],
        )?;

        // Migration: Check if 'deleted_at' column exists in 'capsules', and add if missing
        let has_deleted_at: Result<i32> = conn.query_row(
            "SELECT count(*) FROM pragma_table_info('capsules') WHERE name = 'deleted_at'",
            [],
            |row| row.get(0),
        );
        match has_deleted_at {
            Ok(count) if count == 0 => {
                println!("[Synapse Vault] Migrating: Adding 'deleted_at' column to capsules table");
                if let Err(e) = conn.execute("ALTER TABLE capsules ADD COLUMN deleted_at INTEGER DEFAULT NULL", []) {
                    eprintln!("[Synapse Vault] Error migrating 'deleted_at': {:?}", e);
                }
            }
            Err(e) => {
                eprintln!("[Synapse Vault] Pragma check failed (non-fatal, attempting ALTER): {:?}", e);
                // Fallback attempt to add the column in case pragma fails
                let _ = conn.execute("ALTER TABLE capsules ADD COLUMN deleted_at INTEGER DEFAULT NULL", []);
            }
            _ => {}
        }

        // Create indexes
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_capsules_created_at ON capsules(created_at DESC)",
            [],
        )?;
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_capsules_platform ON capsules(platform)",
            [],
        )?;
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_capsules_deleted_at ON capsules(deleted_at)",
            [],
        )?;

        // Create FTS5 Virtual Table for full-text search
        // Standard FTS5 creation: capsule_id is unindexed, remaining fields are searchable text
        let fts_res = conn.execute(
            "CREATE VIRTUAL TABLE IF NOT EXISTS fts_conversations USING fts5(
                capsule_id UNINDEXED,
                title,
                content,
                code_snippets,
                artifacts
            )",
            [],
        );

        match fts_res {
            Ok(_) => println!("[Synapse Vault] FTS5 Virtual Table configured successfully"),
            Err(e) => eprintln!("[Synapse Vault] Warning: Failed to initialize FTS5 table: {:?}", e),
        }

        println!("[Synapse Vault] Index initialized successfully at {:?}", self.db_path);
        Ok(())
    }

    /// Get a connection to the vault database.
    pub fn connect(&self) -> Result<Connection> {
        Connection::open(&self.db_path)
    }
}
