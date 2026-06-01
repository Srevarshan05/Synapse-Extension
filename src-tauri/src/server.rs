use std::net::SocketAddr;
use std::sync::Arc;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::fs::{self, OpenOptions, File};
use std::io::{Write, BufRead, BufReader};
use tokio::sync::Mutex;
use axum::{
    routing::{get, post},
    Json, Router, Extension,
    http::StatusCode,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tower_http::cors::{Any, CorsLayer};
use flate2::write::GzEncoder;
use flate2::Compression;

use crate::vault::VaultManager;
use crate::compiler::{compile_capsule, compute_checksum};

/// Represents an active progressive stream capture job
pub struct ActiveJob {
    pub job_id: String,
    pub platform: String,
    pub title: String,
    pub capture_level: String,
    pub total_chunks_expected: usize,
    pub chunks_received: usize,
    pub temp_dir: PathBuf,
}

/// Global Application State for loopback server
pub struct AppState {
    pub vault: Arc<VaultManager>,
    pub app_dir: PathBuf,
    pub current_status: Mutex<String>, // "Idle" | "Capturing" | "Processing"
    pub active_jobs: Mutex<HashMap<String, ActiveJob>>,
}

fn get_storage_dir(state: &AppState) -> PathBuf {
    if let Ok(conn) = state.vault.connect() {
        let val: Result<String, rusqlite::Error> = conn.query_row(
            "SELECT value FROM settings WHERE key = 'storage_path'",
            [],
            |row| row.get(0)
        );
        if let Ok(path) = val {
            if !path.trim().is_empty() {
                let custom_path = PathBuf::from(path);
                let _ = fs::create_dir_all(&custom_path);
                if custom_path.exists() {
                    return custom_path;
                }
            }
        }
    }
    state.app_dir.clone()
}

// ─── REQUEST/RESPONSE SCHEMAS ───────────────────────────────────────────────

#[derive(Deserialize)]
pub struct ValidatePathRequest {
    pub path: String,
}

#[derive(Serialize)]
pub struct ValidatePathResponse {
    pub success: bool,
    pub error: Option<String>,
}

#[derive(Serialize)]
pub struct StatusResponse {
    pub status: String, // "Connected" | "Capturing" | "Processing" | "Idle"
    pub version: String,
    pub db_healthy: bool,
    pub connection_type: String,
    pub default_storage_path: String,
}

#[derive(Deserialize)]
pub struct CaptureStartRequest {
    pub platform: String,
    pub title: String,
    pub capture_level: Option<String>,
    pub total_chunks_expected: usize,
}

#[derive(Serialize)]
pub struct CaptureStartResponse {
    pub success: bool,
    pub job_id: String,
}

#[derive(Deserialize)]
pub struct CaptureChunkRequest {
    pub job_id: String,
    pub chunk_index: usize,
    /// Raw DOM items — any JSON shape accepted, no stripping applied
    pub data: Vec<Value>,
}

#[derive(Serialize)]
pub struct GeneralResponse {
    pub success: bool,
    pub error: Option<String>,
}

#[derive(Deserialize)]
pub struct CapsuleBuildRequest {
    pub job_id: String,
    pub completeness: usize,
}

#[derive(Serialize)]
pub struct CapsuleBuildResponse {
    pub success: bool,
    pub capsule_id: Option<String>,
    pub stats: Option<BuildStats>,
    pub error: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct BuildStats {
    pub messages: usize,   // strict role/content message pairs
    pub raw_items: usize,  // total raw DOM items preserved
    pub size_bytes: usize,
}

#[derive(Serialize)]
pub struct CapsuleItem {
    pub id: String,
    pub title: String,
    pub platform: String,
    pub capture_level: String,
    pub created_at: i64,
    pub messages_count: usize,
    pub size_bytes: usize,
    pub is_pinned: bool,
    pub completeness: usize,
    pub status: String,
    pub path: String,
    pub deleted_at: Option<i64>,
}

#[derive(Serialize)]
pub struct CapsuleListResponse {
    pub capsules: Vec<CapsuleItem>,
    pub total: usize,
}

#[derive(Deserialize)]
pub struct HydrateRequest {
    pub capsule_id: String,
}

#[derive(Serialize)]
pub struct HydrateResponse {
    pub success: bool,
    pub continuation: Option<String>,
    pub error: Option<String>,
}

#[derive(Deserialize)]
pub struct TrashRequest {
    pub capsule_id: String,
}

#[derive(Deserialize)]
pub struct RestoreRequest {
    pub capsule_id: String,
}

#[derive(Deserialize)]
pub struct PurgeRequest {
    pub capsule_id: String,
}

#[derive(Deserialize)]
pub struct ImportRequest {
    pub file_data_base64: String,
}

// ─── ENDPOINT HANDLERS ───────────────────────────────────────────────────────

/// GET /status — Checks state & DB health
async fn get_status(Extension(state): Extension<Arc<AppState>>) -> Json<StatusResponse> {
    let db_healthy = state.vault.connect().is_ok();
    let status = state.current_status.lock().await.clone();
    let default_storage_path = state.app_dir.to_string_lossy().to_string();
    Json(StatusResponse {
        status,
        version: "4.0.0".to_string(),
        db_healthy,
        connection_type: "localhost".to_string(),
        default_storage_path,
    })
}

/// POST /capture/start — Begins progressive capture job
async fn post_capture_start(
    Extension(state): Extension<Arc<AppState>>,
    Json(payload): Json<CaptureStartRequest>,
) -> (StatusCode, Json<CaptureStartResponse>) {
    let job_id = format!(
        "job-{}-{}",
        chrono::Utc::now().timestamp_millis(),
        payload.platform
    );

    // Create temp directory for streaming messages
    let temp_dir = state.app_dir.join("Cache").join(&job_id);
    if let Err(e) = std::fs::create_dir_all(&temp_dir) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(CaptureStartResponse {
                success: false,
                job_id: format!("Failed to create temp directories: {}", e),
            }),
        );
    }

    // Set App status
    *state.current_status.lock().await = "Capturing".to_string();

    // Register active job
    let active_job = ActiveJob {
        job_id: job_id.clone(),
        platform: payload.platform,
        title: payload.title,
        capture_level: payload.capture_level.unwrap_or_else(|| "standard".to_string()),
        total_chunks_expected: payload.total_chunks_expected,
        chunks_received: 0,
        temp_dir,
    };

    state.active_jobs.lock().await.insert(job_id.clone(), active_job);

    (StatusCode::OK, Json(CaptureStartResponse { success: true, job_id }))
}

/// POST /capture/chunk — Progressive appender to local .jsonl on-disk
async fn post_capture_chunk(
    Extension(state): Extension<Arc<AppState>>,
    Json(payload): Json<CaptureChunkRequest>,
) -> Json<GeneralResponse> {
    let mut jobs = state.active_jobs.lock().await;
    let job = match jobs.get_mut(&payload.job_id) {
        Some(j) => j,
        None => {
            return Json(GeneralResponse {
                success: false,
                error: Some("Job ID not active or expired".to_string()),
            })
        }
    };

    // Open progressive jsonl file on disk
    let messages_path = job.temp_dir.join("messages.jsonl");
    let mut file = match OpenOptions::new()
        .create(true)
        .append(true)
        .open(&messages_path)
    {
        Ok(f) => f,
        Err(e) => {
            return Json(GeneralResponse {
                success: false,
                error: Some(format!("Failed to open temp stream file: {}", e)),
            })
        }
    };

    // Write raw JSON items directly — zero filtering, zero compression
    for item in payload.data {
        match serde_json::to_string(&item) {
            Ok(line) => {
                if let Err(e) = writeln!(file, "{}", line) {
                    return Json(GeneralResponse {
                        success: false,
                        error: Some(format!("Write stream error: {}", e)),
                    });
                }
            }
            Err(e) => {
                eprintln!("[Synapse] Chunk serialization warning (skipping item): {}", e);
            }
        }
    }

    job.chunks_received += 1;

    Json(GeneralResponse {
        success: true,
        error: None,
    })
}

/// POST /capsule/build — Resolves streams, compiles memory, saves .synpkg, indexes SQLite & FTS5
async fn post_capsule_build(
    Extension(state): Extension<Arc<AppState>>,
    Json(payload): Json<CapsuleBuildRequest>,
) -> Json<CapsuleBuildResponse> {
    *state.current_status.lock().await = "Processing".to_string();

    let mut jobs = state.active_jobs.lock().await;
    let job = match jobs.remove(&payload.job_id) {
        Some(j) => j,
        None => {
            *state.current_status.lock().await = "Idle".to_string();
            return Json(CapsuleBuildResponse {
                success: false,
                capsule_id: None,
                stats: None,
                error: Some("Job ID not found or already closed".to_string()),
            });
        }
    };

    // 2. Read messages from disk
    let messages_path = job.temp_dir.join("messages.jsonl");
    let file = match File::open(&messages_path) {
        Ok(f) => f,
        Err(e) => {
            *state.current_status.lock().await = "Idle".to_string();
            return Json(CapsuleBuildResponse {
                success: false,
                capsule_id: None,
                stats: None,
                error: Some(format!("Stream file not readable: {}", e)),
            });
        }
    };

    let mut raw_items: Vec<Value> = Vec::new();
    let reader = BufReader::new(file);
    for line in reader.lines() {
        match line {
            Ok(l) if !l.trim().is_empty() => {
                match serde_json::from_str::<Value>(&l) {
                    Ok(v) => raw_items.push(v),
                    Err(e) => eprintln!("[Synapse] Skipping malformed JSONL line: {}", e),
                }
            }
            _ => {}
        }
    }

    // 3. Compile capsule
    let capsule_id = format!("cap-{}", chrono::Utc::now().timestamp_millis());
    let payload_obj = compile_capsule(
        capsule_id.clone(),
        job.title.clone(),
        job.platform.clone(),
        job.capture_level.clone(),
        raw_items.clone(),
    );

    // 4. Compress to Gzipped .synpkg payload
    let raw_json = match serde_json::to_string(&payload_obj) {
        Ok(j) => j,
        Err(e) => {
            *state.current_status.lock().await = "Idle".to_string();
            return Json(CapsuleBuildResponse {
                success: false,
                capsule_id: None,
                stats: None,
                error: Some(format!("Serialization failure: {}", e)),
            });
        }
    };

    let data_dir = get_storage_dir(&state).join("Capsules").join("data");
    if let Err(e) = fs::create_dir_all(&data_dir) {
        *state.current_status.lock().await = "Idle".to_string();
        return Json(CapsuleBuildResponse {
            success: false,
            capsule_id: None,
            stats: None,
            error: Some(format!("Failed to create storage directories: {}", e)),
        });
    }

    let package_path = data_dir.join(format!("{}.synpkg", capsule_id));
    let pack_file = match File::create(&package_path) {
        Ok(f) => f,
        Err(e) => {
            *state.current_status.lock().await = "Idle".to_string();
            return Json(CapsuleBuildResponse {
                success: false,
                capsule_id: None,
                stats: None,
                error: Some(format!("Failed to create capsule package: {}", e)),
            });
        }
    };

    let mut encoder = GzEncoder::new(pack_file, Compression::default());
    if let Err(e) = encoder.write_all(raw_json.as_bytes()) {
        *state.current_status.lock().await = "Idle".to_string();
        return Json(CapsuleBuildResponse {
            success: false,
            capsule_id: None,
            stats: None,
            error: Some(format!("Compression error: {}", e)),
        });
    }

    let compressed_file = match encoder.finish() {
        Ok(f) => f,
        Err(e) => {
            *state.current_status.lock().await = "Idle".to_string();
            return Json(CapsuleBuildResponse {
                success: false,
                capsule_id: None,
                stats: None,
                error: Some(format!("Failed to finalize compressed package: {}", e)),
            });
        }
    };

    let size_bytes = match compressed_file.metadata() {
        Ok(meta) => meta.len() as usize,
        Err(_) => raw_json.len() / 2,
    };

    let checksum = compute_checksum(&raw_json);

    // 5. Index into SQLite
    let conn = match state.vault.connect() {
        Ok(c) => c,
        Err(e) => {
            *state.current_status.lock().await = "Idle".to_string();
            return Json(CapsuleBuildResponse {
                success: false,
                capsule_id: None,
                stats: None,
                error: Some(format!("Database indexing failure: {}", e)),
            });
        }
    };

    let insert_res = conn.execute(
        "INSERT INTO capsules (id, title, platform, capture_level, created_at, messages_count, size_bytes, is_pinned, completeness, checksum, status, path, deleted_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8, ?9, 'healthy', ?10, NULL)",
        rusqlite::params![
            capsule_id,
            job.title,
            job.platform,
            job.capture_level,
            payload_obj.created_at,
            payload_obj.raw_items.len(),
            size_bytes,
            payload.completeness,
            checksum,
            package_path.to_string_lossy().to_string(),
        ],
    );

    if let Err(e) = insert_res {
        *state.current_status.lock().await = "Idle".to_string();
        return Json(CapsuleBuildResponse {
            success: false,
            capsule_id: None,
            stats: None,
            error: Some(format!("Failed to write SQL metadata: {}", e)),
        });
    }

    // 6. Populate FTS5 Search Tables
    let mut content_search = String::new();
    let mut code_search = String::new();
    let mut artifact_search = String::new();

    for msg in &payload_obj.messages {
        content_search.push_str(&msg.content);
        content_search.push_str("\n");
    }

    for item in &raw_items {
        if let Some(obj) = item.as_object() {
            if let Some(Value::Array(blocks)) = obj.get("codeBlocks") {
                for b in blocks {
                    if let Some(b_obj) = b.as_object() {
                        if let Some(c) = b_obj.get("content").and_then(|c| c.as_str()) {
                            code_search.push_str(c);
                            code_search.push_str("\n");
                        }
                    }
                }
            }
            if let Some(Value::Array(arts)) = obj.get("artifacts") {
                for a in arts {
                    if let Some(a_obj) = a.as_object() {
                        if let Some(t) = a_obj.get("title").and_then(|t| t.as_str()) {
                            artifact_search.push_str(t);
                            artifact_search.push_str("\n");
                        }
                        if let Some(c) = a_obj.get("content").and_then(|c| c.as_str()) {
                            artifact_search.push_str(c);
                            artifact_search.push_str("\n");
                        }
                    }
                }
            }
        }
    }

    let _fts_res = conn.execute(
        "INSERT INTO fts_conversations (capsule_id, title, content, code_snippets, artifacts) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![
            capsule_id,
            job.title,
            content_search,
            code_search,
            artifact_search,
        ],
    );

    // 7. Cleanup temp folder
    let _ = fs::remove_dir_all(&job.temp_dir);

    *state.current_status.lock().await = "Idle".to_string();

    Json(CapsuleBuildResponse {
        success: true,
        capsule_id: Some(capsule_id),
        stats: Some(BuildStats {
            messages: payload_obj.messages.len(),
            raw_items: payload_obj.item_count,
            size_bytes,
        }),
        error: None,
    })
}

/// GET /capsules — Queries index rows (excluding soft-deleted ones)
async fn get_capsules(Extension(state): Extension<Arc<AppState>>) -> Json<CapsuleListResponse> {
    let conn = match state.vault.connect() {
        Ok(c) => c,
        Err(_) => return Json(CapsuleListResponse { capsules: Vec::new(), total: 0 }),
    };

    let mut stmt = match conn.prepare(
        "SELECT id, title, platform, capture_level, created_at, messages_count, size_bytes, is_pinned, completeness, status, path, deleted_at 
         FROM capsules WHERE deleted_at IS NULL ORDER BY created_at DESC"
    ) {
        Ok(s) => s,
        Err(_) => return Json(CapsuleListResponse { capsules: Vec::new(), total: 0 }),
    };

    let capsule_iter = stmt.query_map([], |row| {
        Ok(CapsuleItem {
            id: row.get(0)?,
            title: row.get(1)?,
            platform: row.get(2)?,
            capture_level: row.get(3)?,
            created_at: row.get(4)?,
            messages_count: row.get(5)?,
            size_bytes: row.get(6)?,
            is_pinned: row.get::<_, i32>(7)? == 1,
            completeness: row.get(8)?,
            status: row.get(9)?,
            path: row.get(10)?,
            deleted_at: row.get(11)?,
        })
    });

    let mut capsules = Vec::new();
    if let Ok(rows) = capsule_iter {
        for row in rows {
            if let Ok(item) = row {
                capsules.push(item);
            }
        }
    }

    let total = capsules.len();
    Json(CapsuleListResponse { capsules, total })
}

/// GET /trash — Queries soft-deleted index rows
async fn get_trash(Extension(state): Extension<Arc<AppState>>) -> Json<CapsuleListResponse> {
    let conn = match state.vault.connect() {
        Ok(c) => c,
        Err(_) => return Json(CapsuleListResponse { capsules: Vec::new(), total: 0 }),
    };

    let mut stmt = match conn.prepare(
        "SELECT id, title, platform, capture_level, created_at, messages_count, size_bytes, is_pinned, completeness, status, path, deleted_at 
         FROM capsules WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC"
    ) {
        Ok(s) => s,
        Err(_) => return Json(CapsuleListResponse { capsules: Vec::new(), total: 0 }),
    };

    let capsule_iter = stmt.query_map([], |row| {
        Ok(CapsuleItem {
            id: row.get(0)?,
            title: row.get(1)?,
            platform: row.get(2)?,
            capture_level: row.get(3)?,
            created_at: row.get(4)?,
            messages_count: row.get(5)?,
            size_bytes: row.get(6)?,
            is_pinned: row.get::<_, i32>(7)? == 1,
            completeness: row.get(8)?,
            status: row.get(9)?,
            path: row.get(10)?,
            deleted_at: row.get(11)?,
        })
    });

    let mut capsules = Vec::new();
    if let Ok(rows) = capsule_iter {
        for row in rows {
            if let Ok(item) = row {
                capsules.push(item);
            }
        }
    }

    let total = capsules.len();
    Json(CapsuleListResponse { capsules, total })
}

/// POST /capsules/trash — Soft-deletes a capsule and moves package to trash/ folder
async fn post_capsules_trash(
    Extension(state): Extension<Arc<AppState>>,
    Json(payload): Json<TrashRequest>,
) -> Json<GeneralResponse> {
    let conn = match state.vault.connect() {
        Ok(c) => c,
        Err(e) => return Json(GeneralResponse { success: false, error: Some(format!("DB error: {}", e)) }),
    };

    // Get current path
    let path_str: rusqlite::Result<String> = conn.query_row(
        "SELECT path FROM capsules WHERE id = ?1",
        rusqlite::params![payload.capsule_id],
        |row| row.get(0),
    );

    let path_str = match path_str {
        Ok(p) => p,
        Err(_) => return Json(GeneralResponse { success: false, error: Some("Capsule not found".to_string()) }),
    };

    let trash_dir = get_storage_dir(&state).join("Capsules").join("trash");
    if let Err(e) = fs::create_dir_all(&trash_dir) {
        return Json(GeneralResponse { success: false, error: Some(format!("Failed to create trash folder: {}", e)) });
    }

    let src_path = Path::new(&path_str);
    let filename = src_path.file_name().unwrap_or_default();
    let dest_path = trash_dir.join(filename);

    // Physically move the file on disk
    if src_path.exists() {
        if let Err(e) = fs::rename(src_path, &dest_path) {
            eprintln!("[Synapse Companion] Error moving file to trash folder: {:?}", e);
            // non-fatal if file missing, let's proceed with DB update anyway
        }
    }

    let now_millis = chrono::Utc::now().timestamp_millis();
    let update_res = conn.execute(
        "UPDATE capsules SET deleted_at = ?1, path = ?2 WHERE id = ?3",
        rusqlite::params![now_millis, dest_path.to_string_lossy().to_string(), payload.capsule_id],
    );

    match update_res {
        Ok(_) => Json(GeneralResponse { success: true, error: None }),
        Err(e) => Json(GeneralResponse { success: false, error: Some(format!("Failed to soft-delete: {}", e)) }),
    }
}

/// POST /capsules/restore — Restores a soft-deleted capsule
async fn post_capsules_restore(
    Extension(state): Extension<Arc<AppState>>,
    Json(payload): Json<RestoreRequest>,
) -> Json<GeneralResponse> {
    let conn = match state.vault.connect() {
        Ok(c) => c,
        Err(e) => return Json(GeneralResponse { success: false, error: Some(format!("DB error: {}", e)) }),
    };

    let path_str: rusqlite::Result<String> = conn.query_row(
        "SELECT path FROM capsules WHERE id = ?1 AND deleted_at IS NOT NULL",
        rusqlite::params![payload.capsule_id],
        |row| row.get(0),
    );

    let path_str = match path_str {
        Ok(p) => p,
        Err(_) => return Json(GeneralResponse { success: false, error: Some("Soft-deleted capsule not found".to_string()) }),
    };

    let data_dir = get_storage_dir(&state).join("Capsules").join("data");
    if let Err(e) = fs::create_dir_all(&data_dir) {
        return Json(GeneralResponse { success: false, error: Some(format!("Failed to create data folder: {}", e)) });
    }

    let src_path = Path::new(&path_str);
    let filename = src_path.file_name().unwrap_or_default();
    let dest_path = data_dir.join(filename);

    // Physically move the file back
    if src_path.exists() {
        if let Err(e) = fs::rename(src_path, &dest_path) {
            eprintln!("[Synapse Companion] Error restoring file from trash folder: {:?}", e);
        }
    }

    let update_res = conn.execute(
        "UPDATE capsules SET deleted_at = NULL, path = ?1 WHERE id = ?2",
        rusqlite::params![dest_path.to_string_lossy().to_string(), payload.capsule_id],
    );

    match update_res {
        Ok(_) => Json(GeneralResponse { success: true, error: None }),
        Err(e) => Json(GeneralResponse { success: false, error: Some(format!("Failed to restore: {}", e)) }),
    }
}

/// POST /capsules/purge — Permanently deletes a capsule from disk, DB, and search index
async fn post_capsules_purge(
    Extension(state): Extension<Arc<AppState>>,
    Json(payload): Json<PurgeRequest>,
) -> Json<GeneralResponse> {
    let conn = match state.vault.connect() {
        Ok(c) => c,
        Err(e) => return Json(GeneralResponse { success: false, error: Some(format!("DB error: {}", e)) }),
    };

    let path_str: rusqlite::Result<String> = conn.query_row(
        "SELECT path FROM capsules WHERE id = ?1",
        rusqlite::params![payload.capsule_id],
        |row| row.get(0),
    );

    if let Ok(p) = path_str {
        let file_path = Path::new(&p);
        if file_path.exists() {
            let _ = fs::remove_file(file_path);
        }
    }

    let _ = conn.execute("DELETE FROM capsules WHERE id = ?1", rusqlite::params![payload.capsule_id]);
    let _ = conn.execute("DELETE FROM fts_conversations WHERE capsule_id = ?1", rusqlite::params![payload.capsule_id]);

    Json(GeneralResponse { success: true, error: None })
}

/// POST /capsules/import — Import a capsule via Base64 package data string
async fn post_capsules_import(
    Extension(state): Extension<Arc<AppState>>,
    Json(payload): Json<ImportRequest>,
) -> Json<GeneralResponse> {
    let bytes = match base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &payload.file_data_base64) {
        Ok(b) => b,
        Err(e) => return Json(GeneralResponse { success: false, error: Some(format!("Invalid base64 payload: {}", e)) }),
    };

    // Decompress Gzip to check validity
    let mut decoder = flate2::read::GzDecoder::new(&bytes[..]);
    let mut raw_json = String::new();
    if let Err(e) = std::io::Read::read_to_string(&mut decoder, &mut raw_json) {
        return Json(GeneralResponse { success: false, error: Some(format!("Package decompression failed: {}", e)) });
    }

    let payload_obj: crate::compiler::CapsulePayload = match serde_json::from_str(&raw_json) {
        Ok(obj) => obj,
        Err(e) => return Json(GeneralResponse { success: false, error: Some(format!("Malformed capsule JSON structure: {}", e)) }),
    };

    let capsule_id = payload_obj.id.clone();
    let data_dir = get_storage_dir(&state).join("Capsules").join("data");
    if let Err(e) = fs::create_dir_all(&data_dir) {
        return Json(GeneralResponse { success: false, error: Some(format!("Failed to create storage folder: {}", e)) });
    }

    let package_path = data_dir.join(format!("{}.synpkg", capsule_id));

    // Save the package raw bytes directly to disk
    let mut file = match File::create(&package_path) {
        Ok(f) => f,
        Err(e) => return Json(GeneralResponse { success: false, error: Some(format!("Failed to create package file: {}", e)) }),
    };

    if let Err(e) = file.write_all(&bytes) {
        return Json(GeneralResponse { success: false, error: Some(format!("Failed to write package on disk: {}", e)) });
    }

    let conn = match state.vault.connect() {
        Ok(c) => c,
        Err(e) => return Json(GeneralResponse { success: false, error: Some(format!("DB error: {}", e)) }),
    };

    // Remove preexisting rows if overwriting / re-importing
    let _ = conn.execute("DELETE FROM capsules WHERE id = ?1", rusqlite::params![capsule_id]);
    let _ = conn.execute("DELETE FROM fts_conversations WHERE capsule_id = ?1", rusqlite::params![capsule_id]);

    let size_bytes = bytes.len();
    let checksum = compute_checksum(&raw_json);

    let insert_res = conn.execute(
        "INSERT INTO capsules (id, title, platform, capture_level, created_at, messages_count, size_bytes, is_pinned, completeness, checksum, status, path, deleted_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, 100, ?8, 'healthy', ?9, NULL)",
        rusqlite::params![
            capsule_id,
            payload_obj.title,
            payload_obj.platform,
            payload_obj.capture_level,
            payload_obj.created_at,
            payload_obj.raw_items.len(),
            size_bytes,
            checksum,
            package_path.to_string_lossy().to_string(),
        ],
    );

    if let Err(e) = insert_res {
        return Json(GeneralResponse { success: false, error: Some(format!("Database indexing failed: {}", e)) });
    }

    // Index inside FTS5 search
    let mut content_search = String::new();
    let mut code_search = String::new();
    let mut artifact_search = String::new();

    for msg in &payload_obj.messages {
        content_search.push_str(&msg.content);
        content_search.push_str("\n");
    }

    for item in &payload_obj.raw_items {
        if let Some(obj) = item.as_object() {
            if let Some(Value::Array(blocks)) = obj.get("codeBlocks") {
                for b in blocks {
                    if let Some(b_obj) = b.as_object() {
                        if let Some(c) = b_obj.get("content").and_then(|c| c.as_str()) {
                            code_search.push_str(c);
                            code_search.push_str("\n");
                        }
                    }
                }
            }
            if let Some(Value::Array(arts)) = obj.get("artifacts") {
                for a in arts {
                    if let Some(a_obj) = a.as_object() {
                        if let Some(t) = a_obj.get("title").and_then(|t| t.as_str()) {
                            artifact_search.push_str(t);
                            artifact_search.push_str("\n");
                        }
                        if let Some(c) = a_obj.get("content").and_then(|c| c.as_str()) {
                            artifact_search.push_str(c);
                            artifact_search.push_str("\n");
                        }
                    }
                }
            }
        }
    }

    let _fts_res = conn.execute(
        "INSERT INTO fts_conversations (capsule_id, title, content, code_snippets, artifacts) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![
            capsule_id,
            payload_obj.title,
            content_search,
            code_search,
            artifact_search,
        ],
    );

    Json(GeneralResponse { success: true, error: None })
}

/// POST /hydrate — Decodes .synpkg and returns capsule content for display/replay
async fn post_hydrate(
    Extension(state): Extension<Arc<AppState>>,
    Json(payload): Json<HydrateRequest>,
) -> Json<HydrateResponse> {
    let conn = match state.vault.connect() {
        Ok(c) => c,
        Err(e) => {
            return Json(HydrateResponse {
                success: false,
                continuation: None,
                error: Some(format!("Database error: {}", e)),
            })
        }
    };

    let path_str: String = match conn.query_row(
        "SELECT path FROM capsules WHERE id = ?1",
        rusqlite::params![payload.capsule_id],
        |row| row.get(0),
    ) {
        Ok(p) => p,
        Err(_) => {
            return Json(HydrateResponse {
                success: false,
                continuation: None,
                error: Some("Capsule index row not found".to_string()),
            })
        }
    };

    let package_path = Path::new(&path_str);
    let gz_file = match File::open(package_path) {
        Ok(f) => f,
        Err(e) => {
            return Json(HydrateResponse {
                success: false,
                continuation: None,
                error: Some(format!("Package not found on disk: {}", e)),
            })
        }
    };

    let mut decoder = flate2::read::GzDecoder::new(gz_file);
    let mut raw_json = String::new();
    if let Err(e) = std::io::Read::read_to_string(&mut decoder, &mut raw_json) {
        return Json(HydrateResponse {
            success: false,
            continuation: None,
            error: Some(format!("Decompression failed: {}", e)),
        });
    }

    Json(HydrateResponse {
        success: true,
        continuation: Some(raw_json), // Return the FULL raw JSON string for high-fidelity viewer
        error: None,
    })
}

#[derive(Deserialize)]
pub struct ExportLocalRequest {
    pub capsule_id: String,
    pub filename: String,
}

async fn post_capsules_export_local(
    Extension(state): Extension<Arc<AppState>>,
    Json(payload): Json<ExportLocalRequest>,
) -> Json<GeneralResponse> {
    let conn = match state.vault.connect() {
        Ok(c) => c,
        Err(e) => return Json(GeneralResponse { success: false, error: Some(format!("DB error: {}", e)) }),
    };

    let path_str: rusqlite::Result<String> = conn.query_row(
        "SELECT path FROM capsules WHERE id = ?1",
        rusqlite::params![payload.capsule_id],
        |row| row.get(0),
    );

    let path_str = match path_str {
        Ok(p) => p,
        Err(_) => return Json(GeneralResponse { success: false, error: Some("Synapse not found in database".to_string()) }),
    };

    let src_path = Path::new(&path_str);
    if !src_path.exists() {
        return Json(GeneralResponse { success: false, error: Some("Source synapse file not found on disk".to_string()) });
    }

    let bytes = match fs::read(src_path) {
        Ok(b) => b,
        Err(e) => return Json(GeneralResponse { success: false, error: Some(format!("Failed to read source synapse file: {}", e)) }),
    };

    let mut decoder = flate2::read::GzDecoder::new(&bytes[..]);
    let mut raw_json = String::new();
    if let Err(e) = std::io::Read::read_to_string(&mut decoder, &mut raw_json) {
        return Json(GeneralResponse { success: false, error: Some(format!("Synapse decompression failed: {}", e)) });
    }

    let b64_data = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, raw_json.as_bytes());
    
    let storage_dir = get_storage_dir(&state);
    let dest_path = storage_dir.join(format!("{}.synapse", payload.filename));

    let mut dest_file = match File::create(&dest_path) {
        Ok(f) => f,
        Err(e) => return Json(GeneralResponse { success: false, error: Some(format!("Failed to create destination file: {}", e)) }),
    };

    if let Err(e) = dest_file.write_all(b64_data.as_bytes()) {
        return Json(GeneralResponse { success: false, error: Some(format!("Failed to write to destination: {}", e)) });
    }

    Json(GeneralResponse { success: true, error: None })
}

#[derive(Deserialize)]
pub struct SetSettingRequest {
    pub key: String,
    pub value: String,
}

#[derive(Serialize)]
pub struct GetSettingResponse {
    pub success: bool,
    pub value: Option<String>,
    pub error: Option<String>,
}

#[derive(Deserialize)]
pub struct OpenUrlRequest {
    pub url: String,
}

/// GET /settings — Retrieve setting value from vault DB
async fn get_setting(
    Extension(state): Extension<Arc<AppState>>,
    axum::extract::Query(params): axum::extract::Query<HashMap<String, String>>,
) -> Json<GetSettingResponse> {
    let key = match params.get("key") {
        Some(k) => k,
        None => {
            return Json(GetSettingResponse {
                success: false,
                value: None,
                error: Some("Missing 'key' parameter".to_string()),
            })
        }
    };

    let conn = match state.vault.connect() {
        Ok(c) => c,
        Err(e) => {
            return Json(GetSettingResponse {
                success: false,
                value: None,
                error: Some(format!("Database error: {}", e)),
            })
        }
    };

    let val: rusqlite::Result<String> = conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        rusqlite::params![key],
        |row| row.get(0),
    );

    match val {
        Ok(v) => Json(GetSettingResponse {
            success: true,
            value: Some(v),
            error: None,
        }),
        Err(rusqlite::Error::QueryReturnedNoRows) => Json(GetSettingResponse {
            success: true,
            value: None,
            error: None,
        }),
        Err(e) => Json(GetSettingResponse {
            success: false,
            value: None,
            error: Some(format!("Database query error: {}", e)),
        }),
    }
}

/// POST /settings — Save or update setting value in vault DB
async fn post_setting(
    Extension(state): Extension<Arc<AppState>>,
    Json(payload): Json<SetSettingRequest>,
) -> Json<GeneralResponse> {
    let conn = match state.vault.connect() {
        Ok(c) => c,
        Err(e) => {
            return Json(GeneralResponse {
                success: false,
                error: Some(format!("Database error: {}", e)),
            })
        }
    };

    let res = conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![payload.key, payload.value],
    );

    match res {
        Ok(_) => Json(GeneralResponse {
            success: true,
            error: None,
        }),
        Err(e) => Json(GeneralResponse {
            success: false,
            error: Some(format!("Failed to save setting: {}", e)),
        }),
    }
}

async fn post_validate_path(
    Json(payload): Json<ValidatePathRequest>,
) -> Json<ValidatePathResponse> {
    let p = Path::new(&payload.path);
    if payload.path.trim().is_empty() {
        return Json(ValidatePathResponse { success: false, error: Some("Path cannot be empty".to_string()) });
    }
    match fs::create_dir_all(p) {
        Ok(_) => {
            let test_file = p.join(".synapse_write_test");
            match File::create(&test_file) {
                Ok(_) => {
                    let _ = fs::remove_file(test_file);
                    Json(ValidatePathResponse { success: true, error: None })
                }
                Err(e) => Json(ValidatePathResponse { success: false, error: Some(format!("Selected path is not writable: {}", e)) })
            }
        }
        Err(e) => Json(ValidatePathResponse { success: false, error: Some(format!("Invalid path: {}", e)) })
    }
}

/// POST /open_url — Opens default browser URL securely (guards origins)
async fn post_open_url(Json(payload): Json<OpenUrlRequest>) -> Json<GeneralResponse> {
    println!("[Synapse Server] Secure open browser requested: {}", payload.url);
    if payload.url.starts_with("https://chatgpt.com/") ||
       payload.url.starts_with("https://claude.ai/") ||
       payload.url.starts_with("https://gemini.google.com/") ||
       payload.url.starts_with("https://chat.deepseek.com/") ||
       payload.url.starts_with("https://kimi.moonshot.cn/") ||
       payload.url.starts_with("https://grok.com/") ||
       payload.url.starts_with("https://copilot.microsoft.com/") ||
       payload.url.starts_with("https://www.perplexity.ai/") ||
       payload.url.starts_with("https://poe.com/") ||
       payload.url.starts_with("https://openrouter.ai/") ||
       payload.url.starts_with("https://chat.mistral.ai/") ||
       payload.url.starts_with("https://chat.qwen.ai/") {
        
        #[cfg(target_os = "windows")]
        {
            let _ = std::process::Command::new("cmd")
                .args(["/C", "start", "", &payload.url])
                .spawn();
        }
        #[cfg(not(target_os = "windows"))]
        {
            let _ = std::process::Command::new("open")
                .arg(&payload.url)
                .spawn();
        }
        Json(GeneralResponse { success: true, error: None })
    } else {
        Json(GeneralResponse { success: false, error: Some("Untrusted URL origin blocked".to_string()) })
    }
}

/// POST /capsules/clear — Permanently clears all capsules and FTS tables
async fn post_capsules_clear(
    Extension(state): Extension<Arc<AppState>>,
) -> Json<GeneralResponse> {
    let conn = match state.vault.connect() {
        Ok(c) => c,
        Err(e) => return Json(GeneralResponse { success: false, error: Some(format!("DB error: {}", e)) }),
    };

    let mut stmt = match conn.prepare("SELECT path FROM capsules") {
        Ok(s) => s,
        Err(e) => return Json(GeneralResponse { success: false, error: Some(format!("DB statement prep error: {}", e)) }),
    };

    let path_iter = stmt.query_map([], |row| {
        Ok(row.get::<_, String>(0)?)
    });

    if let Ok(rows) = path_iter {
        for row in rows {
            if let Ok(path_str) = row {
                let file_path = Path::new(&path_str);
                if file_path.exists() {
                    let _ = fs::remove_file(file_path);
                }
            }
        }
    }

    let _ = conn.execute("DELETE FROM capsules", []);
    let _ = conn.execute("DELETE FROM fts_conversations", []);

    Json(GeneralResponse { success: true, error: None })
}

#[derive(Deserialize)]
pub struct SearchParams {
    pub q: String,
}

/// GET /capsules/search — Native SQLite search (supports FTS5 matching & LIKE fallbacks)
async fn get_capsules_search(
    Extension(state): Extension<Arc<AppState>>,
    axum::extract::Query(params): axum::extract::Query<SearchParams>,
) -> Json<CapsuleListResponse> {
    let conn = match state.vault.connect() {
        Ok(c) => c,
        Err(_) => return Json(CapsuleListResponse { capsules: Vec::new(), total: 0 }),
    };

    let query_str = params.q.trim();
    if query_str.is_empty() {
        return Json(CapsuleListResponse { capsules: Vec::new(), total: 0 });
    }

    // Sanitize search query to extract safe words for SQLite FTS5 matching
    let clean_q = query_str
        .chars()
        .map(|c| if c.is_alphanumeric() || c.is_whitespace() { c } else { ' ' })
        .collect::<String>();
    let words: Vec<&str> = clean_q.split_whitespace().collect();

    if words.is_empty() {
        return Json(CapsuleListResponse { capsules: Vec::new(), total: 0 });
    }

    // Formulate FTS5 match string (prefix match each term: "word1* word2*")
    let fts_query = words.iter().map(|w| format!("{}*", w)).collect::<Vec<String>>().join(" ");

    // 1. Attempt FTS5 deep-text query (searches message content, titles, code snippets)
    let fts_stmt = conn.prepare(
        "SELECT c.id, c.title, c.platform, c.capture_level, c.created_at, c.messages_count, c.size_bytes, c.is_pinned, c.completeness, c.status, c.path, c.deleted_at 
         FROM capsules c
         JOIN fts_conversations f ON c.id = f.capsule_id
         WHERE c.deleted_at IS NULL AND fts_conversations MATCH ?1
         ORDER BY c.is_pinned DESC, c.created_at DESC"
    );

    let mut stmt = match fts_stmt {
        Ok(s) => s,
        Err(_) => {
            // Fallback: standard metadata LIKE query if FTS is failing or not compiled in sqlite
            let fallback_stmt = conn.prepare(
                "SELECT id, title, platform, capture_level, created_at, messages_count, size_bytes, is_pinned, completeness, status, path, deleted_at 
                 FROM capsules 
                 WHERE deleted_at IS NULL AND (title LIKE ?1 OR platform LIKE ?1)
                 ORDER BY is_pinned DESC, created_at DESC"
            );
            match fallback_stmt {
                Ok(mut s) => {
                    let search_term = format!("%{}%", query_str);
                    let capsule_iter = s.query_map([search_term], |row| {
                        Ok(CapsuleItem {
                            id: row.get(0)?,
                            title: row.get(1)?,
                            platform: row.get(2)?,
                            capture_level: row.get(3)?,
                            created_at: row.get(4)?,
                            messages_count: row.get(5)?,
                            size_bytes: row.get(6)?,
                            is_pinned: row.get::<_, i32>(7)? == 1,
                            completeness: row.get(8)?,
                            status: row.get(9)?,
                            path: row.get(10)?,
                            deleted_at: row.get(11)?,
                        })
                    });
                    let mut capsules = Vec::new();
                    if let Ok(rows) = capsule_iter {
                        for row in rows {
                            if let Ok(item) = row {
                                capsules.push(item);
                            }
                        }
                    }
                    return Json(CapsuleListResponse { total: capsules.len(), capsules });
                }
                Err(_) => return Json(CapsuleListResponse { capsules: Vec::new(), total: 0 }),
            }
        }
    };

    let capsule_iter = stmt.query_map([fts_query], |row| {
        Ok(CapsuleItem {
            id: row.get(0)?,
            title: row.get(1)?,
            platform: row.get(2)?,
            capture_level: row.get(3)?,
            created_at: row.get(4)?,
            messages_count: row.get(5)?,
            size_bytes: row.get(6)?,
            is_pinned: row.get::<_, i32>(7)? == 1,
            completeness: row.get(8)?,
            status: row.get(9)?,
            path: row.get(10)?,
            deleted_at: row.get(11)?,
        })
    });

    let mut capsules = Vec::new();
    if let Ok(rows) = capsule_iter {
        for row in rows {
            if let Ok(item) = row {
                capsules.push(item);
            }
        }
    }

    // 2. If FTS search returned 0 items (e.g. term was very specific or only in a deleted row),
    // run the LIKE search as a secondary fallback so we always return matching titles!
    if capsules.is_empty() {
        let mut secondary_stmt = match conn.prepare(
            "SELECT id, title, platform, capture_level, created_at, messages_count, size_bytes, is_pinned, completeness, status, path, deleted_at 
             FROM capsules 
             WHERE deleted_at IS NULL AND (title LIKE ?1 OR platform LIKE ?1)
             ORDER BY is_pinned DESC, c.created_at DESC"
        ) {
            Ok(s) => s,
            Err(_) => {
                let mut secondary_stmt_no_c = match conn.prepare(
                    "SELECT id, title, platform, capture_level, created_at, messages_count, size_bytes, is_pinned, completeness, status, path, deleted_at 
                     FROM capsules 
                     WHERE deleted_at IS NULL AND (title LIKE ?1 OR platform LIKE ?1)
                     ORDER BY is_pinned DESC, created_at DESC"
                ) {
                    Ok(s) => s,
                    Err(_) => return Json(CapsuleListResponse { capsules, total: 0 }),
                };
                let search_term = format!("%{}%", query_str);
                let capsule_iter = secondary_stmt_no_c.query_map([search_term], |row| {
                    Ok(CapsuleItem {
                        id: row.get(0)?,
                        title: row.get(1)?,
                        platform: row.get(2)?,
                        capture_level: row.get(3)?,
                        created_at: row.get(4)?,
                        messages_count: row.get(5)?,
                        size_bytes: row.get(6)?,
                        is_pinned: row.get::<_, i32>(7)? == 1,
                        completeness: row.get(8)?,
                        status: row.get(9)?,
                        path: row.get(10)?,
                        deleted_at: row.get(11)?,
                    })
                });
                if let Ok(rows) = capsule_iter {
                    for row in rows {
                        if let Ok(item) = row {
                            capsules.push(item);
                        }
                    }
                }
                let total = capsules.len();
                return Json(CapsuleListResponse { capsules, total });
            }
        };

        let search_term = format!("%{}%", query_str);
        let capsule_iter = secondary_stmt.query_map([search_term], |row| {
            Ok(CapsuleItem {
                id: row.get(0)?,
                title: row.get(1)?,
                platform: row.get(2)?,
                capture_level: row.get(3)?,
                created_at: row.get(4)?,
                messages_count: row.get(5)?,
                size_bytes: row.get(6)?,
                is_pinned: row.get::<_, i32>(7)? == 1,
                completeness: row.get(8)?,
                status: row.get(9)?,
                path: row.get(10)?,
                deleted_at: row.get(11)?,
            })
        });

        if let Ok(rows) = capsule_iter {
            for row in rows {
                if let Ok(item) = row {
                    capsules.push(item);
                }
            }
        }
    }

    let total = capsules.len();
    Json(CapsuleListResponse { capsules, total })
}

// ─── SERVER INITIATOR ────────────────────────────────────────────────────────

pub async fn start_server(vault: Arc<VaultManager>, app_dir: PathBuf) {
    // 30-day automatic Trash cleanup routine inside Tauri Startup
    if let Ok(conn) = vault.connect() {
        let thirty_days_ago = chrono::Utc::now().timestamp_millis() - (30 * 24 * 60 * 60 * 1000);
        let stmt_res = conn.prepare("SELECT id, path FROM capsules WHERE deleted_at IS NOT NULL AND deleted_at < ?1");
        if let Ok(mut stmt) = stmt_res {
            let old_capsules = stmt.query_map([thirty_days_ago], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            });
            if let Ok(rows) = old_capsules {
                for cap in rows {
                    if let Ok((id, path)) = cap {
                        println!("[Synapse Companion] Auto-purging 30-day old capsule: {}", id);
                        let _ = fs::remove_file(Path::new(&path));
                        let _ = conn.execute("DELETE FROM capsules WHERE id = ?1", rusqlite::params![id]);
                        let _ = conn.execute("DELETE FROM fts_conversations WHERE capsule_id = ?1", rusqlite::params![id]);
                    }
                }
            }
        }
    }

    let state = Arc::new(AppState {
        vault,
        app_dir,
        current_status: Mutex::new("Idle".to_string()),
        active_jobs: Mutex::new(HashMap::new()),
    });

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/status", get(get_status))
        .route("/capture/start", post(post_capture_start))
        .route("/capture/chunk", post(post_capture_chunk))
        .route("/capsule/build", post(post_capsule_build))
        .route("/capsules", get(get_capsules))
        .route("/capsules/search", get(get_capsules_search))
        .route("/trash", get(get_trash))
        .route("/capsules/trash", post(post_capsules_trash))
        .route("/capsules/restore", post(post_capsules_restore))
        .route("/capsules/purge", post(post_capsules_purge))
        .route("/capsules/import", post(post_capsules_import))
        .route("/capsules/export_local", post(post_capsules_export_local))
        .route("/capsules/clear", post(post_capsules_clear))
        .route("/settings", get(get_setting).post(post_setting))
        .route("/settings/validate_path", post(post_validate_path))
        .route("/open_url", post(post_open_url))
        .route("/hydrate", post(post_hydrate))
        .layer(cors)
        .layer(axum::extract::DefaultBodyLimit::max(50 * 1024 * 1024))
        .layer(Extension(state));

    let addr = SocketAddr::from(([127, 0, 0, 1], 3742));
    println!("[Synapse Server] Bound to http://127.0.0.1:3742");

    let listener = tokio::net::TcpListener::bind(&addr).await.expect("Failed to bind localhost:3742");
    axum::serve(listener, app).await.unwrap_or_else(|e| {
        eprintln!("[Synapse Server] Axum server execution error: {}", e);
    });
}
