use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

/// A single raw item exactly as extracted from the DOM.
/// No field normalization, no stripping — whatever came from the page.
pub type RawItem = Value;

/// The capsule payload persisted to disk.
/// Contains ONLY raw extracted data — no summaries, no graphs, no memory layers.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CapsulePayload {
    pub id: String,
    pub title: String,
    pub platform: String,
    pub capture_level: String,
    pub created_at: i64,
    /// Every raw DOM item exactly as extracted — messages, nodes, edges, all combined
    pub raw_items: Vec<RawItem>,
    /// Total count of items for quick reference
    pub item_count: usize,
    /// Optional: extracted message text in order for replay (best-effort, role+content only)
    pub messages: Vec<SimpleMessage>,
}

/// Minimal message pair extracted from raw items for replay purposes only.
/// This is derived — never the primary source of truth.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SimpleMessage {
    pub role: String,
    pub content: String,
}

/// Computes a fast 64-bit checksum for deduplication / integrity checks.
pub fn compute_checksum(payload: &str) -> String {
    let mut hasher = DefaultHasher::new();
    payload.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

/// Assembles a capsule from raw DOM items.
/// - Stores everything verbatim in `raw_items`
/// - Best-effort extracts `role`+`content` pairs into `messages` for replay
/// - Zero summarization, zero pruning, zero graph building
pub fn compile_capsule(
    id: String,
    title: String,
    platform: String,
    capture_level: String,
    raw_items: Vec<RawItem>,
) -> CapsulePayload {
    // Best-effort extract readable messages (role + content) from raw items.
    // These are only used for replay display — raw_items is the source of truth.
    let messages: Vec<SimpleMessage> = raw_items
        .iter()
        .filter_map(|v| {
            let obj = v.as_object()?;
            let role = obj.get("role")?.as_str()?.to_string();
            // Accept content as string or array (some platforms return arrays)
            let mut content = match obj.get("content") {
                Some(Value::String(s)) => s.clone(),
                Some(Value::Array(arr)) => {
                    // Flatten array of content parts into a single string
                    arr.iter()
                        .filter_map(|part| {
                            if let Some(text) = part.as_str() {
                                Some(text.to_string())
                            } else if let Some(o) = part.as_object() {
                                o.get("text").and_then(|t| t.as_str()).map(|s| s.to_string())
                            } else {
                                None
                            }
                        })
                        .collect::<Vec<_>>()
                        .join("\n")
                }
                _ => String::new(),
            };

            // If the item has images, append them to the content as markdown images!
            if let Some(Value::Array(imgs)) = obj.get("images") {
                for img in imgs {
                    if let Some(img_obj) = img.as_object() {
                        if let Some(data_url) = img_obj.get("dataUrl").and_then(|d| d.as_str()) {
                            let alt = img_obj.get("alt").and_then(|a| a.as_str()).unwrap_or("Uploaded Image");
                            content.push_str(&format!("\n\n![{}]({})", alt, data_url));
                        }
                    }
                }
            }

            if content.is_empty() {
                return None;
            }
            Some(SimpleMessage { role, content })
        })
        .collect();

    let item_count = raw_items.len();

    CapsulePayload {
        id,
        title,
        platform,
        capture_level,
        created_at: chrono::Utc::now().timestamp(),
        raw_items,
        item_count,
        messages,
    }
}
