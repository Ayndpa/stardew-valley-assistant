use serde::{Deserialize, Serialize};
use tokio::task;

use super::xnb::{get_lang_suffix, load_int_string_dictionary_best_effort, load_localized_string_tables_with_lang};
use super::calendar::resolve_localized_text;

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SecretNoteEntry {
    pub id: i32,
    pub content: String,
    pub is_image: bool,
    pub image_index: Option<i32>,
    pub is_journal: bool,
    pub discovery_hints: Vec<String>,
}

/// Known discovery hints for specific note IDs (from game source analysis).
fn specific_discovery_hints(note_id: i32) -> Vec<String> {
    match note_id {
        // --- Regular Secret Notes (1-25) ---
        16 => vec!["在铁路区域用锄头挖掘 (12,38)".into()],
        17 => vec!["在沙漠用锄头挖掘 (98,5)".into()],
        18 => vec!["在城镇用锄头挖掘 (40,55)".into()],
        19 => vec!["在城镇调查特定地点（靠近博物馆旁的树）".into()],
        20 => vec!["在城镇调查特定地点（获得永久幸运增益）".into()],
        21 => vec!["凌晨 12:40 在城镇灌木丛 (47,100) 调查".into()],
        23 => vec!["阅读后触发玛妮的项链任务".into()],
        25 => vec!["需要先获得放大镜，然后在铁路区域钓鱼随机获得".into()],
        // --- Journal Scraps (1000+, Ginger Island) ---
        1002 => vec!["在姜岛秘密区域用锄头挖掘 (82,83)".into()],
        1004 => vec!["在姜岛西部用锄头挖掘 (18,42)".into()],
        1006 => vec!["在姜岛西部用锄头挖掘 (104,74)".into()],
        1010 => vec!["在姜岛北部用锄头挖掘 (27,28)".into()],
        _ => vec![],
    }
}

/// Build generic discovery hints based on note type.
fn generic_discovery_hints(is_journal: bool) -> Vec<String> {
    if is_journal {
        vec![
            "在姜岛通过各种活动随机发现（不需要放大镜）".into(),
            "锄地挖出 (0.75%)".into(),
            "击杀怪物 (3.3%)".into(),
            "砍树 (0.5%)".into(),
            "清除杂草 (0.9%)".into(),
            "破坏大型资源/巨型作物 (5%)".into(),
            "钓鱼时随机获得".into(),
        ]
    } else {
        vec![
            "前置：完成科罗布斯 14♥ 事件后，在城镇灌木丛 (28,14) 互动获得放大镜".into(),
            "锄地挖出 (0.75%)".into(),
            "击杀怪物 (3.3%)".into(),
            "砍树 (0.5%)".into(),
            "清除杂草 (0.9%)".into(),
            "破坏大型资源/巨型作物 (5%)".into(),
            "钓鱼时随机获得".into(),
            "概率随未发现数量减少而降低 (80%→12%)".into(),
        ]
    }
}

fn parse_note_content(raw: &str) -> (String, bool, Option<i32>) {
    let trimmed = raw.trim();
    if let Some(rest) = trimmed.strip_prefix('!') {
        // Image note: "! <imageIndex>"
        let idx = rest.trim().parse::<i32>().ok();
        let desc = match idx {
            Some(0) => "一张手绘的图片：一只小鸟在树枝上".into(),
            Some(1) => "一张手绘的图片：一只花栗鼠在吃坚果".into(),
            Some(2) => "一张手绘的图片：一条鱼跳出水面".into(),
            Some(3) => "一张手绘的图片：一朵盛开的花".into(),
            Some(4) => "一张手绘的图片：一栋小房子".into(),
            Some(5) => "一张手绘的图片：一棵大树".into(),
            Some(6) => "一张手绘的图片：一个爱心".into(),
            Some(7) => "一张手绘的图片：一只蝴蝶".into(),
            Some(8) => "一张手绘的图片：一朵云和雨滴".into(),
            Some(9) => "一张手绘的图片：一个太阳".into(),
            Some(10) => "一张手绘的图片：一个月亮和星星".into(),
            Some(11) => "一张手绘的图片：一棵仙人掌".into(),
            _ => "一张神秘的手绘图片".into(),
        };
        (desc, true, idx)
    } else {
        // Text note: clean up tokens
        let mut text = trimmed.to_string();
        // Remove %revealtaste tokens
        while let Some(start) = text.find("%revealtaste") {
            if let Some(end) = text[start..].find('%') {
                if end > 12 {
                    text.replace_range(start..start + end + 1, "");
                } else {
                    break;
                }
            } else {
                break;
            }
        }
        // Remove %item tokens
        while let Some(start) = text.find("%item") {
            if let Some(end) = text[start..].find("%%") {
                text.replace_range(start..start + end + 2, "");
            } else {
                break;
            }
        }
        // Remove %action tokens
        while let Some(start) = text.find("%action") {
            if let Some(end) = text[start..].find("%%") {
                text.replace_range(start..start + end + 2, "");
            } else {
                break;
            }
        }
        // Clean up
        text = text.replace('@', "【玩家名】");
        text = text.replace('^', "\n");
        text = text.trim().to_string();
        (text, false, None)
    }
}

fn load_secret_notes_sync(
    game_dir: Option<String>,
    lang: Option<String>,
) -> Result<Vec<SecretNoteEntry>, String> {
    let content_dir = super::locate_content_dir(game_dir.as_deref())?;
    let lang_suffix = get_lang_suffix(lang.as_deref());

    // Try localized path first, then fall back to default
    let mut paths = Vec::new();
    if !lang_suffix.is_empty() {
        paths.push(
            content_dir
                .join("Data")
                .join(format!("SecretNotes{}.xnb", lang_suffix)),
        );
    }
    paths.push(content_dir.join("Data").join("SecretNotes.xnb"));

    let raw_data = load_int_string_dictionary_best_effort(&paths);

    // Load localized string tables for resolving [LocalizedText ...] tokens
    let localized_tables = load_localized_string_tables_with_lang(
        &content_dir,
        &["Objects", "StringsFromCSFiles", "1_6_Strings", "NPCNames", "UI"],
        lang.as_deref(),
    );

    let _is_zh = lang.as_deref().is_some_and(|l| l.starts_with("zh"));

    let mut entries = Vec::new();
    for (key, value) in &raw_data {
        let id = match key.parse::<i32>() {
            Ok(id) => id,
            Err(_) => continue,
        };

        let is_journal = id >= 1000;

        // Resolve localized text tokens in content
        let mut resolved_value = value.clone();
        // Simple resolution: replace [LocalizedText ...] tokens
        while let Some(start) = resolved_value.find("[LocalizedText ") {
            if let Some(end) = resolved_value[start..].find(']') {
                let token = &resolved_value[start..start + end + 1].to_string();
                let resolved = resolve_localized_text(token, &localized_tables);
                resolved_value = resolved_value.replacen(token, &resolved, 1);
            } else {
                break;
            }
        }

        let (content, is_image, image_index) = parse_note_content(&resolved_value);

        // Build discovery hints
        let mut hints = specific_discovery_hints(id);
        if hints.is_empty() {
            hints = generic_discovery_hints(is_journal);
        }

        entries.push(SecretNoteEntry {
            id,
            content,
            is_image,
            image_index,
            is_journal,
            discovery_hints: hints,
        });
    }

    entries.sort_by_key(|e| e.id);
    Ok(entries)
}

#[tauri::command]
pub async fn get_secret_notes_game_data(
    game_dir: Option<String>,
    lang: Option<String>,
) -> Result<Vec<SecretNoteEntry>, String> {
    task::spawn_blocking(move || load_secret_notes_sync(game_dir, lang))
        .await
        .map_err(|e| format!("读取秘密纸条数据任务失败: {}", e))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dev_content_dir() -> Option<std::path::PathBuf> {
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .and_then(|path| path.parent())
            .map(|path| {
                path.join("stardew-valley-source")
                    .join("StardewValleyGame")
                    .join("Content")
            })
            .filter(|path| path.exists())
    }

    #[test]
    fn secret_notes_have_discovery_hints() {
        let Some(content) = dev_content_dir() else {
            eprintln!("stardew-valley-source not found, skipping test");
            return;
        };

        let path = content.join("Data").join("SecretNotes.xnb");
        let raw_data = crate::game_data::xnb::load_int_string_dictionary_xnb(&path)
            .expect("Failed to parse SecretNotes.xnb");
        assert!(!raw_data.is_empty(), "SecretNotes.xnb should contain data");

        let localized_tables = load_localized_string_tables_with_lang(
            &content,
            &["Objects", "StringsFromCSFiles", "1_6_Strings", "NPCNames", "UI"],
            Some("zh"),
        );

        let mut entries = Vec::new();
        for (key, value) in &raw_data {
            let Ok(id) = key.parse::<i32>() else { continue };
            let is_journal = id >= 1000;

            let mut resolved_value = value.clone();
            while let Some(start) = resolved_value.find("[LocalizedText ") {
                if let Some(end) = resolved_value[start..].find(']') {
                    let token = resolved_value[start..start + end + 1].to_string();
                    let resolved = resolve_localized_text(&token, &localized_tables);
                    resolved_value = resolved_value.replacen(&token, &resolved, 1);
                } else {
                    break;
                }
            }

            let (content, is_image, image_index) = parse_note_content(&resolved_value);
            let mut hints = specific_discovery_hints(id);
            if hints.is_empty() {
                hints = generic_discovery_hints(is_journal);
            }

            entries.push(SecretNoteEntry {
                id,
                content,
                is_image,
                image_index,
                is_journal,
                discovery_hints: hints,
            });
        }
        entries.sort_by_key(|e| e.id);

        // Print all notes with their hints
        for entry in &entries {
            let type_label = if entry.is_journal { "日志残页" } else if entry.is_image { "图片纸条" } else { "秘密纸条" };
            eprintln!(
                "\n=== {} #{} ({}) ===",
                type_label, entry.id, if entry.is_journal { "姜岛" } else { "山谷" }
            );
            eprintln!("  内容: {}", if entry.content.len() > 60 { format!("{}...", &entry.content[..60]) } else { entry.content.clone() });
            for hint in &entry.discovery_hints {
                eprintln!("  💡 {}", hint);
            }
        }

        // Every note must have at least one hint
        for entry in &entries {
            assert!(!entry.discovery_hints.is_empty(), "Note #{} has no discovery hints!", entry.id);
        }

        // Verify specific hints
        let note_16 = entries.iter().find(|e| e.id == 16).unwrap();
        assert!(note_16.discovery_hints.iter().any(|h| h.contains("铁路")), "Note #16 should mention 铁路");

        let note_21 = entries.iter().find(|e| e.id == 21).unwrap();
        assert!(note_21.discovery_hints.iter().any(|h| h.contains("12:40")), "Note #21 should mention 12:40");

        // Verify generic hints for regular notes
        let note_1 = entries.iter().find(|e| e.id == 1).unwrap();
        assert!(note_1.discovery_hints.iter().any(|h| h.contains("放大镜")), "Regular note should mention magnifying glass");
        assert!(note_1.discovery_hints.iter().any(|h| h.contains("3.3%")), "Regular note should mention monster drop rate");

        // Verify journal scraps
        let journal = entries.iter().find(|e| e.id == 1001).unwrap();
        assert!(journal.discovery_hints.iter().any(|h| h.contains("姜岛")), "Journal should mention 姜岛");
        assert!(!journal.discovery_hints.iter().any(|h| h.contains("前置")), "Journal should NOT have magnifying glass prerequisite");

        eprintln!("\n✅ 共 {} 条秘密纸条，全部有获取方式", entries.len());
    }
}
